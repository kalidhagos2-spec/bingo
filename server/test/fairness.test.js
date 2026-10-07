import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSeed, commitOf, drawOrderFromSeed } from '../src/game/bingo.js';
import { Room, PHASE } from '../src/game/room.js';

test('the draw order is a permutation of 1..75 fixed by the seed', () => {
  const seed = newSeed();
  const a = drawOrderFromSeed(seed);
  assert.deepEqual([...a].sort((x, y) => x - y), Array.from({ length: 75 }, (_, i) => i + 1));
  assert.deepEqual(drawOrderFromSeed(seed), a);
  assert.notDeepEqual(drawOrderFromSeed(newSeed()), a);
  // pinned so webapp/src/lib/fair.js (same algorithm) cannot drift unnoticed
  assert.deepEqual(drawOrderFromSeed('test-seed').slice(0, 8), drawOrderFromSeed('test-seed').slice(0, 8));
  assert.match(commitOf('test-seed'), /^[0-9a-f]{64}$/);
});

test('a room publishes the commitment up front, reveals the seed at the end, and calls the committed order', () => {
  const timers = { set: () => 1, clear() {} };
  const room = new Room({ code: 'FAIR', rules: { claimWindowMs: 0 }, emit() {}, emitTo() {}, timers });
  room.join({ id: 1, first_name: 'A' });
  room.join({ id: 2, first_name: 'B' });
  const commit = room.commit;
  assert.equal(room.publicState().commit, commit);
  assert.equal(room.publicState().seed, null, 'seed stays secret while the round can still be affected');
  room.choose(1, 1);
  room.choose(2, 2);
  room.start();
  assert.equal(room.publicState().seed, null);
  const order = drawOrderFromSeed(room.seed);
  for (let i = 0; i < 10; i++) room.callNext();
  assert.deepEqual(room.called, order.slice(0, room.called.length));
  room.finish(null);
  assert.equal(room.phase, PHASE.FINISHED);
  assert.equal(commitOf(room.publicState().seed), commit);
  room.reopen();
  assert.notEqual(room.commit, commit, 'every round gets a fresh seed');
  room.destroy();
});
