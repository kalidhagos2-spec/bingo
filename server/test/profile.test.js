import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentStore } from '../src/store.js';
import { Room } from '../src/game/room.js';
import { profileView, normalizePhone } from '../src/routes/profile.js';
import { freshPool } from './helpers/pg.js';

async function freshStore(t) {
  const { pool } = await freshPool(t);
  const store = new PaymentStore(pool);
  await store.load();
  return store;
}

test('profiles are created by sync, edited by the app, and persisted', async (t) => {
  const store = await freshStore(t);
  assert.equal(store.profile(9), null);
  const p = await store.setProfile(9, { name: 'Abebe', phone: '+251900000000', email: 'abebe@example.com', signedUpAt: '2026-09-07T00:00:00.000Z' });
  assert.equal(p.name, 'Abebe');
  assert.deepEqual(p.stats, { games: 0, wins: 0, winnings: 0 });
  await store.setProfile(9, { name: 'Abebe K' });
  assert.equal(store.profile(9).phone, '+251900000000'); // untouched fields survive a partial update
  const { rows } = await store.pool.query('SELECT name FROM profiles WHERE user_id = 9');
  assert.equal(rows[0].name, 'Abebe K');

  const view = profileView({ id: 9, first_name: 'Abebe', username: 'abebe' }, store.profile(9));
  assert.equal(view.complete, true);
  assert.equal(view.username, 'abebe');
  const noProfile = profileView({ id: 3, first_name: 'Sara', last_name: 'T' }, null);
  assert.equal(noProfile.name, 'Sara T');
  assert.equal(noProfile.complete, false);
});

test('the API normalises phones like the bot does', () => {
  assert.equal(normalizePhone('0900 000 000'), '+251900000000');
  assert.equal(normalizePhone('+251 90-000-0000'), '+251900000000');
  assert.equal(normalizePhone('251900000000'), '+251900000000');
  assert.equal(normalizePhone('12'), null);
});

test('round statistics feed the profile and the leaderboard', async (t) => {
  const store = await freshStore(t);
  await store.setProfile(1, { name: 'Abebe' });
  store.recordRound({ participants: [1, 2], winnerId: 1, prize: 16 });
  store.recordRound({ participants: [1, 2], winnerId: 2, prize: 16 });
  store.recordRound({ participants: [1, 2], winnerId: 1, prize: 8 });
  store.recordRound({ participants: [1, 2], winnerId: null, prize: 0 });
  assert.deepEqual(store.profile(1).stats, { games: 4, wins: 2, winnings: 24 });
  assert.deepEqual(store.profile(2).stats, { games: 4, wins: 1, winnings: 16 });
  const board = store.leaderboard();
  assert.deepEqual(board.map((l) => [l.id, l.name, l.wins]), [[1, 'Abebe', 2], [2, 'Player 2', 1]]);
  await store.flush();
  const { rows } = await store.pool.query(`SELECT stats FROM profiles WHERE user_id = 2`);
  assert.equal(rows[0].stats.games, 4);
});

test('a room reports its participants and winner to the stats hook', () => {
  const rounds = [];
  const timers = { set: () => 1, clear: () => {} };
  const room = new Room({ code: 'STAT', stake: 10, rules: { houseCutPercent: 20 }, emit() {}, emitTo() {}, timers, wallet: { charge: () => true, credit() {} }, stats: { recordRound: (r) => rounds.push(r) } });
  room.join({ id: 1, first_name: 'A' });
  room.join({ id: 2, first_name: 'B' });
  room.join({ id: 3, first_name: 'C' }); // never picks: spectator
  room.choose(1, 1);
  room.choose(2, 2);
  room.start();
  room.finish(room.players.get(2), null, true);
  assert.equal(rounds.length, 1);
  const r = rounds[0];
  assert.deepEqual([r.participants, r.winnerId, r.prize, r.stake, r.stakes, r.houseTake, r.room, r.round], [[1, 2], 2, 16, 10, 20, 4, 'STAT', 1]);
  assert.deepEqual(r.players.map((p) => [p.id, p.name, p.cartela, p.marked]), [[1, 'A', 1, 0], [2, 'B', 2, 0]]);
  assert.deepEqual([r.winner.id, r.winner.name, r.winner.cartela, r.winner.full, r.winner.line], [2, 'B', 2, true, null]);
  assert.equal(r.winner.numbers.length, 24); // a full card: every number on it is the proof
  assert.ok(Array.isArray(r.called));
  assert.equal(r.numbersCalled, 1);
  assert.equal(typeof r.startedAt, 'number');
  room.destroy();
});
