import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentStore, STATUS } from '../src/store.js';
import { createSandboxPayout } from '../src/payouts/sandbox.js';
import { createPayoutWatcher } from '../src/payouts/watcher.js';
import { freshPool } from './helpers/pg.js';

// Store rows are stamped with the real clock, so the virtual one starts there and only moves forward.
const clock = (start = Date.now()) => {
  let t = start;
  return { now: () => t, tick: (ms) => (t += ms) };
};

async function setup(t, { delayMs = 10_000, payout = null } = {}) {
  const { pool } = await freshPool(t);
  const store = new PaymentStore(pool, { withdrawFeePercent: 2 });
  await store.load();
  const c = clock();
  const sandbox = payout ?? createSandboxPayout({ delayMs, now: c.now });
  const settled = [];
  const watcher = createPayoutWatcher({ store, payout: sandbox, intervalMs: 0, minAgeMs: 5_000, maxAgeHours: 48, unknownGraceMs: 60_000, now: c.now, log: { warn() {} }, onSettled: (tx) => settled.push(tx) });
  store.adjust(1, 1000, 'seed');
  /** A processing cash-out `account` that the sandbox has been asked to send. */
  const sent = async (account, provider = sandbox.id) => {
    const tx = await store.requestWithdrawal({ userId: 1, method: 'telebirr', amount: 100, account });
    await store.beginPayout(tx.ref, { provider });
    if (provider === sandbox.id) await sandbox.send({ ref: tx.ref, amount: tx.payout, method: 'telebirr', account }).catch(() => {});
    return tx;
  };
  return { store, c, sandbox, watcher, settled, sent };
}

test('the sweep leaves fresh sends alone, then settles paid and failed ones and tells the player', async (t) => {
  const { store, c, watcher, settled, sent } = await setup(t);
  const good = await sent('+251911000011');
  const bad = await sent('+251911000099');
  assert.equal(store.balance(1), 800);

  assert.deepEqual(await watcher.sweep(), { checked: 0, paid: 0, failed: 0, stale: 0 }); // younger than minAgeMs
  c.tick(6_000);
  assert.deepEqual(await watcher.sweep(), { checked: 2, paid: 0, failed: 0, stale: 0 }); // queued at the sandbox
  assert.match((await store.findByRef(good.ref)).autoCheck, /still queued/);
  c.tick(5_000);
  assert.deepEqual(await watcher.sweep(), { checked: 2, paid: 1, failed: 1, stale: 0 });
  const paid = await store.findByRef(good.ref);
  assert.deepEqual([paid.status, paid.verified, paid.providerRef], [STATUS.PAID, 'gateway', `SBX-${good.ref}`]);
  const failed = await store.findByRef(bad.ref);
  assert.deepEqual([failed.status, failed.reason], [STATUS.FAILED, 'sandbox: simulated failure']);
  assert.equal(store.balance(1), 900); // the failed one refunded, the paid one not
  assert.equal((await store.house()).balance, 2); // one fee
  assert.deepEqual(settled.map((x) => [x.ref, x.status]).sort(), [[bad.ref, 'failed'], [good.ref, 'paid']].sort());
  assert.deepEqual(await watcher.sweep(), { checked: 0, paid: 0, failed: 0, stale: 0 }); // nothing left
  assert.deepEqual((await watcher.checkOne(good.ref)).check, { status: 'paid', reason: 'already paid' });
});

test('a transfer with no final answer is flagged stale once; the unknown case refunds only when nothing was ever acknowledged', async (t) => {
  const first = await setup(t);
  let { store, c } = first;
  const { watcher, settled, sent } = first;
  const forever = await sent('+251911000098');
  c.tick(49 * 3600_000);
  assert.deepEqual(await watcher.sweep(), { checked: 0, paid: 0, failed: 0, stale: 1 });
  assert.match((await store.findByRef(forever.ref)).autoCheck, /^stale: no final answer after 48h/);
  assert.deepEqual(await watcher.sweep(), { checked: 0, paid: 0, failed: 0, stale: 0 }); // flagged only once, never queried again
  assert.equal((await store.findByRef(forever.ref)).status, STATUS.PROCESSING);

  // A send that timed out and that the provider says it never saw: refund after the grace period.
  const lost = await store.requestWithdrawal({ userId: 1, method: 'telebirr', amount: 10, account: '+251911000011' });
  await store.beginPayout(lost.ref, { provider: 'sandbox' }); // never sent to the sandbox: status() says "no record"
  c.tick(6_000);
  let r = await watcher.checkOne(lost.ref);
  assert.equal(r.tx.status, STATUS.FAILED); // the sandbox reports a restart as failed outright
  assert.match(r.tx.reason, /server restarted/);

  // With a provider that answers "unknown": refund only after the grace period, and never when it once gave a reference.
  // (A fresh store and clock: rows are stamped with the real time, and this clock has run 49 h ahead of it.)
  ({ store, c } = await setup(t));
  const flaky = { id: 'sandbox', available: true, methods: ['telebirr'], status: async () => ({ status: 'unknown', providerRef: null, reason: 'not found' }) };
  const w2 = createPayoutWatcher({ store, payout: flaky, minAgeMs: 0, unknownGraceMs: 60_000, now: c.now, log: { warn() {} }, onSettled: (tx) => settled.push(tx) });
  const young = await store.requestWithdrawal({ userId: 1, method: 'telebirr', amount: 10, account: '+251911000011' });
  await store.beginPayout(young.ref, { provider: 'sandbox' });
  r = await w2.checkOne(young.ref);
  assert.equal(r.tx.status, STATUS.PROCESSING);
  assert.match(r.tx.autoCheck, /not found at sandbox yet/);
  c.tick(61_000);
  r = await w2.checkOne(young.ref);
  assert.equal(r.tx.status, STATUS.FAILED);
  assert.match(r.tx.reason, /no record of this transfer/);
  const acked = await store.requestWithdrawal({ userId: 1, method: 'telebirr', amount: 10, account: '+251911000011' });
  await store.beginPayout(acked.ref, { provider: 'sandbox' });
  await store.recordPayoutCheck(acked.ref, { providerRef: 'CH-1' });
  c.tick(61_000);
  r = await w2.checkOne(acked.ref);
  assert.equal(r.tx.status, STATUS.PROCESSING); // never refund money the provider acknowledged
  assert.match(r.tx.autoCheck, /provider lost the reference CH-1/);
});

test('rows of another gateway and errors from the gateway are left alone', async (t) => {
  const { store, c, watcher, sent } = await setup(t);
  const other = await sent('+251911000011', 'chapa');
  c.tick(20_000);
  assert.deepEqual(await watcher.sweep(), { checked: 0, paid: 0, failed: 0, stale: 0 });
  assert.equal((await store.findByRef(other.ref)).status, STATUS.PROCESSING);
  const r = await watcher.checkOne(other.ref);
  assert.match(r.check.reason, /no gateway attached for chapa/);

  const down = { id: 'sandbox', available: true, methods: ['telebirr'], status: async () => { throw new Error('ECONNRESET'); } };
  const w2 = createPayoutWatcher({ store, payout: down, minAgeMs: 0, now: c.now, log: { warn() {} } });
  const tx = await sent('+251911000011');
  const checked = await w2.checkOne(tx.ref);
  assert.equal(checked.tx.status, STATUS.PROCESSING);
  assert.match(checked.tx.autoCheck, /status check failed: ECONNRESET/);
  await assert.rejects(w2.checkOne('NOPE'), /Withdrawal not found/);
});
