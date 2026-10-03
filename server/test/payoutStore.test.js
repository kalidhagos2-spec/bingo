import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentStore, STATUS } from '../src/store.js';
import { freshPool } from './helpers/pg.js';

async function freshStore(t) {
  const { pool } = await freshPool(t);
  const store = new PaymentStore(pool, { withdrawFeePercent: 2 });
  await store.load();
  return { store, pool };
}

const dbBalance = async (pool, userId) => (await pool.query('SELECT balance FROM wallets WHERE user_id = $1', [userId])).rows[0]?.balance ?? null;

test('gateway cash-outs: pending -> processing -> paid, with the fee booked exactly once', async (t) => {
  const { store, pool } = await freshStore(t);
  store.adjust(7, 100, 'seed');
  const tx = await store.requestWithdrawal({ userId: 7, method: 'telebirr', amount: 50, account: '+251911000001' });
  assert.deepEqual([tx.fee, tx.payout, store.balance(7)], [1, 49, 50]);

  const begun = await store.beginPayout(tx.ref, { provider: 'sandbox' });
  assert.equal(begun.status, STATUS.PROCESSING);
  assert.equal(begun.payoutProvider, 'sandbox');
  assert.equal(begun.payoutAttempts, 1);
  assert.ok(begun.payoutStartedAt);
  assert.equal((await store.findByRef(tx.ref)).status, STATUS.PROCESSING); // persisted

  // The double-click guard, and no reject/cancel while the money may be on its way.
  await assert.rejects(store.beginPayout(tx.ref, { provider: 'sandbox' }), /Withdrawal already processing/);
  await assert.rejects(store.resolveWithdrawal(tx.ref, { approved: false, reason: 'x' }), /Withdrawal already processing/);
  await assert.rejects(store.resolveWithdrawal(tx.ref, { approved: true, providerRef: 'x' }), /Withdrawal already processing/);

  let noted = await store.recordPayoutCheck(tx.ref, { note: 'queued at sandbox', providerRef: 'SBX-1' });
  assert.equal(noted.autoCheck, 'queued at sandbox');
  assert.equal(noted.providerRef, 'SBX-1');
  assert.ok(noted.payoutLastCheckAt);
  noted = await store.recordPayoutCheck(tx.ref, { note: 'still queued' });
  assert.equal(noted.providerRef, 'SBX-1'); // COALESCE keeps the reference

  const paid = await store.completePayout(tx.ref, { providerRef: 'SBX-1-final' });
  assert.deepEqual([paid.status, paid.verified, paid.providerRef], [STATUS.PAID, 'gateway', 'SBX-1-final']);
  assert.equal(store.balance(7), 50);
  await store.flush();
  assert.equal(await dbBalance(pool, 7), 50);
  const house = await store.house();
  assert.equal(house.balance, 1);
  assert.deepEqual(house.entries.map((e) => [e.type, e.ref, e.fee]), [['withdraw', tx.ref, 1]]);
  await assert.rejects(store.completePayout(tx.ref, { providerRef: 'again' }), /Withdrawal already paid/);
  assert.equal((await store.house()).balance, 1); // no second fee
  assert.equal(await store.recordPayoutCheck('NOPE', { note: 'x' }), null);
});

test('a failed transfer refunds the hold; a transient refusal puts the cash-out back to pending', async (t) => {
  const { store, pool } = await freshStore(t);
  store.adjust(8, 100, 'seed');
  const tx = await store.requestWithdrawal({ userId: 8, method: 'boa', amount: 40, account: '1000123456' });
  assert.equal(store.balance(8), 60);
  await assert.rejects(store.failPayout(tx.ref, { reason: 'x' }), /Withdrawal already pending/); // only from processing
  await assert.rejects(store.revertPayout(tx.ref), /Withdrawal already pending/);

  await store.beginPayout(tx.ref, { provider: 'chapa' });
  const back = await store.revertPayout(tx.ref, { note: 'Chapa: Transfer hours are Mon-Sat' });
  assert.equal(back.status, STATUS.PENDING);
  assert.equal(back.autoCheck, 'Chapa: Transfer hours are Mon-Sat');
  assert.equal(back.payoutAttempts, 1);
  assert.equal(store.balance(8), 60); // the hold stays

  const again = await store.beginPayout(tx.ref, { provider: 'chapa' });
  assert.equal(again.payoutAttempts, 2);
  assert.equal(again.autoCheck, null);
  const failed = await store.failPayout(tx.ref, { reason: 'Chapa: invalid account', providerRef: 'CH-9' });
  assert.deepEqual([failed.status, failed.reason, failed.providerRef], [STATUS.FAILED, 'Chapa: invalid account', 'CH-9']);
  assert.equal(store.balance(8), 100);
  await store.flush();
  assert.equal(await dbBalance(pool, 8), 100);
  assert.equal((await store.house()).balance, 0);
  await assert.rejects(store.failPayout(tx.ref, { reason: 'twice' }), /Withdrawal already failed/);
  assert.equal(store.balance(8), 100); // never refunded twice
});

test('a payout made by hand completes straight from pending; markFailed refuses cash-outs', async (t) => {
  const { store } = await freshStore(t);
  store.adjust(9, 100, 'seed');
  const tx = await store.requestWithdrawal({ userId: 9, method: 'telebirr', amount: 30, account: '+251911000002' });
  const paid = await store.completePayout(tx.ref, { providerRef: 'ABC12345XY', verified: 'receipt' });
  assert.deepEqual([paid.status, paid.verified, paid.payoutProvider, paid.payoutAttempts], [STATUS.PAID, 'receipt', null, 0]);
  assert.equal((await store.house()).balance, 0.6);

  const other = await store.requestWithdrawal({ userId: 9, method: 'telebirr', amount: 20, account: '+251911000002' });
  await assert.rejects(store.markFailed(other.ref), /failPayout/);
  assert.equal((await store.findByRef(other.ref)).status, STATUS.PENDING);
  await store.beginPayout(other.ref, { provider: 'sandbox' });
  const summary = await store.adminSummary();
  assert.deepEqual(summary.processingWithdrawals, { count: 1, amount: 20 });
  assert.deepEqual(summary.pendingWithdrawals, { count: 0, amount: 0 });
  assert.equal((await store.withdrawalsByStatus('processing')).length, 1);
});
