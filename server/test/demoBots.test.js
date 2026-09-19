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

test('tables of 50+: a real player gets a full table within seconds, even when the free demo players are used up', async () => {
  const store = fakeStore({ 42: 500, 43: 500 });
  const wallet = { charge: (id, amount, note) => store.adjust(id, -amount, note) !== null, credit: (id, amount, note) => void store.adjust(id, amount, note) };
  const manager = new RoomManager({ emit() {}, emitTo() {}, wallet, stakes: [10, 20, 50], isDemo: isDemoId, rules: { minPlayers: 2, maxPlayers: 60, countdownMs: 3_600_000, callIntervalMs: 3_600_000, restartDelayMs: 3_600_000 } });
  let clock = 20_000_000;
  const bots = createDemoBots({ manager, store, stakes: [10, 20, 50], count: 224, perRoom: 56, now: () => clock, log() {} });
  await bots.start();
  bots.stop();
  const tick = (n) => {
    for (let i = 0; i < n; i++) {
      clock += 1000;
      bots.tick();
    }
  };
  tick(60);
  const demoTables = [...manager.rooms.values()];
  assert.equal(demoTables.length, 3);
  for (const room of demoTables) assert.ok(room.players.size >= 50, `table ${room.stake}: ${room.players.size}`);
  for (const room of demoTables) room.start();

  // First real player: the free demo players sit down with her at once.
  const hers = manager.joinStake({ id: 42, first_name: 'Sara' }, 10);
  hers.choose(42, 5);
  tick(15);
  assert.ok(hers.players.size >= 50, `her table: ${hers.players.size}`);
  assert.ok(hers.ready >= 50, `ready: ${hers.ready}`); // and they have their cartelas

  // Second real player, nobody free: when a demo table re-opens, its players move over.
  hers.start();
  const his = manager.joinStake({ id: 43, first_name: 'Kal' }, 20);
  his.choose(43, 9);
  tick(10);
  assert.ok(his.players.size < 50);
  demoTables[0].finish(null);
  demoTables[0].reopen();
  tick(15);
  assert.ok(his.players.size >= 50, `his table: ${his.players.size}`);
  manager.shutdown();
});

test('every win is proven by the balls: 40 full rounds, each winning number was called before the claim', async () => {
  const { store, bots, manager, step } = setup({ count: 12, perRoom: 12, share: 0.9, balances: { 42: 100000 } });
  await bots.start();
  bots.stop();
  const room = manager.joinStake({ id: 42, first_name: 'Sara' }, 10);
  let realWins = 0;
  for (let round = 0; round < 40; round++) {
    room.choose(42, 1 + (round % 300));
    until(step, () => room.ready >= 6, 200);
    room.start();
    while (room.phase === PHASE.PLAYING) {
      room.callNext();
      if (room.phase !== PHASE.PLAYING) break;
      // Sara plays properly on even rounds, so real and demo winners are both covered
      if (round % 2 === 0) {
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
      step();
    }
    const record = store.rounds.at(-1);
    assert.ok(record.winner, `round ${round} had a winner`);
    assert.ok(record.winner.numbers.length >= 4 && record.winner.numbers.length <= 5);
    for (const n of record.winner.numbers) assert.ok(record.called.includes(n), `round ${round}: ${n} was never called`);
    assert.equal(record.called.length, record.numbersCalled);
    assert.equal(new Set(record.called).size, record.called.length); // no ball twice
    // and the numbers really are a line (or the corners) of the winner's own cartela
    const card = (await import('../src/game/bingo.js')).cardForCartela(record.winner.cartela);
    assert.deepEqual(record.winner.line.map((i) => card[i].value).filter((v) => v !== null), record.winner.numbers);
    if (record.winner.id === 42) realWins++;
    room.reopen();
  }
  assert.ok(realWins >= 1, 'a real player who plays properly does win');
  manager.shutdown();
});

test('a claim is refused if any number of the line was not called, whatever the marks say', () => {
  const manager = new RoomManager({ emit() {}, emitTo() {}, isDemo: isDemoId });
  const room = manager.joinStake({ id: 1, first_name: 'A' }, 0);
  manager.joinStake({ id: 2, first_name: 'B' }, 0);
  room.choose(1, 1);
  room.choose(2, 2);
  room.start();
  const card = room.players.get(1).cards[0];
  for (const i of [0, 1, 2, 3, 4]) card.marks[i] = true; // marks forged past the server's own checks
  assert.throws(() => room.claim(1), /not been called/);
  assert.equal(room.phase, PHASE.PLAYING);
  manager.shutdown();
});

test('DEMO_BOTS_PER_ROOM takes a range: a table fills to a random size in it, drawn anew every round', async () => {
  const { demoRange } = await import('../src/config.js');
  assert.deepEqual(demoRange('20-30'), { count: 30, minCount: 20 });

  const store = fakeStore();
  const wallet = { charge: (id, amount, note) => store.adjust(id, -amount, note) !== null, credit: (id, amount, note) => void store.adjust(id, amount, note) };
  const manager = new RoomManager({ emit() {}, emitTo() {}, wallet, stakes: [10], isDemo: isDemoId, rules: { minPlayers: 2, maxPlayers: 60, countdownMs: 3_600_000, callIntervalMs: 3_600_000, restartDelayMs: 3_600_000 } });
  let clock = 9_000_000;
  let seed = 11;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const bots = createDemoBots({ manager, store, stakes: [10], count: 60, perRoom: 30, minPerRoom: 20, rng, now: () => clock, log() {} });
  await bots.start();
  bots.stop();
  const step = () => {
    clock += 1000;
    bots.tick();
  };

  const seen = [];
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < 90; i++) step(); // registration: the table fills (or thins out) to this round's size
    const room = [...manager.rooms.values()][0];
    assert.equal(manager.rooms.size, 1); // one demo table per stake, not a second one
    const size = [...room.players.keys()].filter(isDemoId).length;
    assert.ok(size >= 20 && size <= 30, `round ${round}: ${size} demo players`);
    seen.push(size);
    room.start();
    for (let i = 0; i < 400 && room.phase === PHASE.PLAYING; i++) {
      step();
      if (room.phase === PHASE.PLAYING) room.callNext();
    }
    assert.equal(room.phase, PHASE.FINISHED);
    room.reopen();
  }
  assert.ok(new Set(seen).size >= 3, `sizes ${seen.join(',')}`); // it really varies
  manager.shutdown();
});
