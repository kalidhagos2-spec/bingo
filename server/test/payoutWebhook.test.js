import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { PaymentStore, STATUS } from '../src/store.js';
import { paymentsRouter } from '../src/routes/payments.js';
import { createSandboxPayout } from '../src/payouts/sandbox.js';
import { createPayoutWatcher } from '../src/payouts/watcher.js';
import { freshPool } from './helpers/pg.js';

async function serve(t) {
  const { pool } = await freshPool(t);
  const store = new PaymentStore(pool);
  await store.load();
  store.adjust(5, 100, 'seed');
  const sandbox = createSandboxPayout({ delayMs: 3_600_000, webhookSecret: 's3cret' }); // nothing settles without the webhook
  let statusCalls = 0;
  const payout = { ...sandbox, status: (ref) => (statusCalls++, sandbox.status(ref)) };
  const settled = [];
  const watcher = createPayoutWatcher({ store, payout, intervalMs: 0, minAgeMs: 0, onSettled: (tx) => settled.push(tx), log: { warn() {} } });
  const app = express();
  app.use('/api/payments', paymentsRouter({ config: { currency: 'ETB', payout: {} }, store, providers: new Map(), auth: (_req, _res, next) => next(), payout, payoutWatcher: watcher }));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/payments/payout-webhook`;
  const hook = (provider, body, headers = {}) => fetch(`${base}/${provider}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
  return { store, sandbox, hook, settled, statusCalls: () => statusCalls };
}

test('a payout webhook is only a trigger: the gateway is asked, and its answer settles the cash-out', async (t) => {
  const { store, sandbox, hook, settled, statusCalls } = await serve(t);
  const tx = await store.requestWithdrawal({ userId: 5, method: 'telebirr', amount: 60, account: '+251911000098' });
  await store.beginPayout(tx.ref, { provider: 'sandbox' });
  await sandbox.send({ ref: tx.ref, amount: 60, method: 'telebirr', account: '+251911000098' });

  assert.equal((await hook('chapa', { ref: tx.ref, status: 'paid' }))[0], 404);
  assert.equal((await hook('sandbox', { ref: tx.ref, status: 'paid' }))[0], 400); // no secret
  assert.equal((await hook('sandbox', { ref: tx.ref, status: 'paid' }, { 'x-sandbox-secret': 'wrong' }))[0], 400);
  assert.equal((await store.findByRef(tx.ref)).status, STATUS.PROCESSING);
  assert.equal(statusCalls(), 0);

  const [status, body] = await hook('sandbox', { ref: tx.ref, status: 'paid' }, { 'x-sandbox-secret': 's3cret' });
  assert.deepEqual([status, body], [200, { received: true }]);
  assert.equal(statusCalls(), 1); // re-queried, not trusted
  const paid = await store.findByRef(tx.ref);
  assert.deepEqual([paid.status, paid.verified, paid.providerRef], [STATUS.PAID, 'gateway', `SBX-${tx.ref}`]);
  assert.deepEqual(settled.map((s) => s.status), ['paid']);
  assert.equal((await hook('sandbox', { ref: tx.ref, status: 'failed' }, { 'x-sandbox-secret': 's3cret' }))[0], 200); // a late duplicate changes nothing
  assert.equal((await store.findByRef(tx.ref)).status, STATUS.PAID);
  assert.equal(store.balance(5), 40);

  const pending = await store.requestWithdrawal({ userId: 5, method: 'telebirr', amount: 10, account: '+251911000011' });
  assert.equal((await hook('sandbox', { ref: pending.ref, status: 'paid' }, { 'x-sandbox-secret': 's3cret' }))[0], 200);
  assert.equal((await store.findByRef(pending.ref)).status, STATUS.PENDING); // not sent by us: untouched
  assert.equal(statusCalls(), 1);
});
