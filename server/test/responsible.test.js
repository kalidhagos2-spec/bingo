import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentStore, MAX_PENDING_DEPOSITS } from '../src/store.js';
import { commitOf, drawOrderFromSeed, newSeed } from '../src/game/bingo.js';
import { freshPool } from './helpers/pg.js';

// These need Postgres like the rest of the store tests (TEST_DATABASE_URL).
async function freshStore(t, opts = {}) {
  const { pool } = await freshPool(t);
  const store = new PaymentStore(pool, opts);
  await store.load();
  return store;
}

test('limits and self-exclusion are persisted with the profile and block deposits', async (t) => {
  const store = await freshStore(t);
  await store.setDepositLimit(5, 300);
  const first = await store.createTransaction({ userId: 5, method: 'telebirr', amount: 200, currency: 'ETB' });
  assert.ok(first);
  await assert.rejects(() => store.assertCanDeposit(5, 150), /daily deposit limit of 300/);
  await store.assertCanDeposit(5, 100);
  await store.selfExclude(5, 7);
  assert.ok(store.selfExclusion(5));
  await assert.rejects(() => store.assertCanDeposit(5, 1), /excluded yourself/);
  await store.flush();
  const reloaded = new PaymentStore(store.pool, {});
  await reloaded.load();
  assert.ok(reloaded.selfExclusion(5));
  assert.equal(reloaded.limits(5).depositLimit, 300);
});

test('age confirmation is remembered', async (t) => {
  const store = await freshStore(t);
  assert.equal(store.ageConfirmed(9), false);
  await store.confirmAge(9);
  assert.equal(store.ageConfirmed(9), true);
});

test('one player cannot have more than a handful of unconfirmed deposits waiting', async (t) => {
  const store = await freshStore(t);
  for (let i = 0; i < MAX_PENDING_DEPOSITS; i++) await store.submitDeposit({ userId: 4, method: 'telebirr', amount: 10, txId: `RECEIPT${i}AB` });
  await assert.rejects(() => store.submitDeposit({ userId: 4, method: 'telebirr', amount: 10, txId: 'RECEIPTXTRA1' }), /waiting for confirmation/);
});

test('a recorded round is listed publicly with the proof needed to check it, and no player ids', async (t) => {
  const store = await freshStore(t);
  const seed = newSeed();
  const called = drawOrderFromSeed(seed).slice(0, 30);
  store.recordRound({
    participants: [1, 2], players: [{ id: 1, name: 'A', cartela: 3 }, { id: 2, name: 'B', cartela: 4 }], winnerId: 1,
    winner: { id: 1, name: 'A', cartela: 3, line: [0, 1, 2, 3, 4], numbers: called.slice(0, 4), ball: called[3], ballCall: 4 },
    prize: 16, stake: 10, stakes: 20, room: 'ABCD', round: 1, numbersCalled: 30, called, seed, commit: commitOf(seed),
  });
  await store.flush();
  const [round] = await store.publicRounds(10);
  assert.equal(round.seed, seed);
  assert.equal(round.commit, commitOf(seed));
  assert.deepEqual(round.called, called);
  assert.equal(round.winner.name, 'A');
  assert.equal('id' in round.winner, false);
  const [again] = await store.publicRounds(1, round.id);
  assert.equal(again.id, round.id);
});

test('a referral pays both players coins once, when the invited player\'s first big deposit is confirmed', async (t) => {
  const store = await freshStore(t);
  await store.setProfile(1, { name: 'Inviter', phone: '+251900000001', signedUpAt: new Date().toISOString() });
  await store.setReferrer(2, 1);
  assert.equal(store.referral(2).invitedBy, 1);
  const first = await store.createTransaction({ userId: 2, method: 'telebirr', amount: 100, currency: 'ETB' });
  await store.markPaid(first.ref, 'P1');
  assert.equal(store.coins(2), 100);
  assert.equal(store.coins(1), 100);
  assert.equal(store.referral(1).friendsRewarded, 1);
  const second = await store.createTransaction({ userId: 2, method: 'telebirr', amount: 100, currency: 'ETB' });
  await store.markPaid(second.ref, 'P2');
  assert.equal(store.coins(1), 100, 'no second reward for the same friend');
});
