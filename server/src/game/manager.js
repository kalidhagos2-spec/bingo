import { Room, makeCode, prizePool, DEFAULT_RULES } from './room.js';

export const DEFAULT_STAKES = Object.freeze([0, 10, 20, 50]);

/** Owns all rooms, one lobby entry per stake, and knows which room each user is in. */
export class RoomManager {
  constructor({ emit, emitTo, rules = {}, stakes = DEFAULT_STAKES, wallet = null, stats = null, isDemo = () => false }) {
    this.emit = emit; // (code, event, payload)
    this.emitTo = emitTo; // (userId, event, payload)
    this.rules = rules;
    this.stakes = [...stakes];
    this.wallet = wallet;
    this.isDemo = isDemo;
    this.roundStats = stats; // { recordRound } for player statistics
    this.rooms = new Map();
    this.userRoom = new Map(); // userId -> code
  }

  newRoom(stake, isPrivate = false) {
    let code = makeCode();
    while (this.rooms.has(code)) code = makeCode();
    const room = new Room({
      code,
      stake,
      isPrivate,
      rules: this.rules,
      wallet: this.wallet,
      stats: this.roundStats,
      isDemo: this.isDemo,
      emit: (event, payload) => this.emit(code, event, payload),
      emitTo: this.emitTo,
    });
    this.rooms.set(code, room);
    return room;
  }

  /** Private room with a code to share. */
  create(user, stake = 0) {
    this.assertStake(stake);
    this.leave(user.id);
    const room = this.newRoom(stake, true);
    room.join(user);
    this.userRoom.set(user.id, room.code);
    return room;
  }

  join(user, code) {
    const room = this.rooms.get(String(code ?? '').toUpperCase());
    if (!room) throw new Error('Room not found');
    if (this.userRoom.get(user.id) === room.code) return room;
    this.leave(user.id);
    room.join(user);
    this.userRoom.set(user.id, room.code);
    return room;
  }

  /** Public table for a stake: the fullest joinable one, else a fresh one. */
  joinStake(user, stake) {
    this.assertStake(stake);
    const current = this.roomOf(user.id);
    if (current?.stake === stake && current.canJoin()) return current;
    const open = this.openRooms(stake);
    return open[0] ? this.join(user, open[0].code) : this.join(user, this.newRoom(stake).code);
  }

  leave(userId) {
    const code = this.userRoom.get(userId);
    if (!code) return;
    this.userRoom.delete(userId);
    const room = this.rooms.get(code);
    if (!room) return;
    room.leave(userId);
    if (room.size === 0) {
      room.destroy();
      this.rooms.delete(code);
    }
  }

  roomOf(userId) {
    const code = this.userRoom.get(userId);
    return code ? (this.rooms.get(code) ?? null) : null;
  }

  assertStake(stake) {
    if (!this.stakes.includes(stake)) throw new Error('Unknown stake');
  }

  openRooms(stake) {
    return [...this.rooms.values()].filter((r) => r.stake === stake && !r.isPrivate && r.canJoin() && r.size > 0).sort((a, b) => b.size - a.size);
  }

  /** Every live table with its players, for the operator dashboard. */
  liveRooms() {
    return [...this.rooms.values()].map((r) => r.publicState());
  }

  /** Server shutdown: every unfinished round is void and its stakes are refunded (see `Room.abort`). Returns the tables closed. */
  shutdown() {
    const codes = [...this.rooms.keys()];
    for (const room of this.rooms.values()) room.abort();
    this.rooms.clear();
    this.userRoom.clear();
    return codes;
  }

  /** Operator action: empties and removes a table. Open stakes are refunded by `room.leave`. */
  close(code) {
    const room = this.rooms.get(String(code ?? '').toUpperCase());
    if (!room) throw new Error('Room not found');
    for (const id of [...room.players.keys()]) this.leave(id);
    if (this.rooms.has(room.code)) {
      room.destroy();
      this.rooms.delete(room.code);
    }
    return room.code;
  }

  /** One entry per stake for the lobby: the table players would land on, or the one in progress. */
  list() {
    const rules = { ...DEFAULT_RULES, ...this.rules };
    return this.stakes.map((stake) => {
      const open = this.openRooms(stake)[0];
      const busy = [...this.rooms.values()].find((r) => r.stake === stake && r.phase === 'playing');
      const room = open ?? busy ?? null;
      return {
        stake,
        room: room ? room.summary() : null,
        houseCutPercent: rules.houseCutPercent,
        maxPrize: rules.maxPrize,
        prize: {
          min: prizePool(stake, rules.minPlayers, rules.houseCutPercent, rules.maxPrize),
          max: prizePool(stake, rules.maxPlayers, rules.houseCutPercent, rules.maxPrize),
        },
      };
    });
  }

  stats() {
    return { rooms: this.rooms.size, players: this.userRoom.size };
  }
}
