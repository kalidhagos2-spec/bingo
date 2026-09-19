import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../src/game/manager.js';
import { PHASE } from '../src/game/room.js';
import { createDemoBots, isDemoId } from '../src/demoBots.js';

/** A virtual clock: timers fire when `advance` moves time past them. */
function virtualClock(start = 1_000_000) {
  let t = start;
  let id = 0;
  const pending = new Map();
  return {
    now: () => t,
    timers: {
      set: (fn, ms) => (pending.set(++id, { fn, at: t + ms, ms }), id),
      clear: (key) => pending.delete(key),
    },
    pending,
    advance(ms, each = () => {}) {
      const end = t + ms;
      while (t < end) {
        t += 100;
        for (const [key, timer] of [...pending]) {
          if (timer.at > t || !pending.has(key)) continue;
          pending.delete(key);
          timer.fn();
        }
        each(t);
      }
    },
  };
}

test('the caller holds the next ball when the last one completed a cartela, and only then', () => {
  const clock = virtualClock();
  const manager = new RoomManager({ emit() {}, emitTo() {}, ...clock, rules: { callIntervalMs: 4000, claimWindowMs: 6000 } });
  const room = manager.joinStake({ id: 1, first_name: 'A' }, 0);
  manager.joinStake({ id: 2, first_name: 'B' }, 0);
  room.choose(1, 1);
  room.choose(2, 2);
  room.start();
  const waits = [];
  while (room.phase === PHASE.PLAYING && room.drawPool.length) {
    const wait = [...clock.pending.values()].at(-1).ms; // the timer set by the call just made
    waits.push({ ball: room.called.at(-1), wait, completes: room.completesACard(room.called.at(-1)) });
    room.callNext();
  }
  assert.ok(waits.some((w) => w.completes), 'some ball completed a card');
  for (const w of waits) assert.equal(w.wait, w.completes ? 10_000 : 4_000, `ball ${w.ball}`);
  // a card that was already complete does not hold later balls again ("this very ball made it")
  assert.ok(waits.filter((w) => w.completes).length < waits.length / 2);
  manager.shutdown();
});

test('with the claim window, every game ends on the ball that won it (25 rounds of demo players in real time)', async () => {
  const clock = virtualClock();
  const rounds = [];
  const balances = {};
  const store = {
    profile: () => null,
    setProfile: async () => {},
    balance: (id) => balances[id] ?? 0,
    adjust: (id, delta) => ((balances[id] = (balances[id] ?? 0) + delta), balances[id]),
  };
  const wallet = { charge: (id, amount) => store.adjust(id, -amount) !== null, credit: (id, amount) => void store.adjust(id, amount) };
  const manager = new RoomManager({ emit() {}, emitTo() {}, ...clock, wallet, stats: { recordRound: (r) => rounds.push(r) }, stakes: [10], isDemo: isDemoId, rules: { minPlayers: 2, maxPlayers: 20, countdownMs: 5000, callIntervalMs: 4000, claimWindowMs: 6000, restartDelayMs: 2000 } });
  const bots = createDemoBots({ manager, store, stakes: [10], count: 12, perRoom: 12, churn: 0, now: clock.now, log() {} });
  await bots.start();
  bots.stop(); // driven by the virtual clock below, at the real 700 ms beat
  let last = 0;
  for (let guard = 0; rounds.length < 25 && guard < 4000; guard++) {
    clock.advance(1000, (t) => {
      if (t - last >= 700) {
        last = t;
        bots.tick();
      }
    });
  }
  assert.equal(rounds.length >= 25, true, `only ${rounds.length} rounds`);
  for (const r of rounds) {
    assert.ok(r.winner, 'a winner');
    assert.equal(r.winner.ball, r.called.at(-1), `room ${r.room} round ${r.round}: won with ${r.winner.ball} but the last ball was ${r.called.at(-1)}`);
    assert.equal(r.winner.ballCall, r.called.length);
    assert.ok(r.winner.numbers.includes(r.winner.ball));
  }
  manager.shutdown();
});

test('a late BINGO is still paid, and the record names the ball that really won it', () => {
  const clock = virtualClock();
  const rounds = [];
  const manager = new RoomManager({ emit() {}, emitTo() {}, ...clock, stats: { recordRound: (r) => rounds.push(r) } });
  const room = manager.joinStake({ id: 1, first_name: 'A' }, 0);
  manager.joinStake({ id: 2, first_name: 'B' }, 0);
  room.choose(1, 1);
  room.choose(2, 2);
  room.start();
  const card = room.players.get(1).cards[0];
  const canWin = () => room.progress(room.players.get(1)).cards.some((c) => c.canClaim);
  while (!canWin()) {
    room.callNext();
    for (const n of room.called) if (card.cells.some((c) => c.value === n)) room.mark(1, n);
  }
  const wonOn = room.called.length;
  room.callNext(); // she sleeps through two more balls
  room.callNext();
  room.claim(1);
  const r = rounds.at(-1);
  assert.equal(r.winner.id, 1);
  assert.equal(r.winner.ballCall, wonOn);
  assert.equal(r.winner.ball, r.called[wonOn - 1]);
  assert.equal(r.called.length, wonOn + 2);
  manager.shutdown();
});
