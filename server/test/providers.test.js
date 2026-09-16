import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, privateEncrypt, constants, createHash } from 'node:crypto';
import { signPayload, encryptPayload, decryptNotification, telebirrProvider, toPem } from '../src/payments/telebirr.js';
import { chapaProvider } from '../src/payments/chapa.js';
import { buildProviders } from '../src/payments/registry.js';
import { STATUS } from '../src/store.js';

const paymentUrl = (p) => `https://example.test/api/payments${p}`;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const bareKey = publicPem.replace(/-----[^-]+-----|\s/g, '');

test('telebirr signature is sha256 over sorted key=value pairs plus appKey', () => {
  const sig = signPayload({ b: '2', a: '1' }, 'KEY');
  const expected = createHash('sha256').update('a=1&appKey=KEY&b=2').digest('hex');
  assert.equal(sig, expected);
  assert.equal(sig, signPayload({ a: '1', b: '2' }, 'KEY'));
});

test('telebirr order payload is RSA-encrypted in 117-byte PKCS#1 blocks', () => {
  const payload = { outTradeNo: 'TGB1', totalAmount: '100.00', subject: 'x'.repeat(200) };
  const plainLength = Buffer.byteLength(JSON.stringify(payload));
  const enc = Buffer.from(encryptPayload(payload, toPem(bareKey)), 'base64');
  // Every 117-byte plaintext block becomes one 256-byte block for a 2048-bit key.
  assert.equal(enc.length, Math.ceil(plainLength / 117) * 256);
  // PKCS#1 v1.5 padding is randomised, so two encryptions differ.
  assert.notEqual(encryptPayload(payload, toPem(bareKey)), enc.toString('base64'));
});

test('telebirr notification signed by the merchant private key is decrypted with the public key', () => {
  const notice = { outTradeNo: 'TGB1', tradeNo: 'T-1', tradeStatus: 2, totalAmount: '100.00', pad: 'y'.repeat(300) };
  const buf = Buffer.from(JSON.stringify(notice));
  const parts = [];
  for (let i = 0; i < buf.length; i += 117) {
    parts.push(privateEncrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, buf.subarray(i, i + 117)));
  }
  const encoded = Buffer.concat(parts).toString('base64');
  assert.deepEqual(decryptNotification(encoded, publicPem), notice);
});

test('telebirr initiate posts signed+encrypted order and returns toPayUrl', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ code: 200, data: { toPayUrl: 'https://pay.test/abc' } }) };
  };
  const p = telebirrProvider(
    { appId: 'APP', appKey: 'KEY', publicKey: bareKey, shortCode: '1234', receiveName: 'Bingo', baseUrl: 'https://tb.test' },
    { paymentUrl, fetchImpl },
  );
  assert.equal(p.available, true);
  const res = await p.initiate({ ref: 'TGB1', amount: 25, currency: 'ETB' });
  assert.equal(res.checkoutUrl, 'https://pay.test/abc');
  assert.equal(calls[0].url, 'https://tb.test/ammapi/payment/service-openup/toTradeWebPay');
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['appid', 'sign', 'ussd']);
});

test('chapa webhook credits only after verify confirms success', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    json: async () => ({ data: { status: url.endsWith('/OK') ? 'success' : 'pending', reference: 'CH-1' } }),
  });
  const p = chapaProvider({ id: 'boa', label: 'BoA' }, { secretKey: 'sk', webhookSecret: '', baseUrl: 'https://c.test' }, { paymentUrl, fetchImpl });
  const req = (ref) => ({ body: { tx_ref: ref }, get: () => '' });
  assert.deepEqual(await p.handleWebhook(req('OK')), { ref: 'OK', status: STATUS.PAID, providerRef: 'CH-1' });
  assert.deepEqual(await p.handleWebhook(req('WAIT')), { ref: 'WAIT', status: STATUS.PENDING, providerRef: null });
});

test('chapa webhook rejects a bad signature when a webhook secret is set', async () => {
  const p = chapaProvider({ id: 'boa', label: 'BoA' }, { secretKey: 'sk', webhookSecret: 'whsec', baseUrl: 'https://c.test' }, { paymentUrl });
  const req = { body: { tx_ref: 'X' }, rawBody: '{"tx_ref":"X"}', get: () => 'deadbeef' };
  assert.equal(await p.handleWebhook(req), null);
});

test('registry offers no online checkout when no gateway is configured', () => {
  const cfg = { telebirr: {}, chapa: {} };
  const providers = buildProviders(cfg, { paymentUrl });
  assert.equal(providers.size, 0);
});

test('registry uses direct Telebirr and Chapa for banks when configured', () => {
  const cfg = {
    telebirr: { appId: 'a', appKey: 'k', publicKey: bareKey, shortCode: '1', receiveName: 'x', baseUrl: 'https://t' },
    chapa: { secretKey: 'sk', baseUrl: 'https://c' },
  };
  const providers = buildProviders(cfg, { paymentUrl });
  assert.deepEqual([...providers.keys()], ['telebirr', 'cbebirr', 'boa']);
  assert.equal(providers.get('telebirr').webhookBody, 'text'); // direct Telebirr Web API
  assert.equal(providers.get('cbebirr').webhookBody, 'json'); // Chapa
  assert.equal(providers.get('boa').label, 'Bank of Abyssinia');
});

test('registry offers only the rails whose gateway is configured', () => {
  const providers = buildProviders({ telebirr: {}, chapa: { secretKey: 'sk', baseUrl: 'https://c' } }, { paymentUrl });
  assert.deepEqual([...providers.keys()], ['telebirr', 'cbebirr', 'boa']); // all three via Chapa
  const direct = buildProviders(
    { telebirr: { appId: 'a', appKey: 'k', publicKey: bareKey, shortCode: '1', receiveName: 'x', baseUrl: 'https://t' }, chapa: {} },
    { paymentUrl },
  );
  assert.deepEqual([...direct.keys()], ['telebirr']); // banks need Chapa
});
