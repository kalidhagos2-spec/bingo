import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentStore } from '../src/store.js';
import { freshPool } from './helpers/pg.js';
import { createDepositVerifier, verifyPayoutReceipt } from '../src/verifier.js';
import { createTelebirrPayout } from '../src/payouts/telebirr.js';
import { generateKeyPairSync } from 'node:crypto';

const HOUSE = '0960524040';
const receipt = ({ id, amount, to }) => `<p>Transaction Number: ${id}</p><p>Paid Amount: ${amount} Birr</p><p>Credited Party: Kalid 2519****${String(to).slice(-4)}</p><p>Date: 16-09-2026 12:45:20</p>`;

async function setup(t, pages) {
  const { pool } = await freshPool(t);
  const store = new PaymentStore(pool);
  await store.load();
  const fetchImpl = async (url) => {
    const id = url.split('/').pop();
    const page = pages[id];
    return page ? { ok: true, text: async () => page } : { ok: false, status: 404 };
  };
  return { store, fetchImpl };
}

test('pending Telebirr deposits are confirmed by the sweep once their receipt is published', async (t) => {
  const pages = {};
  const { store, fetchImpl } = await setup(t, pages);
  const logs = [];
  const verifier = createDepositVerifier({ store, fetchImpl, log: { log: (m) => logs.push(m), warn: (m) => logs.push(m) } });
  const early = await store.submitDeposit({ userId: 1, method: 'telebirr', amount: 50, txId: 'DIG9RR30GV', account: HOUSE });
  const other = await store.submitDeposit({ userId: 2, method: 'cbebirr', amount: 20, txId: 'CBE00000001', account: '0937766034' });

  let r = await verifier.sweep();
  assert.deepEqual(r, { checked: 1, approved: 0 }); // receipt not published yet; CBE Birr is not checked
  assert.match((await store.findByRef(early.ref)).autoCheck, /HTTP 404/);

  pages.DIG9RR30GV = receipt({ id: 'DIG9RR30GV', amount: 50, to: HOUSE });
  r = await verifier.sweep();
  assert.deepEqual(r, { checked: 1, approved: 1 });
  const paid = await store.findByRef(early.ref);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.verified, 'auto');
  assert.equal(store.balance(1), 50);
  assert.equal((await store.findByRef(other.ref)).status, 'pending');
  assert.ok(logs.some((m) => /auto-confirmed 1 of 1/.test(m)));

  // A wrong amount on the receipt keeps the deposit pending with the reason recorded.
  pages.WRONGAMT01 = receipt({ id: 'WRONGAMT01', amount: 99, to: HOUSE });
  const bad = await store.submitDeposit({ userId: 3, method: 'telebirr', amount: 50, txId: 'WRONGAMT01', account: HOUSE });
  const one = await verifier.checkOne(bad.ref);
  assert.equal(one.check.ok, false);
  assert.match(one.tx.autoCheck, /amount 50.00 not on receipt/);
  await assert.rejects(() => verifier.checkOne('NOPE'), /not found/);
  await store.flush();
});

test('the sweep ignores deposits older than the re-check window', async (t) => {
  const pages = { OLDRECEIPT1: receipt({ id: 'OLDRECEIPT1', amount: 10, to: HOUSE }) };
  const { store, fetchImpl } = await setup(t, pages);
  const tx = await store.submitDeposit({ userId: 1, method: 'telebirr', amount: 10, txId: 'OLDRECEIPT1', account: HOUSE });
  const twoDaysLater = new Date(tx.createdAt).getTime() + 48 * 3_600_000;
  const verifier = createDepositVerifier({ store, fetchImpl, maxAgeHours: 24, now: () => twoDaysLater });
  assert.deepEqual(await verifier.sweep(), { checked: 0, approved: 0 });
  assert.equal((await store.findByRef(tx.ref)).status, 'pending');
  await store.flush();
});

test('a manual payout is verified by its receipt: id, net amount and the player number', async () => {
  const pages = { PAYOUT00001: receipt({ id: 'PAYOUT00001', amount: 58.8, to: '0911000001' }) };
  const fetchImpl = async (url) => ({ ok: true, text: async () => pages[url.split('/').pop()] ?? '' });
  assert.deepEqual(await verifyPayoutReceipt({ txId: 'PAYOUT00001', amount: 58.8, account: '+251911000001' }, fetchImpl), { ok: true });
  assert.match((await verifyPayoutReceipt({ txId: 'PAYOUT00001', amount: 60, account: '+251911000001' }, fetchImpl)).reason, /amount 60.00/);
  assert.match((await verifyPayoutReceipt({ txId: 'PAYOUT00001', amount: 58.8, account: '+251922222222' }, fetchImpl)).reason, /house account/);
});

test('the Telebirr disbursement gateway is off without credentials and signs its request when on', async () => {
  const off = createTelebirrPayout({ b2cUrl: '' });
  assert.equal(off.available, false);
  await assert.rejects(() => off.send({ phone: '+251911000001', amount: 10, ref: 'TGB1' }), /not configured/);

  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ code: 200, data: { transactionNo: 'TB2C123' } }) };
  };
  const on = createTelebirrPayout({ b2cUrl: 'https://tb.test/b2c', appId: 'APP', appKey: 'KEY', publicKey: pem, shortCode: '1234' }, { fetchImpl });
  assert.equal(on.available, true);
  const sent = await on.send({ phone: '+251911000001', amount: 58.8, ref: 'TGBW1' });
  assert.equal(sent.providerRef, 'TB2C123');
  assert.equal(calls[0].url, 'https://tb.test/b2c');
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['appid', 'sign', 'ussd']);

  const failing = createTelebirrPayout({ b2cUrl: 'https://tb.test/b2c', appId: 'APP', appKey: 'KEY', publicKey: pem, shortCode: '1234' }, { fetchImpl: async () => ({ ok: true, json: async () => ({ code: 500, msg: 'insufficient float' }) }) });
  await assert.rejects(() => failing.send({ phone: '+251911000001', amount: 10, ref: 'TGBW2' }), /insufficient float/);
});
