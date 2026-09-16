import { Server } from 'socket.io';
import { verifyInitData, suspendedMessage } from './auth.js';
import { RoomManager } from './game/manager.js';

/**
 * Socket.io layer for multiplayer rooms. Each socket is authenticated with Telegram
 * initData (handshake.auth.initData). Users are identified by Telegram id, so a
 * reconnecting player is re-attached to their room and card.
 */
export function attachRealtime(httpServer, { botToken, devAllowAnon, rules, stakes, store = null, allowedOrigins = [] }) {
  // origin:false (default) keeps this same-origin only, matching the docker-compose setup
  // where nginx reverse-proxies /socket.io to this server. Set ALLOWED_ORIGINS when the
  // webapp is deployed on a different origin (e.g. Vercel) than this server.
  const io = new Server(httpServer, { path: '/socket.io', cors: { origin: allowedOrigins.length ? allowedOrigins : false } });

  const emitTo = (userId, event, payload) => io.to(userChannel(userId)).emit(event, payload);
  const emit = (code, event, payload) => {
    io.to(roomChannel(code)).emit(event, payload);
    // Any room change may alter the lobby list (players, countdown, pool), so refresh it for everyone.
    if (event === 'room:state') io.emit('lobby:rooms', manager.list());
  };

  // Stakes and prizes move wallet money synchronously; the client is told its new balance.
  const wallet = store && {
    charge: (userId, amount, note) => {
      const balance = store.adjust(userId, -amount, note);
      if (balance !== null) emitTo(userId, 'wallet:balance', { balance });
      return balance !== null;
    },
    credit: (userId, amount, note) => {
      const balance = store.adjust(userId, amount, note);
      emitTo(userId, 'wallet:balance', { balance });
    },
  };

  const stats = store && { recordRound: (round) => store.recordRound({ ...round, freeCoins: rules?.freeBingoCoins ?? 50 }) };
  const manager = new RoomManager({ emit, emitTo, rules, stakes, wallet, stats });

  // Players appear under the display name they chose at sign-up (if the profile has one).
  const withProfileName = (user) => {
    const name = store?.profile(user.id)?.name;
    return name ? { ...user, first_name: name } : user;
  };

  // Suspended players are refused at the handshake with the reason as the error message.
  const admit = (socket, user, next) => {
    const blocked = store?.suspension(user.id);
    if (blocked) return next(new Error(suspendedMessage(blocked)));
    socket.data.user = withProfileName(user);
    return next();
  };

  io.use((socket, next) => {
    const { initData, devId } = socket.handshake.auth ?? {};
    const user = verifyInitData(initData, botToken);
    if (user) return admit(socket, user, next);
    if (devAllowAnon && !initData) {
      const id = Number.parseInt(devId, 10) || 1;
      return admit(socket, { id, first_name: `Guest ${id}` }, next);
    }
    next(new Error('unauthorized'));
  });

  /** Operator action: drop the player from their table (refunding an open stake) and close their sockets. */
  const kick = (userId, reason) => {
    manager.leave(userId);
    io.to(userChannel(userId)).emit('session:kicked', { reason });
    io.in(userChannel(userId)).disconnectSockets(true);
  };

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(userChannel(user.id));
    // Tell the client who it is; outside Telegram (guest mode) it has no other way to know.
    socket.emit('session:me', {
      id: user.id,
      name: user.first_name || user.username || `Player ${user.id}`,
      balance: store ? store.balance(user.id) : null,
    });
    socket.emit('lobby:rooms', manager.list());

    // A client that sends an unexpected extra argument (or omits one) can cause Socket.io to
    // bind a handler's `cb` parameter to something that isn't a function (e.g. a payload
    // object). `cb?.(...)` only guards against null/undefined, so it still throws in that case
    // — and an uncaught throw here crashes the whole process, dropping every live game. Every
    // callback invocation goes through this guard instead.
    const safeCb = (cb, arg) => {
      if (typeof cb === 'function') cb(arg);
    };

    const ack = (cb, fn) => {
      try {
        const room = fn();
        safeCb(cb, { ok: true, room: room?.publicState() ?? null, card: room?.cardFor(user.id) ?? null });
      } catch (err) {
        safeCb(cb, { ok: false, error: err.message });
      }
    };

    const attach = (room) => {
      for (const r of socket.rooms) if (r.startsWith('room:')) socket.leave(r);
      socket.join(roomChannel(room.code));
      console.log(`[rooms] ${user.id} seated in ${room.code} (${room.size} players)`);
      return room;
    };

    const inRoom = () => {
      const room = manager.roomOf(user.id);
      if (!room) throw new Error('You are not in a room');
      return room;
    };

    // Re-attach a returning player (e.g. Mini App reopened mid-game).
    const existing = manager.roomOf(user.id);
    if (existing) {
      attach(existing);
      socket.emit('room:state', existing.publicState());
      const card = existing.cardFor(user.id);
      if (card) socket.emit('game:card', card);
    }

    socket.on('room:list', (payload, cb) => {
      if (typeof payload === 'function') [payload, cb] = [{}, payload];
      safeCb(cb, { ok: true, rooms: manager.list() });
    });
    socket.on('room:create', (payload, cb) => {
      if (typeof payload === 'function') [payload, cb] = [{}, payload];
      ack(cb, () => attach(manager.create(user, Number(payload?.stake ?? 0))));
    });
    // Join a public table by stake, or a private room by code.
    socket.on('room:join', (payload, cb) => {
      if (typeof payload === 'function') [payload, cb] = [{}, payload];
      ack(cb, () => attach(payload?.code ? manager.join(user, payload.code) : manager.joinStake(user, Number(payload?.stake ?? 0))));
    });
    socket.on('room:leave', (payload, cb) => {
      if (typeof payload === 'function') [payload, cb] = [{}, payload];
      const room = manager.roomOf(user.id);
      if (room) socket.leave(roomChannel(room.code));
      console.log(`[rooms] ${user.id} left ${room?.code ?? '-'}`);
      manager.leave(user.id);
      safeCb(cb, { ok: true, room: null, card: null });
    });
    socket.on('game:choose', (payload, cb) => {
      if (typeof payload === 'function') [payload, cb] = [{}, payload];
      ack(cb, () => {
        const room = inRoom();
        room.choose(user.id, Number(payload?.cartela));
        return room;
      });
    });
    socket.on('game:release', (payload, cb) => {
      if (typeof payload === 'function') [payload, cb] = [{}, payload];
      ack(cb, () => {
        const room = inRoom();
        room.release(user.id, Number(payload?.cartela));
        return room;
      });
    });
    socket.on('game:mark', (payload, cb) => {
      if (typeof payload === 'function') [payload, cb] = [{}, payload];
      try {
        const room = inRoom();
        const cartela = payload?.cartela == null ? null : Number(payload.cartela);
        const result = room.mark(user.id, Number(payload?.number), cartela);
        store?.trackMission(user.id, 'marks', 1);
        room.broadcast();
        safeCb(cb, { ok: true, ...result });
      } catch (err) {
        safeCb(cb, { ok: false, error: err.message });
      }
    });
    socket.on('game:claim', (payload, cb) => {
      if (typeof payload === 'function') [payload, cb] = [{}, payload];
      try {
        const result = inRoom().claim(user.id, payload?.cartela == null ? null : Number(payload.cartela));
        safeCb(cb, { ok: true, ...result });
      } catch (err) {
        safeCb(cb, { ok: false, error: err.message });
      }
    });

    socket.on('disconnect', () => {
      // Keep the seat for a short grace period so a reconnect (or Telegram backgrounding) is seamless.
      setTimeout(() => {
        const stillConnected = io.sockets.adapter.rooms.get(userChannel(user.id))?.size > 0;
        if (!stillConnected) {
          console.log(`[rooms] ${user.id} timed out; leaving ${manager.roomOf(user.id)?.code ?? '-'}`);
          manager.leave(user.id);
        }
      }, 10_000);
    });
  });

  /** Operator action: close a table; everyone in it lands back in the lobby with the reason. */
  const closeRoom = (code, reason) => {
    const channel = roomChannel(String(code ?? '').toUpperCase());
    io.to(channel).emit('room:closed', { reason });
    const closed = manager.close(code);
    io.in(channel).socketsLeave(channel);
    return closed;
  };

  return { io, manager, kick, closeRoom };
}

const roomChannel = (code) => `room:${code}`;
const userChannel = (id) => `user:${id}`;
