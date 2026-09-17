import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentStore, STATUS } from '../src/store.js';
import { freshPool } from './helpers/pg.js';

async function freshStore(t, opts = {}) {
  const { pool } = await freshPool(t);
  const store = new PaymentStore(pool, opts);
  await store.load();
  return store;
}

test('markPaid credits the wallet exactly once', async (t) => {
  const store = await freshStore(t);
  const tx = await store.createTransaction({ userId: 7, method: 'telebirr', amount: 50, currency: 'ETB' });
  assert.equal(tx.status, STATUS.PENDING);
  await store.markPaid(tx.ref, 'PROV-1');
  await store.markPaid(tx.ref, 'PROV-1'); // duplicate webhook delivery
  assert.equal(store.balance(7), 50);
  assert.equal((await store.findByRef(tx.ref)).providerRef, 'PROV-1');
});

test('a deposit fee is taken from confirmed top-ups and kept by the house', async (t) => {
  const store = await freshStore(t, { depositFeePercent: 2 });
  const tx = await store.createTransaction({ userId: 3, method: 'telebirr', amount: 100, currency: 'ETB' });
  const paid = await store.markPaid(tx.ref, 'PROV-9');
  assert.equal(paid.fee, 2);
  assert.equal(paid.credited, 98);
  assert.equal(store.balance(3), 98);
  await store.markPaid(tx.ref, 'PROV-9'); // duplicate webhook: no second fee
  assert.equal(store.balance(3), 98);
  assert.equal((await store.house()).balance, 2);
  assert.deepEqual((await store.house()).entries.map((e) => [e.type, e.ref, e.fee]), [['deposit', tx.ref, 2]]);
  const odd = await store.createTransaction({ userId: 3, method: 'boa', amount: 33.33, currency: 'ETB' });
  const paidOdd = await store.markPaid(odd.ref);
  assert.equal(paidOdd.fee, 0.67); // rounded to cents
  assert.equal(paidOdd.credited, 32.66);
});

test('deposits by pasted receipt id: one id once, credited with the fee on confirmation, or rejected', async (t) => {
  const store = await freshStore(t, { depositFeePercent: 2 });
  await assert.rejects(() => store.submitDeposit({ userId: 7, method: 'telebirr', amount: 100, txId: 'ab' }), /6–32 letters/);
  await assert.rejects(() => store.submitDeposit({ userId: 7, method: 'telebirr', amount: 0, txId: 'AB12CD34EF' }), /positive/);
  const d = await store.submitDeposit({ userId: 7, method: 'telebirr', amount: 100, txId: ' ab12cd34ef ', account: '0900000000' });
  assert.equal(d.status, STATUS.PENDING);
  assert.equal(d.providerRef, 'AB12CD34EF');
  assert.equal(store.balance(7), 0); // nothing until confirmed
  await assert.rejects(() => store.submitDeposit({ userId: 8, method: 'telebirr', amount: 100, txId: 'AB12CD34EF' }), /already been submitted/);
  assert.equal((await store.pendingDeposits()).length, 1);

  const paid = await store.resolveDeposit(d.ref, { approved: true, verified: 'operator' });
  assert.equal(paid.status, STATUS.PAID);
  assert.equal((await store.findByRef(d.ref)).verified, 'operator');
  assert.equal(store.balance(7), 98); // 2 % deposit fee applies
  assert.equal((await store.house()).balance, 2);
  await assert.rejects(() => store.resolveDeposit(d.ref, { approved: true }), /already paid/);

  const bad = await store.submitDeposit({ userId: 7, method: 'boa', amount: 50, txId: 'FT2609081234' });
  const rejected = await store.resolveDeposit(bad.ref, { approved: false, reason: 'Not on statement' });
  assert.equal(rejected.status, STATUS.REJECTED);
  assert.equal(rejected.reason, 'Not on statement');
  assert.equal(store.balance(7), 98);
  // A rejected id may be resubmitted (e.g. after a typo was corrected on our side).
  assert.equal((await store.submitDeposit({ userId: 7, method: 'boa', amount: 50, txId: 'FT2609081234' })).status, STATUS.PENDING);
  assert.equal((await store.adminSummary()).pendingDeposits.count, 1);
});

test('withdrawals hold the money, then pay out or refund', async (t) => {
  const store = await freshStore(t, { withdrawFeePercent: 1 });
  store.adjust(4, 200, 'seed');
  await store.flush();
  await assert.rejects(() => store.requestWithdrawal({ userId: 4, method: 'telebirr', amount: 500, account: '+251900000000' }), /Insufficient balance/);
  await assert.rejects(() => store.requestWithdrawal({ userId: 4, method: 'telebirr', amount: 0, account: '+251900000000' }), /positive/);

  const w1 = await store.requestWithdrawal({ userId: 4, method: 'telebirr', amount: 120, account: '+251900000000' });
  assert.equal(w1.status, STATUS.PENDING);
  assert.equal(w1.amount, -120);
  assert.equal(w1.fee, 1.2);
  assert.equal(w1.payout, 118.8);
  assert.equal(store.balance(4), 80); // held immediately
  assert.equal((await store.pendingWithdrawals()).length, 1);
  // The hold is not just in memory — it is on the wallets row too (see resolveWithdrawal's
  // reject path below, and the requestWithdrawal fix that made this true).
  const { rows: heldRow } = await store.pool.query('SELECT balance FROM wallets WHERE user_id = 4');
  assert.equal(heldRow[0].balance, 80);

  const paid = await store.resolveWithdrawal(w1.ref, { approved: true, providerRef: 'TB-1' });
  assert.equal(paid.status, STATUS.PAID);
  assert.equal(store.balance(4), 80);
  assert.equal((await store.house()).balance, 1.2);
  await assert.rejects(() => store.resolveWithdrawal(w1.ref, { approved: true }), /already paid/);

  const w2 = await store.requestWithdrawal({ userId: 4, method: 'boa', amount: 50, account: '1000000000' });
  assert.equal(store.balance(4), 30);
  const rejected = await store.resolveWithdrawal(w2.ref, { approved: false, reason: 'Account not found' });
  assert.equal(rejected.status, STATUS.REJECTED);
  assert.equal(rejected.reason, 'Account not found');
  assert.equal(store.balance(4), 80); // refunded
  const { rows: refundedRow } = await store.pool.query('SELECT balance FROM wallets WHERE user_id = 4');
  assert.equal(refundedRow[0].balance, 80); // refund reached Postgres, not just the in-memory mirror

  const w3 = await store.requestWithdrawal({ userId: 4, method: 'cbebirr', amount: 60, account: '0911222333' });
  const cancelled = await store.resolveWithdrawal(w3.ref, { approved: false, status: STATUS.CANCELLED, reason: 'Cancelled by player' });
  assert.equal(cancelled.status, STATUS.CANCELLED);
  assert.equal(store.balance(4), 80);
  assert.equal((await store.pendingWithdrawals()).length, 0);
  await assert.rejects(() => store.resolveWithdrawal('nope', { approved: true }), /not found/);
  const { rows } = await store.pool.query(`SELECT count(*)::int AS n FROM transactions WHERE type = 'withdraw'`);
  assert.equal(rows[0].n, 3);
});

test('a paid transaction cannot be downgraded to failed', async (t) => {
  const store = await freshStore(t);
  const tx = await store.createTransaction({ userId: 7, method: 'boa', amount: 20, currency: 'ETB' });
  await store.markPaid(tx.ref);
  await store.markFailed(tx.ref);
  assert.equal((await store.findByRef(tx.ref)).status, STATUS.PAID);
  assert.equal(store.balance(7), 20);
});

test('adminSummary totals player balances and pending cash-outs', async (t) => {
  const store = await freshStore(t);
  store.adjust(1, 100, 'seed');
  store.adjust(2, 40.5, 'seed');
  await store.setProfile(1, { name: 'A' });
  await store.requestWithdrawal({ userId: 1, method: 'telebirr', amount: 60, account: '+251900000000' });
  const s = await store.adminSummary();
  assert.equal(s.players, 1);
  assert.equal(s.walletLiabilities, 80.5); // 40 + 40.5 after the 60 hold
  assert.deepEqual(s.pendingWithdrawals, { count: 1, amount: 60 });
  assert.equal(s.houseBalance, 0);
  await store.flush();
});

test('transfer moves money between wallets at once and writes both ledger rows', async (t) => {
  const store = await freshStore(t);
  await store.setProfile(1, { name: 'Abebe', phone: '+251900000001' });
  await store.setProfile(2, { name: 'Sara', phone: '+251900000002' });
  store.adjust(1, 100, 'seed');
  assert.deepEqual(store.playerByPhone('+251900000002').name, 'Sara');
  assert.equal(store.playerByPhone('+251900000009'), null);
  assert.throws(() => store.transfer({ fromId: 1, toId: 2, amount: 150 }), /Insufficient balance/);
  assert.throws(() => store.transfer({ fromId: 1, toId: 1, amount: 10 }), /yourself/);
  assert.throws(() => store.transfer({ fromId: 1, toId: 2, amount: 0 }), /positive/);
  const r = store.transfer({ fromId: 1, toId: 2, amount: 40.5, note: 'Transfer Abebe → Sara' });
  assert.deepEqual([r.senderBalance, r.recipientBalance], [59.5, 40.5]);
  assert.deepEqual([store.balance(1), store.balance(2)], [59.5, 40.5]);
  await store.flush();
  const { rows } = await store.pool.query(`SELECT user_id, amount, type, status FROM transactions WHERE type = 'transfer' ORDER BY user_id`);
  assert.deepEqual(rows, [
    { user_id: 1, amount: -40.5, type: 'transfer', status: 'paid' },
    { user_id: 2, amount: 40.5, type: 'transfer', status: 'paid' },
  ]);
  const wallets = await store.pool.query('SELECT user_id, balance FROM wallets ORDER BY user_id');
  assert.deepEqual(wallets.rows, [{ user_id: 1, balance: 59.5 }, { user_id: 2, balance: 40.5 }]);
  assert.equal((await store.transactionsFor(2)).filter((x) => x.type === 'transfer').length, 1);
});

test('a deposit keeps the optional sender phone and receipt name', async (t) => {
  const store = await freshStore(t);
  const tx = await store.submitDeposit({ userId: 1, method: 'telebirr', amount: 40, txId: 'ABCDEF1234', account: '0960524040', payerPhone: '+251911000001', payerName: '  Sara Tesfaye  ' });
  assert.equal(tx.payerPhone, '+251911000001');
  assert.equal(tx.payerName, 'Sara Tesfaye');
  const stored = await store.findByRef(tx.ref);
  assert.deepEqual([stored.payerPhone, stored.payerName], ['+251911000001', 'Sara Tesfaye']);
  const bare = await store.submitDeposit({ userId: 1, method: 'telebirr', amount: 40, txId: 'ABCDEF5678', account: '0960524040' });
  assert.deepEqual([bare.payerPhone, bare.payerName], [null, null]);
  await store.flush();
});

test('adminPlayers merges profiles and wallets, with search', async (t) => {
  const store = await freshStore(t);
  await store.setProfile(1, { name: 'Abebe', phone: '+251900000000', email: 'abebe@example.com' });
  store.adjust(1, 120, 'seed');
  store.adjust(2, 5, 'seed'); // wallet only, no profile yet
  await store.setProfile(3, { email: 'sara@example.com', name: 'sara' }); // profile only, no wallet yet
  const all = await store.adminPlayers();
  assert.deepEqual(all.map((p) => p.id).sort((a, b) => a - b), [1, 2, 3]);
  const abebe = all.find((p) => p.id === 1);
  assert.equal(abebe.balance, 120);
  assert.equal(abebe.coins, 0);
  assert.ok(abebe.lastActivity);
  assert.equal(all.find((p) => p.id === 2).name, null);
  assert.deepEqual((await store.adminPlayers('sara')).map((p) => p.id), [3]);
  assert.deepEqual((await store.adminPlayers('+2519')).map((p) => p.id), [1]);
  assert.equal((await store.adminPlayers('nobody')).length, 0);
  await store.flush();
});

test('suspensions block until they expire or are lifted', async (t) => {
  const T0 = Date.UTC(2026, 8, 8);
  const store = await freshStore(t, { now: () => T0 }); // pin the clock: adminPlayers() judges expiry with it
  assert.equal(store.suspension(5, T0), null);
  const s = store.suspend(5, { reason: 'Chargeback', days: 7 }, T0);
  assert.equal(s.until, '2026-09-15T00:00:00.000Z');
  assert.equal(store.suspension(5, T0 + 86_400_000).reason, 'Chargeback');
  assert.equal(store.suspension(5, T0 + 8 * 86_400_000), null); // expired
  assert.equal((await store.adminPlayers()).find((p) => p.id === 5).suspended.reason, 'Chargeback');
  store.suspend(6, { reason: 'Fraud' }, T0); // permanent
  assert.equal(store.suspension(6, T0 + 365 * 86_400_000).until, null);
  assert.equal(store.unsuspend(6), true);
  assert.equal(store.unsuspend(6), false);
  assert.equal(store.suspension(6, T0), null);
  await store.flush(); // let the background profile writes finish before the schema is dropped
});

test('a failing background write does not block later writes', async (t) => {
  const store = await freshStore(t);
  await assert.rejects(() => store._enqueue(() => { throw new Error('boom'); }), /boom/);
  const tx = await store.createTransaction({ userId: 1, method: 'telebirr', amount: 5, currency: 'ETB' });
  assert.equal((await store.findByRef(tx.ref)).amount, 5);
});

test('concurrent writes are serialised and persisted', async (t) => {
  const store = await freshStore(t);
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      store.createTransaction({ userId: 1, method: 'cbebirr', amount: i + 1, currency: 'ETB' }),
    ),
  );
  const { rows } = await store.pool.query(`SELECT ref FROM transactions WHERE user_id = 1`);
  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map((r) => r.ref)).size, 10);
});

test('transactionsFor is per user and newest first', async (t) => {
  const store = await freshStore(t);
  const a = await store.createTransaction({ userId: 1, method: 'boa', amount: 10, currency: 'ETB' });
  await store.createTransaction({ userId: 2, method: 'boa', amount: 10, currency: 'ETB' });
  await store.update(a.ref, { createdAt: '2000-01-01T00:00:00.000Z' });
  const b = await store.createTransaction({ userId: 1, method: 'boa', amount: 15, currency: 'ETB' });
  assert.deepEqual(
    (await store.transactionsFor(1)).map((t) => t.ref),
    [b.ref, a.ref],
  );
});

test('adjust moves money synchronously, refuses overdrafts, and persists a game ledger entry', async (t) => {
  const store = await freshStore(t);
  assert.equal(store.adjust(5, -10, 'Stake'), null);
  assert.equal(store.balance(5), 0);
  assert.equal(store.adjust(5, 30, 'Prize for room ABCD'), 30);
  assert.equal(store.adjust(5, -10, 'Stake for room ABCD'), 20);
  assert.equal(store.balance(5), 20); // synchronous and correct immediately
  // The ledger entries themselves go through the background write queue (no in-memory
  // mirror for transactions — see store.js), so wait for it before reading them back.
  await store.flush();
  const entries = await store.transactionsFor(5);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((t) => [t.method, t.amount, t.status]).sort(), [['game', -10, STATUS.PAID], ['game', 30, STATUS.PAID]]);
  const { rows: walletRows } = await store.pool.query('SELECT balance FROM wallets WHERE user_id = 5');
  assert.equal(walletRows[0].balance, 20);
  const { rows: txRows } = await store.pool.query(`SELECT count(*)::int AS n FROM transactions WHERE user_id = 5`);
  assert.equal(txRows[0].n, 2);
});
