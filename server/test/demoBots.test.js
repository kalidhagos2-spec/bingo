import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/game/manager.js';
import { PHASE } from '../src/game/room.js';
import { createDemoBots, isDemoId, randomName, DEMO_ID_BASE } from '../src/demoBots.js';

/** Wallet + profile store with the slice of the PaymentStore contract the bots and rooms use. */
function fakeStore(balances = {}) {
  const profiles = {};
  const ledger = [];
  return {
    balances,
    profiles,
    ledger,
    rounds: [],
    profile: (id) => profiles[id] ?? null,
    setProfile: async (id, patch) => (profiles[id] = { ...profiles[id], ...patch }),
    balance: (id) => balances[id] ?? 0,
    adjust(id, delta, note) {
      const next = (balances[id] ?? 0) + delta;
      if (next < 0) return null;
      balances[id] = next;
      ledger.push({ id, delta, note });
      return next;
    },
  };
}

function setup({ count, balances = {}, rules = {}, stakes = [10], share = 0, perRoom = 3 }) {
  const store = fakeStore(balances);
  const wallet = {
    charge: (id, amount, note) => store.adjust(id, -amount, note) !== null,
    credit: (id, amount, note) => void store.adjust(id, amount, note),
  };
  const stats = { recordRound: (round) => store.rounds.push(round) };
  const manager = new RoomManager({ emit() {}, emitTo() {}, wallet, stats, stakes, isDemo: isDemoId, rules: { minPlayers: 2, countdownMs: 3_600_000, callIntervalMs: 3_600_000, restartDelayMs: 3_600_000, ...rules } });
  let clock = 1_000_000;
  const errors = [];
  let seed = 7;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // repeatable
  const bots = createDemoBots({ manager, store, stakes, count, share, perRoom, rng, now: () => clock, log: (m) => errors.push(m) });
  const step = (ms = 1000) => {
    clock += ms;
    bots.tick();
  };
  return { store, manager, bots, step, errors };
}

/** Runs ticks until `done()` or fails after `limit` of them. */
function until(step, done, limit = 400) {
  for (let i = 0; i < limit && !done(); i++) step();
  assert.ok(done(), 'condition not reached');
}

test('demo players get random names, play money and ids no Telegram account can have', async () => {
  const { store, bots, manager } = setup({ count: 5 });
  await bots.start();
  bots.stop();
  assert.equal(bots.bots.length, 5);
  for (const bot of bots.bots) {
    assert.ok(bot.id <= DEMO_ID_BASE && isDemoId(bot.id));
    assert.equal(store.profile(bot.id).name, bot.name);
    assert.ok(store.balance(bot.id) >= 50 && store.balance(bot.id) <= 500);
  }
  assert.equal(new Set(bots.bots.map((b) => b.name)).size, 5);
  assert.equal(isDemoId(7274346296), false);
  assert.ok(randomName().length >= 2);
  manager.shutdown();
});

test('demo players sit down, pick cartelas, mark and call BINGO by themselves', async () => {
  const { store, bots, manager, step, errors } = setup({ count: 4 });
  await bots.start();
  bots.stop(); // the test drives the clock

  until(step, () => [...manager.rooms.values()].some((r) => r.phase === PHASE.COUNTDOWN));
  const room = [...manager.rooms.values()].find((r) => r.phase === PHASE.COUNTDOWN);
  assert.ok(room.ready >= 2);
  assert.ok([...room.players.values()].every((p) => p.cards.length <= 3));

  room.start();
  until(() => {
    step();
    if (room.phase === PHASE.PLAYING) room.callNext();
  }, () => room.phase === PHASE.FINISHED);
  assert.ok(isDemoId(room.winner.id));
  assert.ok(store.ledger.some((l) => l.id === room.winner.id && /Prize/.test(l.note)));
  assert.deepEqual(errors.filter((e) => !e.includes('around now')), []); // only the start-up line was logged
  manager.shutdown();
});

test('a real player never loses money to a demo player, and the house books only real money', async () => {
  const { store, bots, manager, step } = setup({ count: 3, balances: { 42: 100 } });
  await bots.start();
  bots.stop();

  // The real player sits down first; demo players join that table rather than their own.
  const human = { id: 42, first_name: 'Sara' };
  const room = manager.joinStake(human, 10);
  room.choose(42, 5);
  room.choose(42, 6);
  assert.equal(store.balance(42), 80);
  until(step, () => room.phase === PHASE.COUNTDOWN);
  assert.ok([...room.players.keys()].some(isDemoId));

  // Sara never marks, so a demo player wins this round: her 20 ETB come back.
  room.start();
  until(() => {
    step();
    if (room.phase === PHASE.PLAYING) room.callNext();
  }, () => room.phase === PHASE.FINISHED);
  assert.ok(isDemoId(room.winner.id));
  assert.equal(store.balance(42), 100);
  const lost = store.rounds.at(-1);
  assert.equal(lost.winner.demo, true);
  assert.equal(lost.prize, lost.stakes * 0.8); // the record shows the whole pool…
  assert.equal(lost.demoStakes, lost.stakes - 20);
  assert.equal(lost.realStakes, 0); // …but no real money changed hands: hers was refunded
  assert.equal(lost.houseTake, 0);

  // Next round Sara marks at once and wins the whole pool, demo stakes included.
  room.reopen();
  room.choose(42, 5);
  until(step, () => room.ready >= 2);
  room.start();
  const pool = room.pool;
  while (room.phase === PHASE.PLAYING) {
    room.callNext();
    if (room.phase !== PHASE.PLAYING) break;
    try {
      room.mark(42, room.called.at(-1));
    } catch {
      /* not on her card */
    }
    try {
      room.claim(42);
    } catch {
      /* not yet */
    }
  }
  assert.equal(room.winner.id, 42);
  assert.equal(store.balance(42), 100 - 10 + pool);
  const won = store.rounds.at(-1);
  assert.equal(won.realStakes, 10); // only her stake is real money
  assert.equal(won.demoStakes, won.stakes - 10);
  assert.equal(won.houseTake, 10 - pool); // the padded pool is the house's cost
  manager.shutdown();
});

test('DEMO_BOTS=0 does nothing', async () => {
  const { bots, manager, step } = setup({ count: 0 });
  await bots.start();
  for (let i = 0; i < 20; i++) step();
  assert.equal(manager.rooms.size, 0);
  bots.stop();
});

test('DEMO_BOTS takes a range: the crowd drifts between the two numbers and only those around sit down', async () => {
  const { demoRange } = await import('../src/config.js');
  assert.deepEqual(demoRange('20-30'), { count: 30, minCount: 20 });
  assert.deepEqual(demoRange('30 - 20'), { count: 30, minCount: 20 });
  assert.deepEqual(demoRange('6'), { count: 6, minCount: 6 });
  assert.deepEqual(demoRange('0'), { count: 0, minCount: 0 });
  assert.deepEqual(demoRange('many'), { count: 0, minCount: 0 });

  const store = fakeStore();
  const wallet = { charge: (id, amount, note) => store.adjust(id, -amount, note) !== null, credit: (id, amount, note) => void store.adjust(id, amount, note) };
  const manager = new RoomManager({ emit() {}, emitTo() {}, wallet, stakes: [10, 20, 50], isDemo: isDemoId, rules: { minPlayers: 2, countdownMs: 3_600_000, callIntervalMs: 3_600_000, restartDelayMs: 3_600_000 } });
  let clock = 5_000_000;
  const bots = createDemoBots({ manager, store, stakes: [10, 20, 50], count: 30, minCount: 20, perRoom: 6, crowdMs: [60_000, 120_000], now: () => clock, log() {} });
  await bots.start();
  bots.stop();
  assert.equal(bots.bots.length, 30);

  const sizes = new Set();
  for (let i = 0; i < 1500; i++) {
    clock += 1000;
    bots.tick();
    sizes.add(bots.active);
    assert.ok(bots.active >= 20 && bots.active <= 30, `active ${bots.active}`);
    // nobody who is not "around" sits down, and no table holds more demo players than allowed
    for (const room of manager.rooms.values()) assert.ok([...room.players.keys()].filter(isDemoId).length <= 6);
  }
  assert.ok(sizes.size >= 3, `crowd sizes seen: ${[...sizes]}`); // it really varies
  const seated = bots.bots.filter((b) => manager.roomOf(b.id)).length;
  assert.ok(seated >= 10, `seated ${seated}`); // most of the crowd is at a table, a few stay free for real players
  manager.shutdown();
});

test('a real player who leaves mid-round stays in the round\'s accounts and is refunded when a demo player wins', async () => {
  const { store, bots, manager, step } = setup({ count: 4, perRoom: 5, balances: { 42: 100, 43: 100 } }); // a table of 5: two real players, three demo seats
  await bots.start();
  bots.stop();

  const room = manager.joinStake({ id: 42, first_name: 'Sara' }, 10);
  manager.joinStake({ id: 43, first_name: 'Kal' }, 10);
  room.choose(42, 5);
  room.choose(42, 6);
  room.choose(43, 7);
  until(step, () => [...room.players.keys()].filter(isDemoId).length >= 2 && [...room.players.values()].filter((p) => isDemoId(p.id) && p.cards.length).length >= 2);
  room.start();
  const tickets = room.tickets;
  const pool = room.pool;
  assert.equal(pool, tickets * 10 * 0.8);

  // Sara's connection drops: mid-round that forfeits her 20 ETB to the pool being played for.
  manager.leave(42);
  assert.equal(store.balance(42), 80);

  until(() => {
    step();
    if (room.phase === PHASE.PLAYING) room.callNext();
  }, () => room.phase === PHASE.FINISHED);
  assert.ok(isDemoId(room.winner.id));

  // A demo player won: both real players get their stakes back, the one who left included.
  assert.equal(store.balance(42), 100);
  assert.equal(store.balance(43), 100);

  // The record adds up: every cartela that built the pool is listed, prize = stakes less 20 %.
  const round = store.rounds.at(-1);
  const listed = round.players.reduce((n, p) => n + p.cartelas.length, 0);
  assert.equal(listed, tickets);
  assert.equal(round.stakes, tickets * 10);
  assert.equal(round.prize, round.stakes * 0.8);
  assert.equal(round.demoStakes, (tickets - 3) * 10);
  assert.equal(round.players.find((p) => p.id === 42).left, true);
  assert.equal(round.realStakes, 0); // refunded
  assert.equal(round.houseTake, 0);
  manager.shutdown();
});

test('between real players a mid-round leaver still forfeits, and the house take is 20 % of all stakes', () => {
  const store = fakeStore({ 1: 100, 2: 100, 3: 100 });
  const wallet = { charge: (id, amount, note) => store.adjust(id, -amount, note) !== null, credit: (id, amount, note) => void store.adjust(id, amount, note) };
  const manager = new RoomManager({ emit() {}, emitTo() {}, wallet, stats: { recordRound: (r) => store.rounds.push(r) }, stakes: [10], isDemo: isDemoId });
  const room = manager.joinStake({ id: 1, first_name: 'A' }, 10);
  manager.joinStake({ id: 2, first_name: 'B' }, 10);
  manager.joinStake({ id: 3, first_name: 'C' }, 10);
  room.choose(1, 1);
  room.choose(2, 2);
  room.choose(3, 3);
  room.start();
  manager.leave(3); // forfeits 10
  room.finish(room.players.get(1));
  assert.equal(store.balance(3), 90);
  assert.equal(store.balance(1), 90 + 24);
  const round = store.rounds.at(-1);
  assert.deepEqual([round.stakes, round.demoStakes, round.prize, round.houseTake], [30, 0, 24, 6]);
  assert.equal(round.players.length, 3);
  manager.shutdown();
});

test('demo names are Ethiopian, many with emojis or in Amharic script, and existing demo players are renamed once', async () => {
  const names = Array.from({ length: 400 }, () => randomName());
  assert.ok(names.every((n) => n.length >= 2 && n.length <= 32));
  assert.ok(names.filter((n) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(n)).length > 150); // roughly two in three
  assert.ok(names.some((n) => /\p{Script=Ethiopic}/u.test(n)));
  assert.ok(names.some((n) => /^[A-Za-z]/.test(n)));

  const { store, bots, manager } = setup({ count: 3 });
  await store.setProfile(-1001, { name: 'Old Style', username: null }); // created before the new names
  await bots.start();
  bots.stop();
  assert.notEqual(store.profile(-1001).name, 'Old Style');
  assert.equal(store.profile(-1001).username, 'demo_player_v2');
  const renamed = store.profile(-1001).name;

  const again = createDemoBots({ manager, store, stakes: [10], count: 3, log() {} });
  await again.start();
  again.stop();
  assert.equal(store.profile(-1001).name, renamed); // stable from then on
  manager.shutdown();
});

test('DEMO_BOTS_SHARE=0.9: demo players take nine cartelas for each real one, and the draw stays fair', async () => {
  const { store, bots, manager, step } = setup({ count: 12, balances: { 42: 1000 }, share: 0.9, perRoom: 3 });
  await bots.start();
  bots.stop();
  const room = manager.joinStake({ id: 42, first_name: 'Sara' }, 10);
  room.choose(42, 5);
  room.choose(42, 6);
  const demoTickets = () => [...room.players.values()].filter((p) => isDemoId(p.id)).reduce((n, p) => n + p.cards.length, 0);
  until(step, () => demoTickets() >= 18, 120); // 9 x her 2, inside two minutes of registration
  assert.ok(demoTickets() >= 18 && demoTickets() <= 22, `demo cartelas ${demoTickets()}`); // at least 9 to 1, a pick or two over at most
  assert.ok([...room.players.values()].every((p) => p.cards.length <= 4));
  assert.ok([...room.players.keys()].filter(isDemoId).length > 3); // more seats than DEMO_BOTS_PER_ROOM when the share needs them

  // Nothing about who wins is decided by the bots: the draw order is the room's own shuffle, and
  // a demo player can only claim what its marks really show.
  room.start();
  const order = [...room.drawPool];
  for (let i = 0; i < 5; i++) step();
  assert.deepEqual(room.drawPool, order); // the numbers still to come are exactly the room's own shuffle
  assert.throws(() => room.claim(bots.bots.find((b) => room.players.has(b.id)).id), /Not yet/);
  manager.shutdown();
});

test('one demo table per stake, filled to DEMO_BOTS_PER_ROOM players; real players count towards the size', async () => {
  const store = fakeStore({ 42: 500 });
  const wallet = { charge: (id, amount, note) => store.adjust(id, -amount, note) !== null, credit: (id, amount, note) => void store.adjust(id, amount, note) };
  const manager = new RoomManager({ emit() {}, emitTo() {}, wallet, stakes: [10, 20, 50], isDemo: isDemoId, rules: { minPlayers: 2, maxPlayers: 34, countdownMs: 3_600_000, callIntervalMs: 3_600_000, restartDelayMs: 3_600_000 } });
  let clock = 9_000_000;
  const bots = createDemoBots({ manager, store, stakes: [10, 20, 50], count: 120, perRoom: 30, now: () => clock, log() {} });
  await bots.start();
  bots.stop();
  const tick = (n) => {
    for (let i = 0; i < n; i++) {
      clock += 1000;
      bots.tick();
    }
  };
  tick(240);
  const tables = [...manager.rooms.values()];
  assert.equal(tables.length, 3); // one per stake, never a second one beside it
  assert.deepEqual(tables.map((r) => r.stake).sort((a, b) => a - b), [10, 20, 50]);
  for (const room of tables) assert.equal(room.players.size, 30, `table ${room.stake}: ${room.players.size}`);
  assert.equal(bots.bots.filter((b) => !manager.roomOf(b.id)).length, 30); // a table's worth stays free for real players

  // A real player opens a fresh table (the running ones are mid-round): it fills to 30 in all.
  for (const room of tables) room.start();
  const mine = manager.joinStake({ id: 42, first_name: 'Sara' }, 10);
  assert.ok(!tables.includes(mine));
  mine.choose(42, 5);
  tick(60);
  assert.equal(mine.players.size, 30);
  assert.equal([...mine.players.keys()].filter(isDemoId).length, 29);
  manager.shutdown();
});
