import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createChapaPayout, toLocalAccount } from '../src/payouts/chapa.js';

const BANKS = [
  { id: 946, name: 'Commercial Bank of Ethiopia (CBE)', is_mobilemoney: false },
  { id: 855, name: 'telebirr', is_mobilemoney: true },
  { id: 128, name: 'Bank of Abyssinia', is_mobilemoney: false },
  { id: 130, name: 'CBEBirr', is_mobilemoney: true },
];

/** A fake Chapa: `answer(path, body)` returns { status, json }. Every call is recorded. */
function fakeChapa(answer) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method ?? 'GET', body, auth: init.headers?.authorization });
    const r = answer(path, body, init);
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, json: async () => r.json };
  };
  return { fetchImpl, calls };
}

const banksAnswer = { status: 200, json: { status: 'success', data: BANKS } };

test('send: a wallet number, our ref as the reference, the bank code from /v1/banks (fetched once)', async () => {
  const { fetchImpl, calls } = fakeChapa((path) => (path === '/v1/banks' ? banksAnswer : { status: 200, json: { status: 'success', message: 'Transfer Queued Successfully', data: 'CH-REF-1' } }));
  const chapa = createChapaPayout({ secretKey: 'CHASECK_TEST', webhookSecret: '' }, { fetchImpl, log: { warn() {} } });
  assert.equal(chapa.available, true);
  const sent = await chapa.send({ ref: 'TGB1', amount: 58.8, method: 'telebirr', account: '+251911000001', name: 'Sara' });
  assert.deepEqual(sent, { providerRef: 'CH-REF-1', status: 'processing' });
  const transfer = calls.find((c) => c.path === '/v1/transfers');
  assert.deepEqual(transfer.body, { account_name: 'Sara', account_number: '0911000001', amount: '58.80', currency: 'ETB', reference: 'TGB1', bank_code: 855 });
  assert.equal(transfer.auth, 'Bearer CHASECK_TEST');
  await chapa.send({ ref: 'TGB2', amount: 10, method: 'boa', account: '1000 2233 44', name: '' });
  assert.equal(calls.filter((c) => c.path === '/v1/banks').length, 1); // cached
  const boa = calls.filter((c) => c.path === '/v1/transfers').at(-1).body;
  assert.deepEqual([boa.bank_code, boa.account_number, boa.account_name], [128, '1000223344', 'Bingo player']);
  assert.equal(toLocalAccount('cbebirr', '+251922000003'), '0922000003');
  assert.equal(toLocalAccount('boa', '12-34'), '1234');
});

test('send: an env bank code skips the bank list; refusals are sorted into retry / rejected / ambiguous', async () => {
  let reply = { status: 400, json: { status: 'failed', message: 'Transfer hours are Mon-Sat from 08:30 AM - 04:30 PM only' } };
  const { fetchImpl, calls } = fakeChapa((path) => (path === '/v1/banks' ? banksAnswer : reply));
  const chapa = createChapaPayout({ secretKey: 'k', bankCodes: { telebirr: '855' } }, { fetchImpl, log: { warn() {} } });
  const kindOf = (p) => p.then(() => 'none', (e) => e.kind);
  const go = () => chapa.send({ ref: 'R', amount: 5, method: 'telebirr', account: '+251911000001' });
  assert.equal(await kindOf(go()), 'retry');
  assert.equal(calls.filter((c) => c.path === '/v1/banks').length, 0);
  reply = { status: 400, json: { status: 'failed', message: 'Invalid account number' } };
  assert.equal(await kindOf(go()), 'rejected');
  reply = { status: 422, json: { status: 'failed', message: { account_number: ['is not valid'] } } };
  assert.equal(await kindOf(go()), 'rejected');
  reply = { status: 429, json: { message: 'Too many requests' } };
  assert.equal(await kindOf(go()), 'retry');
  reply = { status: 401, json: { message: 'Invalid API key' } };
  assert.equal(await kindOf(go()), 'retry');
  reply = { status: 500, json: {} };
  assert.equal(await kindOf(go()), 'ambiguous');
  reply = new Error('socket hang up');
  assert.equal(await kindOf(go()), 'ambiguous');
  const none = createChapaPayout({ secretKey: 'k', bankCodes: {} }, { fetchImpl: fakeChapa(() => ({ status: 200, json: { status: 'success', data: [{ id: 1, name: 'Some Bank' }] } })).fetchImpl });
  await assert.rejects(none.send({ ref: 'R', amount: 5, method: 'telebirr', account: '+251911000001' }), (e) => e.kind === 'retry' && /CHAPA_BANK_CODE_TELEBIRR/.test(e.message));
});

test('status maps the verify answer; unknown references are unknown, outages throw', async () => {
  let reply;
  const { fetchImpl, calls } = fakeChapa(() => reply);
  const chapa = createChapaPayout({ secretKey: 'k' }, { fetchImpl });
  reply = { status: 200, json: { status: 'success', data: { status: 'success', chapa_reference: 'CH-77', reference: 'TGB1' } } };
  assert.deepEqual(await chapa.status('TGB1'), { status: 'paid', providerRef: 'CH-77' });
  assert.equal(calls.at(-1).path, '/v1/transfers/verify/TGB1');
  reply = { status: 200, json: { status: 'success', data: { status: 'failed', message: 'Insufficient funds at bank', bank_reference: 'B1' } } };
  assert.deepEqual(await chapa.status('TGB1'), { status: 'failed', providerRef: 'B1', reason: 'Insufficient funds at bank' });
  reply = { status: 200, json: { status: 'success', data: { status: 'pending' } } };
  assert.equal((await chapa.status('TGB1')).status, 'processing');
  reply = { status: 404, json: { status: 'failed', message: 'Transfer not found' } };
  assert.equal((await chapa.status('TGB1')).status, 'unknown');
  reply = { status: 503, json: {} };
  await assert.rejects(chapa.status('TGB1'), /status check failed/);
});

test('webhook: either documented signature is accepted, anything else is ignored', async () => {
  const chapa = createChapaPayout({ secretKey: 'k', webhookSecret: 'whsec' }, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  const body = { event: 'payout.success', reference: 'TGB1', chapa_reference: 'CH-1', status: 'success' };
  const raw = JSON.stringify(body);
  const req = (headers) => ({ rawBody: raw, body, get: (h) => headers[h.toLowerCase()] });
  const hmac = (d) => createHmac('sha256', 'whsec').update(d).digest('hex');
  assert.deepEqual(await chapa.handleWebhook(req({ 'x-chapa-signature': hmac(raw) })), { ref: 'TGB1', status: 'paid', providerRef: 'CH-1', reason: null });
  assert.equal((await chapa.handleWebhook(req({ 'chapa-signature': hmac('whsec') }))).status, 'paid');
  assert.equal(await chapa.handleWebhook(req({ 'x-chapa-signature': hmac('other') })), null);
  assert.equal(await chapa.handleWebhook(req({})), null);
  const failed = { event: 'payout.failed', reference: 'TGB2', message: 'Account closed' };
  assert.deepEqual(await chapa.handleWebhook({ rawBody: JSON.stringify(failed), body: failed, get: (h) => (h === 'x-chapa-signature' ? hmac(JSON.stringify(failed)) : undefined) }), { ref: 'TGB2', status: 'failed', providerRef: null, reason: 'Account closed' });
  const open = createChapaPayout({ secretKey: 'k' }, { fetchImpl: async () => ({}), log: { warn() {} } });
  assert.equal((await open.handleWebhook(req({}))).ref, 'TGB1'); // no secret configured: accepted (it only triggers a status check)
});
