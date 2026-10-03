import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { PaymentStore, STATUS } from '../src/store.js';
import { adminRouter } from '../src/routes/admin.js';
import { createSandboxPayout } from '../src/payouts/sandbox.js';
import { createPayoutWatcher } from '../src/payouts/watcher.js';
import { freshPool } from './helpers/pg.js';

// Store rows are stamped with the real clock, so the virtual one starts there and only moves forward.
const clock = (start = Date.now()) => {
  let t = start;
  return { now: () => t, tick: (ms) => (t += ms) };
};

/** The admin API over a real store, with the sandbox gateway (or none) and a fake Telebirr receipt page. */
async function serve(t, { gateway = true, delayMs = 10_000, maxAutoPayout = 2000, receiptOk = false } = {}) {
  const { pool } = await freshPool(t);
  const store = new PaymentStore(pool, { withdrawFeePercent: 2 });
  await store.load();
  await store.setProfile(42, { name: 'Sara' });
  store.adjust(42, 1000, 'seed');
  const c = clock();
  const sandbox = gateway ? createSandboxPayout({ delayMs, now: c.now }) : null;
  let sends = 0;
  const payout = sandbox && { ...sandbox, send: (args) => (sends++, sandbox.send(args)) };
  const notified = [];
  const watcher = createPayoutWatcher({ store, payout, intervalMs: 0, minAgeMs: 0, now: c.now, log: { warn() {} }, onSettled: (tx) => notified.push(tx) });
  const receiptFetch = async () => ({ ok: receiptOk, status: receiptOk ? 200 : 404, text: async () => (receiptOk ? 'Transaction Number ABC12345XY Amount 49.00 Birr 251911000001' : '') });
  const app = express();
  app.use('/api/admin', adminRouter({ config: { adminToken: 'op-secret', currency: 'ETB', maxAutoPayout, payout: {} }, store, payout, payoutWatcher: watcher, notifyWithdrawal: (tx) => notified.push(tx), receiptFetch }));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/admin/withdrawals`;
  const post = (ref, action, body = {}, token = 'op-secret') =>
    fetch(`${base}/${ref}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': token }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
  const request = (account, amount = 50, method = 'telebirr') => store.requestWithdrawal({ userId: 42, method, amount, account });
  return { store, c, post, request, notified, sends: () => sends };
}

test('Approve sends through the gateway once, even when clicked twice; the status check settles it', async (t) => {
  const { store, c, post, request, notified, sends } = await serve(t);
  const tx = await request('+251911000011');
  assert.equal((await post(tx.ref, 'approve', {}, 'wrong'))[0], 401);

  const [a, b] = await Promise.all([post(tx.ref, 'approve'), post(tx.ref, 'approve')]);
  const statuses = [a[0], b[0]].sort();
  assert.deepEqual(statuses, [202, 409]);
  assert.match((a[0] === 409 ? a : b)[1].error, /already processing/);
  assert.equal(sends(), 1);
  const row = await store.findByRef(tx.ref);
  assert.deepEqual([row.status, row.payoutProvider, row.payoutAttempts, row.providerRef], [STATUS.PROCESSING, 'sandbox', 1, `SBX-${tx.ref}`]);
  assert.equal(notified.length, 0);
  assert.equal((await post(tx.ref, 'reject', { reason: 'no' }))[0], 409); // money may be on its way

  let [status, body] = await post(tx.ref, 'check');
  assert.equal(status, 200);
  assert.equal(body.status, 'processing');
  c.tick(10_000);
  [status, body] = await post(tx.ref, 'check');
  assert.deepEqual([status, body.status, body.verified], [200, 'paid', 'gateway']);
  assert.equal(store.balance(42), 950);
  assert.equal((await store.house()).balance, 1);
  assert.deepEqual(notified.map((n) => [n.ref, n.status]), [[tx.ref, 'paid']]);
  assert.equal((await post(tx.ref, 'approve'))[0], 409);
});

test('a refused transfer is failed and refunded; a transient refusal goes back to pending; a timeout is never re-sent', async (t) => {
  const { store, c, post, request, notified, sends } = await serve(t, { delayMs: 0 });

  const bad = await request('+251911000099');
  let [status, body] = await post(bad.ref, 'approve');
  assert.deepEqual([status, body.status], [200, 'failed']);
  assert.match(body.reason, /simulated failure/);
  assert.equal(store.balance(42), 1000);
  assert.deepEqual(notified.at(-1).status, 'failed');

  const later = await request('+251911000096');
  [status, body] = await post(later.ref, 'approve');
  assert.deepEqual([status, body.retryable], [409, true]);
  assert.match(body.error, /Transfer hours/);
  let row = await store.findByRef(later.ref);
  assert.deepEqual([row.status, row.payoutAttempts], [STATUS.PENDING, 1]);
  assert.equal(store.balance(42), 950); // the hold stays
  [status, body] = await post(later.ref, 'approve'); // trying again later is just Approve again
  assert.equal((await store.findByRef(later.ref)).payoutAttempts, 2);

  const slow = await serve(t, { delayMs: 10_000 });
  const unsure = await slow.request('+251911000097');
  [status, body] = await slow.post(unsure.ref, 'approve');
  assert.equal(status, 202);
  assert.match(body.warning, /Nothing is re-sent/);
  assert.equal(slow.sends(), 1);
  assert.equal((await slow.post(unsure.ref, 'approve'))[0], 409); // no second send
  assert.equal(slow.sends(), 1);
  slow.c.tick(10_000);
  [status, body] = await slow.post(unsure.ref, 'check');
  assert.equal(body.status, 'paid');
  assert.equal(sends(), 3); // bad, later, later again: every Approve that reached the gateway
});

test('the one-click limit asks for a confirmation; "Mark failed" needs a processing row and a reason', async (t) => {
  const { store, post, request, notified } = await serve(t, { maxAutoPayout: 40 });
  const big = await request('+251911000098', 100);
  let [status, body] = await post(big.ref, 'approve');
  assert.deepEqual([status, body.confirmRequired], [409, true]);
  assert.equal((await store.findByRef(big.ref)).status, STATUS.PENDING);
  [status] = await post(big.ref, 'approve', { force: true });
  assert.equal(status, 202);

  assert.equal((await post(big.ref, 'fail', { reason: 'x' }))[0], 400);
  const pendingOne = await request('+251911000011', 10);
  assert.equal((await post(pendingOne.ref, 'fail', { reason: 'nothing paid' }))[0], 409);
  [status, body] = await post(big.ref, 'fail', { reason: 'Chapa support confirmed nothing was paid' });
  assert.deepEqual([status, body.status, body.reason], [200, 'failed', 'Operator: Chapa support confirmed nothing was paid']);
  assert.equal(store.balance(42), 990); // the 100 refunded, the 10 still held
  assert.equal(notified.at(-1).status, 'failed');
  assert.equal((await post('NOPE', 'check'))[0], 404);
});

test('paid by hand: no gateway means a transaction id is required; Telebirr receipts are checked unless forced', async (t) => {
  const manual = await serve(t, { gateway: false });
  const tele = await manual.request('+251911000001');
  let [status, body] = await manual.post(tele.ref, 'approve');
  assert.equal(status, 400);
  assert.match(body.error, /no payout gateway/);
  [status, body] = await manual.post(tele.ref, 'approve', { providerRef: 'ABC12345XY' });
  assert.equal(status, 409);
  assert.match(body.error, /^Receipt check failed/);
  [status, body] = await manual.post(tele.ref, 'approve', { providerRef: 'ABC12345XY', force: true });
  assert.deepEqual([status, body.status, body.verified, body.providerRef], [200, 'paid', 'operator', 'ABC12345XY']);
  assert.equal(manual.notified.at(-1).status, 'paid');
  const bank = await manual.request('1000223344', 50, 'boa');
  [status, body] = await manual.post(bank.ref, 'approve', { providerRef: 'FT24001' });
  assert.deepEqual([status, body.verified], [200, 'operator']); // no receipt page for banks
  assert.equal((await manual.post(bank.ref, 'check'))[0], 503); // nothing to ask without a gateway

  const verified = await serve(t, { gateway: false, receiptOk: true });
  const ok = await verified.request('+251911000001');
  [status, body] = await verified.post(ok.ref, 'approve', { providerRef: 'ABC12345XY' });
  assert.deepEqual([status, body.verified], [200, 'receipt']);

  // With a gateway, a stale processing row can still be settled by hand, but only with force.
  const gw = await serve(t);
  const stuck = await gw.request('+251911000098');
  await gw.post(stuck.ref, 'approve');
  assert.equal((await gw.post(stuck.ref, 'approve', { providerRef: 'ABC12345XY' }))[0], 409);
  [status, body] = await gw.post(stuck.ref, 'approve', { providerRef: 'ABC12345XY', force: true });
  assert.deepEqual([status, body.status, body.verified], [200, 'paid', 'operator']);
  [status, body] = await gw.post(ok.ref, 'reject', { reason: 'later' });
  assert.equal(status, 400); // not in this store
});
