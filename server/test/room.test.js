import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, PHASE, prizePool } from '../src/game/room.js';
import { RoomManager } from '../src/game/manager.js';
import { cardForCartela, completedLines } from '../src/game/bingo.js';

/** Manual timers so tests control the clock. */
function fakeTimers() {
  const pending = new Map();
  let id = 0;
  return {
    set: (fn, ms) => {
      pending.set(++id, { fn, ms });
      return id;
    },
    clear: (t) => pending.delete(t),
    fire() {
      const [k, t] = pending.entries().next().value ?? [];
      if (k === undefined) return false;
      pending.delete(k);
      t.fn();
      return true;
    },
    get count() {
      return pending.size;
    },
  };
}

/** In-memory wallet with the same contract the socket layer provides. */
function fakeWallet(balances = {}) {
  const ledger = [];
  return {
    balances,
    ledger,
    charge(userId, amount, note) {
      if ((balances[userId] ?? 0) < amount) return false;
      balances[userId] -= amount;
      ledger.push({ userId, amount: -amount, note });
      return true;
    },
    credit(userId, amount, note) {
      balances[userId] = (balances[userId] ?? 0) + amount;
      ledger.push({ userId, amount, note });
    },
  };
}

function makeRoom(rules = {}, { stake = 0, wallet = null } = {}) {
  const events = [];
  const privateEvents = [];
  const timers = fakeTimers();
  const room = new Room({
    code: 'TEST',
    stake,
    rules,
    wallet,
    emit: (event, payload) => events.push({ event, payload }),
    emitTo: (id, event, payload) => privateEvents.push({ id, event, payload }),
    now: () => 1_700_000_000_000, // frozen clock: countdown maths is exact
    timers,
  });
  return { room, events, privateEvents, timers };
}

const u1 = { id: 1, first_name: 'Abebe' };
const u2 = { id: 2, first_name: 'Kebede' };
const u3 = { id: 3, username: 'sara' };

/** Calls numbers until every number on the player's first cartela is out, then marks them all. */
function fillCard(room, timers, userId, cartela = null) {
  const player = room.players.get(userId);
  const card = cartela === null ? player.cards[0] : player.cards.find((c) => c.cartela === cartela);
  const numbers = card.cells.filter((c) => c.value !== null).map((c) => c.value);
  while (!numbers.every((n) => room.called.includes(n))) assert.ok(timers.fire());
  for (const n of numbers) room.mark(userId, n, card.cartela);
  return numbers;
}

test('the countdown starts once enough players hold a cartela, then the round starts by itself', () => {
  const { room, timers, privateEvents } = makeRoom();
  room.join(u1);
  room.join(u2);
  assert.equal(room.phase, PHASE.WAITING); // joined, but nobody has picked yet
  room.choose(1, 5);
  assert.equal(room.phase, PHASE.WAITING);
  room.choose(2, 9);
  assert.equal(room.phase, PHASE.COUNTDOWN);
  assert.equal(room.startsAt - room.now(), 40_000);
  assert.ok(timers.fire()); // countdown elapses
  assert.equal(room.phase, PHASE.PLAYING);
  assert.equal(room.called.length, 1);
  assert.deepEqual(privateEvents.filter((e) => e.event === 'game:card').map((e) => e.id), [1, 2, 1, 2]);
  assert.equal(room.publicState().players.length, 2);
});

test('leaving during countdown cancels it', () => {
  const { room, timers } = makeRoom();
  room.join(u1);
  room.join(u2);
  room.choose(1, 1);
  room.choose(2, 2);
  room.leave(1);
  assert.equal(room.phase, PHASE.WAITING);
  assert.equal(timers.count, 0);
  assert.equal(room.ownerOf(1), null);
});

test('the house hosts: a round only starts with enough picks and no player is a host', () => {
  const { room } = makeRoom();
  room.join(u1);
  room.join(u2);
  assert.throws(() => room.start(), /at least 2 players with a cartela/);
  room.choose(1, 1);
  room.choose(2, 2);
  assert.equal('hostId' in room.publicState(), false);
  room.start();
  assert.equal(room.phase, PHASE.PLAYING);
  assert.throws(() => room.start(), /already running/);
});

test('marking validates called numbers and card membership; with fullCard off a line can be claimed', () => {
  const { room, timers, events } = makeRoom({ fullCard: false });
  room.join(u1);
  room.join(u2);
  room.choose(1, 4);
  room.choose(2, 6);
  room.start();
  const p1 = room.players.get(1).cards[0];
  const notCalled = p1.cells.find((c) => c.value !== null && !room.called.includes(c.value)).value;
  assert.throws(() => room.mark(1, notCalled), /not been called/);
  assert.throws(() => room.claim(1), /Not yet: 0\/1 lines/);

  const row = p1.cells.slice(0, 5).map((c) => c.value);
  while (!row.every((n) => room.called.includes(n))) assert.ok(timers.fire());
  const offCard = room.called.find((n) => !p1.cells.some((c) => c.value === n));
  if (offCard) assert.throws(() => room.mark(1, offCard), /not on your card/);
  for (const n of row) room.mark(1, n);
  assert.equal(room.phase, PHASE.PLAYING); // a line alone does not end it: BINGO! must be pressed

  room.claim(1);
  assert.equal(room.phase, PHASE.FINISHED);
  assert.equal(room.winner.id, 1);
  const over = events.find((e) => e.event === 'game:over');
  assert.equal(over.payload.winner.name, 'Abebe');
  assert.deepEqual(over.payload.winner.line, [0, 1, 2, 3, 4]);
  assert.equal(room.publicState().players.find((p) => p.id === 1).marked, 5);
});

test('by default BINGO! is only accepted once every number on the card is marked', () => {
  const { room, timers, events } = makeRoom();
  room.join(u1);
  room.join(u2);
  room.choose(1, 4);
  room.choose(2, 6);
  room.start();
  const p1 = room.players.get(1).cards[0];
  const numbers = p1.cells.filter((c) => c.value !== null).map((c) => c.value);
  while (!numbers.every((n) => room.called.includes(n))) assert.ok(timers.fire());
  for (const n of numbers.slice(0, -1)) {
    const res = room.mark(1, n);
    assert.equal(res.canClaim, false);
  }
  assert.ok(completedLines(p1.marks).length >= 1);
  assert.throws(() => room.claim(1), /Not yet: 23\/24 marked/);
  const last = room.mark(1, numbers.at(-1));
  assert.equal(last.full, true);
  assert.equal(last.canClaim, true);
  assert.equal(room.phase, PHASE.PLAYING);
  room.claim(1);
  assert.equal(room.phase, PHASE.FINISHED);
  assert.equal(room.winner.full, true);
  assert.equal(events.find((e) => e.event === 'game:over').payload.winner.full, true);
  assert.equal(room.publicState().players.find((p) => p.id === 1).marked, 24);
});

test('after a round registration re-opens and everyone picks again', () => {
  const { room, timers } = makeRoom();
  room.join(u1);
  room.join(u2);
  room.choose(1, 7);
  room.choose(2, 8);
  room.start();
  room.finish(room.players.get(2));
  assert.equal(room.phase, PHASE.FINISHED);
  assert.throws(() => room.choose(1, 9), /Wait for the next round/);
  assert.ok(timers.fire()); // restart delay
  assert.equal(room.phase, PHASE.WAITING);
  assert.equal(room.players.get(1).cards.length, 0);
  assert.equal(room.cardFor(1), null);
  room.choose(1, 7);
  room.choose(2, 7 + 1);
  assert.equal(room.phase, PHASE.COUNTDOWN);
  assert.ok(timers.fire());
  assert.equal(room.round, 2);
});

test('exhausting all 75 numbers ends the round without a winner', () => {
  const { room, timers } = makeRoom();
  room.join(u1);
  room.join(u2);
  room.choose(1, 1);
  room.choose(2, 2);
  room.start();
  while (room.phase === PHASE.PLAYING) assert.ok(timers.fire());
  assert.equal(room.called.length, 75);
  assert.equal(room.winner, null);
});

test('a cartela number always deals the same card; different cartelas differ', () => {
  const a = cardForCartela(7);
  assert.deepEqual(a, cardForCartela(7));
  assert.notDeepEqual(a, cardForCartela(8));
  for (const c of a) {
    if (c.index === 12) assert.equal(c.value, null);
    else assert.ok(c.value >= c.col * 15 + 1 && c.value <= c.col * 15 + 15);
  }
  assert.equal(new Set(a.map((c) => c.value)).size, 25);
});

test('players pick unique cartelas before the round and see their cards at once', () => {
  const { room, privateEvents } = makeRoom();
  room.join(u1);
  assert.throws(() => room.choose(1, 0), /between 1 and 400/);
  assert.throws(() => room.choose(1, 401), /between 1 and 400/);
  assert.throws(() => room.choose(1, 1.5), /between 1 and 400/);
  assert.throws(() => room.choose(2, 5), /not in this room/);
  room.choose(1, 5);
  assert.deepEqual(room.players.get(1).cards.map((c) => c.cartela), [5]);
  assert.deepEqual(room.cardFor(1).cards[0].cells, cardForCartela(5));
  assert.equal(room.cardFor(1).cards[0].cartela, 5);
  assert.equal(privateEvents.at(-1).event, 'game:card');

  room.join(u2);
  assert.throws(() => room.choose(2, 5), /already taken by Abebe/);
  room.choose(2, 9);
  room.choose(1, 5); // re-picking your own cartela is a no-op
  room.choose(1, 42); // a second cartela; the first one stays yours
  assert.throws(() => room.choose(2, 5), /already taken by Abebe/);
  room.release(1, 5); // giving one back frees it
  assert.throws(() => room.release(1, 5), /do not hold cartela 5/);
  room.choose(2, 5);
  const state = room.publicState();
  assert.deepEqual(state.players.map((p) => [p.id, p.cartelas, p.cartela]), [[1, [42], 42], [2, [5, 9], 5]]);
  assert.equal(state.rules.cartelaCount, 400);
  assert.equal(state.ready, 2);
  assert.equal(state.tickets, 3);
});

test('a player may hold up to maxCartelas, each paying the stake, and can win on any of them', () => {
  const wallet = fakeWallet({ 1: 100, 2: 100 });
  const { room, timers } = makeRoom({ maxCartelas: 4 }, { stake: 10, wallet });
  room.join(u1);
  room.join(u2);
  for (const n of [11, 12, 13, 14]) room.choose(1, n);
  assert.throws(() => room.choose(1, 15), /up to 4 cartelas/);
  assert.equal(wallet.balances[1], 60); // 4 × 10
  room.choose(2, 21);
  assert.equal(room.tickets, 5);
  assert.equal(room.summary().pool, 40); // 5 × 10 minus 20 %
  assert.deepEqual(room.cardFor(1).cards.map((c) => c.cartela), [11, 12, 13, 14]);

  room.start();
  // Marking without a cartela hits every card of mine that carries the number.
  const first = room.called[0];
  const holders = room.players.get(1).cards.filter((c) => c.cells.some((x) => x.value === first));
  if (holders.length) {
    const res = room.mark(1, first);
    assert.equal(res.cards.filter((c) => c.marked === 1).length, holders.length);
  }
  assert.throws(() => room.mark(1, first, 99), /do not hold cartela 99/);
  assert.throws(() => room.claim(1), /Not yet/);
  fillCard(room, timers, 1, 13);
  assert.throws(() => room.claim(1, 11), /Not yet/); // that one is not full
  const p = room.claim(1); // picks the full cartela by itself
  assert.equal(p.canClaim, true);
  assert.equal(room.winner.cartela, 13);
  assert.equal(room.winner.prize, 40);
  assert.equal(wallet.balances[1], 100);
});

test('players without a cartela sit the round out and can join the next one', () => {
  const { room, timers } = makeRoom();
  room.join(u1);
  room.join(u2);
  room.join(u3);
  room.choose(1, 33);
  room.choose(2, 34);
  assert.ok(timers.fire()); // countdown
  assert.equal(room.phase, PHASE.PLAYING);
  assert.equal(room.cardFor(3), null);
  assert.throws(() => room.mark(3, room.called[0]), /not in this round/);
  assert.throws(() => room.choose(3, 50), /Wait for the next round/);
  const state = room.publicState();
  assert.deepEqual(state.players.map((p) => p.playing), [true, true, false]);
  assert.equal(state.ready, 2);
});

test('leaving frees the cartela and cartelaCount never drops below maxPlayers', () => {
  const { room } = makeRoom({ cartelaCount: 2, maxPlayers: 4 });
  assert.equal(room.rules.cartelaCount, 4);
  room.join(u1);
  room.join(u2);
  room.choose(1, 1);
  assert.throws(() => room.choose(2, 1), /already taken/);
  room.leave(1);
  room.choose(2, 1);
  assert.deepEqual(room.players.get(2).cards.map((c) => c.cartela), [1]);
});

test('paid table: the stake is charged on the first pick, refunded on leaving, and the pool goes to the winner', () => {
  const wallet = fakeWallet({ 1: 25, 2: 10, 3: 5 });
  const rounds = [];
  const { room, timers, events } = makeRoom({ houseCutPercent: 20 }, { stake: 10, wallet });
  room.stats = { recordRound: (r) => rounds.push(r) };
  room.join(u1);
  room.join(u2);
  room.join(u3);
  assert.throws(() => room.choose(3, 3), /Insufficient balance: this room costs 10/);
  assert.equal(wallet.balances[3], 5);
  room.choose(1, 1);
  room.release(1, 1); // giving a cartela back refunds it
  room.choose(1, 2);
  assert.equal(wallet.balances[1], 15);
  room.choose(2, 5);
  assert.equal(wallet.balances[2], 0);
  assert.equal(room.summary().pool, 16); // 2 × 10 minus 20%
  room.join({ id: 4, first_name: 'Dawit' });
  wallet.balances[4] = 10;
  room.choose(4, 8);
  room.leave(4); // refunded before the round starts
  assert.equal(wallet.balances[4], 10);

  room.start();
  assert.equal(room.pool, 16);
  fillCard(room, timers, 1);
  room.claim(1);
  assert.equal(room.phase, PHASE.FINISHED);
  assert.equal(room.winner.prize, 16);
  assert.equal(wallet.balances[1], 31);
  assert.equal(wallet.balances[2], 0);
  assert.equal(events.find((e) => e.event === 'game:over').payload.pool, 16);
  assert.equal(room.publicState().winner.prize, 16);
  assert.ok(wallet.ledger.some((l) => l.userId === 1 && l.amount === 16 && /Prize/.test(l.note)));
  assert.equal(rounds.length, 1);
  assert.deepEqual([rounds[0].participants, rounds[0].winnerId, rounds[0].prize, rounds[0].stakes, rounds[0].houseTake], [[1, 2], 1, 16, 20, 4]);
  assert.equal(rounds[0].winner.name, 'Abebe');

  // Leaving after the round is over does not refund the stake.
  room.leave(2);
  assert.equal(wallet.balances[2], 0);
});

test('paid table: stakes are refunded when nobody wins', () => {
  const wallet = fakeWallet({ 1: 20, 2: 20 });
  const { room, timers } = makeRoom({}, { stake: 20, wallet });
  room.join(u1);
  room.join(u2);
  room.choose(1, 1);
  room.choose(2, 2);
  assert.deepEqual([wallet.balances[1], wallet.balances[2]], [0, 0]);
  room.start();
  while (room.phase === PHASE.PLAYING) assert.ok(timers.fire());
  assert.equal(room.winner, null);
  assert.deepEqual([wallet.balances[1], wallet.balances[2]], [20, 20]);
});

test('by default the house keeps 20 % of every stake', () => {
  const wallet = fakeWallet({ 1: 50, 2: 50, 3: 50 });
  const rounds = [];
  const { room, timers } = makeRoom({}, { stake: 50, wallet });
  room.stats = { recordRound: (r) => rounds.push(r) };
  room.join(u1);
  room.join(u2);
  room.join(u3);
  room.choose(1, 1);
  room.choose(2, 2);
  room.choose(3, 3);
  assert.equal(room.summary().pool, 120); // 3 × 50 minus the default 20 % house cut
  room.start();
  fillCard(room, timers, 2);
  room.claim(2);
  assert.equal(wallet.balances[2], 120);
  assert.equal(rounds[0].houseTake, 30);
  assert.equal(rounds[0].stakes, 150);
});

test('the prize pool never exceeds maxPrize', () => {
  assert.equal(prizePool(50, 8, 20), 320);
  assert.equal(prizePool(50, 8, 20, 3000), 320);
  assert.equal(prizePool(1000, 8, 20, 3000), 3000); // 6400 capped
  const { room } = makeRoom({ maxPrize: 25 }, { stake: 10, wallet: fakeWallet({ 1: 100, 2: 100, 3: 100 }) });
  room.join(u1);
  room.join(u2);
  room.join(u3);
  room.choose(1, 1);
  room.choose(2, 2);
  room.choose(3, 3);
  assert.equal(room.summary().pool, 24); // 3 × 10 minus 20 % = 24, under the cap
  room.rules.maxPrize = 20;
  assert.equal(room.poolFor(3), 20);
});

test('free table needs no wallet; a paid table without one refuses picks', () => {
  const { room } = makeRoom({}, { stake: 0, wallet: null });
  room.join(u1);
  room.choose(1, 1);
  assert.equal(room.summary().pool, 0);
  const paid = makeRoom({}, { stake: 10, wallet: null }).room;
  paid.join(u1);
  assert.throws(() => paid.choose(1, 1), /Insufficient balance/);
});

test('manager: public tables per stake, fullest joinable first, empty rooms cleaned up', () => {
  const manager = new RoomManager({ emit() {}, emitTo() {}, rules: { countdownMs: 60_000 } });
  const a = manager.joinStake(u1, 10);
  const b = manager.joinStake(u2, 10);
  assert.equal(a.code, b.code);
  assert.equal(a.stake, 10);
  const free = manager.joinStake(u3, 0);
  assert.notEqual(free.code, a.code);
  assert.equal(free.stake, 0);
  assert.throws(() => manager.joinStake(u1, 15), /Unknown stake/);
  assert.throws(() => manager.join(u1, 'NOPE'), /not found/);

  const list = manager.list();
  assert.deepEqual(list.map((l) => l.stake), [0, 10, 20, 50]);
  assert.equal(list[1].room.code, a.code);
  assert.equal(list[1].room.players, 2);
  assert.equal(list[2].room, null);

  manager.leave(3);
  assert.equal(manager.rooms.has(free.code), false);
  assert.deepEqual(manager.stats(), { rooms: 1, players: 2 });
  for (const r of manager.rooms.values()) r.destroy();
});

test('manager: a table in progress is listed but new players get a fresh one', () => {
  const manager = new RoomManager({ emit() {}, emitTo() {}, wallet: fakeWallet({ 1: 100, 2: 100, 3: 100 }) });
  const room = manager.joinStake(u1, 20);
  manager.joinStake(u2, 20);
  room.choose(1, 1);
  room.choose(2, 2);
  room.start();
  assert.equal(manager.list()[2].room.phase, 'playing');
  const next = manager.joinStake(u3, 20);
  assert.notEqual(next.code, room.code);
  assert.equal(manager.list()[2].room.code, next.code); // the joinable one is featured
  assert.throws(() => manager.join({ id: 9, first_name: 'X' }, room.code), /in progress/);
  for (const r of manager.rooms.values()) r.destroy();
});

test('manager: private rooms stay off the public lobby and close() empties a table with refunds', () => {
  const wallet = fakeWallet({ 1: 50, 2: 50, 3: 50 });
  const manager = new RoomManager({ emit() {}, emitTo() {}, wallet });
  const priv = manager.create(u1, 10);
  assert.equal(priv.isPrivate, true);
  assert.equal(manager.list()[1].room, null); // not offered as the public 10 ETB table
  manager.join(u2, priv.code);
  priv.choose(1, 1);
  priv.choose(2, 2);
  assert.deepEqual([wallet.balances[1], wallet.balances[2]], [40, 40]);
  const pub = manager.joinStake(u3, 10);
  assert.equal(pub.isPrivate, false);
  assert.equal(manager.liveRooms().length, 2);
  assert.equal(manager.liveRooms().find((r) => r.code === priv.code).players.length, 2);

  assert.equal(manager.close(priv.code.toLowerCase()), priv.code);
  assert.deepEqual([wallet.balances[1], wallet.balances[2]], [50, 50]); // open stakes refunded
  assert.equal(manager.roomOf(1), null);
  assert.equal(manager.rooms.has(priv.code), false);
  assert.throws(() => manager.close('NOPE'), /not found/);
  for (const r of manager.rooms.values()) r.destroy();
});

test('manager: destroying an open paid room refunds picks', () => {
  const wallet = fakeWallet({ 1: 50 });
  const manager = new RoomManager({ emit() {}, emitTo() {}, wallet });
  const room = manager.joinStake(u1, 50);
  room.choose(1, 1);
  assert.equal(wallet.balances[1], 0);
  manager.leave(1);
  assert.equal(wallet.balances[1], 50);
  assert.equal(manager.rooms.size, 0);
});
