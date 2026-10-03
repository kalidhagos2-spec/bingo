import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayout, canPay, PROVIDERS } from '../src/payouts/registry.js';
import { telebirrPayoutAdapter } from '../src/payouts/telebirr.js';

const quiet = { warn() {} };

test('PAYOUT_PROVIDER picks the gateway; a half-configured one means paid by hand', () => {
  assert.deepEqual(PROVIDERS, ['none', 'sandbox', 'chapa', 'telebirr']);
  assert.equal(buildPayout({ payout: { provider: 'none' } }, { log: quiet }), null);
  assert.equal(buildPayout({ payout: { provider: 'bogus' } }, { log: quiet }), null);
  const sandbox = buildPayout({ payout: { provider: 'sandbox', sandbox: { delayMs: 0 } } }, { log: quiet });
  assert.equal(sandbox.id, 'sandbox');
  assert.equal(buildPayout({ payout: { provider: 'chapa' }, chapa: { secretKey: '' } }, { log: quiet }), null);
  const chapa = buildPayout({ payout: { provider: 'chapa' }, chapa: { secretKey: 'k' } }, { log: quiet });
  assert.equal(chapa.id, 'chapa');
  assert.deepEqual(chapa.methods, ['telebirr', 'cbebirr', 'boa']);
  for (const g of [sandbox, chapa]) for (const fn of ['send', 'status', 'handleWebhook']) assert.equal(typeof g[fn], 'function');
  assert.equal(buildPayout({ payout: { provider: 'telebirr' }, telebirr: {} }, { log: quiet }), null); // no B2C URL
  assert.equal(canPay(chapa, 'boa'), true);
  assert.equal(canPay(null, 'boa'), false);
});

test('the Telebirr B2C stub fits the gateway shape', async () => {
  const cfg = { b2cUrl: 'https://example.invalid/b2c', appId: 'a', appKey: 'k', publicKey: Buffer.from('x').toString('base64'), shortCode: '1' };
  const adapter = telebirrPayoutAdapter(cfg, { fetchImpl: async () => ({ ok: true, json: async () => ({ data: { transactionNo: 'TB-1' } }) }) });
  assert.deepEqual([adapter.id, adapter.methods], ['telebirr', ['telebirr']]);
  assert.equal((await adapter.status('x')).status, 'processing');
  assert.equal(await adapter.handleWebhook({}), null);
  const broken = telebirrPayoutAdapter(cfg, { fetchImpl: async () => { throw new Error('ETIMEDOUT'); } });
  await assert.rejects(broken.send({ ref: 'r', amount: 1, account: '+251911000001' }), (e) => e.kind === 'ambiguous');
});
