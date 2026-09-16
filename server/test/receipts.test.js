import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptConfirms, verifyTelebirrReceipt } from '../src/receipts.js';

const page = (over = {}) => {
  const v = { id: 'AB12CD34EF', amount: '100.00', to: '2519000****00', ...over };
  return `<html><body><h2>Transaction Receipt</h2><p>Transaction Number: ${v.id}</p>
  <p>Payer: Kalid 2519****960</p><p>Credited Party: Telegram Bingo ${v.to}</p>
  <p>Total Paid Amount: ${v.amount} Birr</p><p>Service fee: 1.00 Birr</p></body></html>`;
};

test('a receipt confirms only when id, amount and house number all appear', () => {
  const house = '0900000000';
  assert.deepEqual(receiptConfirms(page({ to: '251900000000' }), { txId: 'ab12cd34ef', amount: 100, houseAccount: house }), { ok: true });
  assert.deepEqual(receiptConfirms(page({ to: '2519000****0000' }), { txId: 'AB12CD34EF', amount: 100, houseAccount: house }), { ok: true }); // masked number, last 4 shown
  assert.equal(receiptConfirms(page(), { txId: 'XXXXXXXXXX', amount: 100, houseAccount: house }).ok, false);
  assert.match(receiptConfirms(page({ to: '251900000000' }), { txId: 'AB12CD34EF', amount: 120, houseAccount: house }).reason, /amount 120.00/);
  assert.match(receiptConfirms(page({ to: '251977777777' }), { txId: 'AB12CD34EF', amount: 100, houseAccount: house }).reason, /house account/);
  assert.equal(receiptConfirms('', { txId: 'AB12CD34EF', amount: 100, houseAccount: house }).ok, false);
});

test('whole-number amounts count, but digits from dates, times or bigger numbers do not', () => {
  const house = '0937766034';
  // Real receipt shape: "50 Birr" (no decimals), fee and total, receiver masked, timestamp with a 20 in it.
  const real = `<p>Transaction Number: DIG9RR30GV</p><p>Paid Amount: 50 Birr</p><p>Service fee: 0.87 Birr</p>
    <p>Total: 51 Birr</p><p>Credited Party: amanuel Hailu 2519****6034</p><p>Date: 16-09-2026 12:45:20</p>`;
  const check = (amount) => receiptConfirms(real, { txId: 'DIG9RR30GV', amount, houseAccount: house });
  assert.deepEqual(check(50), { ok: true });
  assert.deepEqual(check(51), { ok: true }); // the total is also a labelled amount
  assert.match(check(45).reason, /amount 45.00/); // "12:45:20" is a time, not money
  assert.match(check(20).reason, /amount 20.00/);
  assert.match(check(2026).reason, /amount 2026.00/);
  assert.match(check(5).reason, /amount 5.00/); // "50" must not match 5
  assert.deepEqual(receiptConfirms(real.replace('50 Birr', '5,000.00 Birr'), { txId: 'DIG9RR30GV', amount: 5000, houseAccount: house }), { ok: true });
  assert.match(receiptConfirms(real.replace('50 Birr', '5,000 Birr'), { txId: 'DIG9RR30GV', amount: 50, houseAccount: house }).reason, /amount 50.00/);
});

test('verifyTelebirrReceipt fetches the public receipt and never throws', async () => {
  const ok = await verifyTelebirrReceipt({ txId: 'ab12cd34ef', amount: 100, houseAccount: '0900000000' }, async (url) => {
    assert.equal(url, 'https://transactioninfo.ethiotelecom.et/receipt/AB12CD34EF');
    return { ok: true, text: async () => page({ to: '251900000000' }) };
  });
  assert.deepEqual(ok, { ok: true });
  assert.match((await verifyTelebirrReceipt({ txId: 'AB12CD34EF', amount: 100, houseAccount: '0900000000' }, async () => ({ ok: false, status: 404 }))).reason, /HTTP 404/);
  assert.match((await verifyTelebirrReceipt({ txId: 'AB12CD34EF', amount: 100, houseAccount: '0900000000' }, async () => { throw new Error('offline'); })).reason, /offline/);
  assert.match((await verifyTelebirrReceipt({ txId: 'no', amount: 100, houseAccount: '0900000000' })).reason, /not a Telebirr/);
});
