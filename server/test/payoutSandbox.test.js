import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxPayout } from '../src/payouts/sandbox.js';
import { PayoutError } from '../src/payouts/errors.js';

// Store rows are stamped with the real clock, so the virtual one starts there and only moves forward.
const clock = (start = Date.now()) => {
  let t = start;
  return { now: () => t, tick: (ms) => (t += ms) };
};

test('the sandbox pays after its delay, and the account suffix picks every other outcome', async () => {
  const c = clock();
  const sb = createSandboxPayout({ delayMs: 10_000, now: c.now });
  assert.equal(sb.available, true);
  assert.deepEqual(sb.methods, ['telebirr', 'cbebirr', 'boa']);

  const ok = await sb.send({ ref: 'W1', amount: 49, method: 'telebirr', account: '+251911000011' });
  assert.deepEqual(ok, { providerRef: 'SBX-W1', status: 'processing' });
  assert.equal((await sb.status('W1')).status, 'processing');
  c.tick(9_999);
  assert.equal((await sb.status('W1')).status, 'processing');
  c.tick(1);
  assert.deepEqual(await sb.status('W1'), { status: 'paid', providerRef: 'SBX-W1' });

  await sb.send({ ref: 'W2', amount: 10, method: 'boa', account: '1000000099' });
  c.tick(10_000);
  assert.equal((await sb.status('W2')).status, 'failed');

  await sb.send({ ref: 'W3', amount: 10, method: 'telebirr', account: '+251911000098' });
  c.tick(3_600_000);
  assert.equal((await sb.status('W3')).status, 'processing'); // pending for ever

  await assert.rejects(sb.send({ ref: 'W4', amount: 10, method: 'telebirr', account: '+251911000096' }), (e) => e instanceof PayoutError && e.kind === 'retry' && /Transfer hours/.test(e.message));
  await assert.rejects(sb.send({ ref: 'W5', amount: 10, method: 'telebirr', account: '+251911000095' }), (e) => e instanceof PayoutError && e.kind === 'rejected');

  // A timeout: we never heard back, but the transfer went through; the status check finds it.
  await assert.rejects(sb.send({ ref: 'W6', amount: 10, method: 'telebirr', account: '+251911000097' }), (e) => e.kind === 'ambiguous');
  assert.equal((await sb.status('W6')).status, 'processing');
  c.tick(10_000);
  assert.equal((await sb.status('W6')).status, 'paid');

  assert.match((await sb.status('NEVER-SENT')).reason, /server restarted/);
  assert.equal((await sb.status('NEVER-SENT')).status, 'failed');
});

test('with no delay the sandbox answers at once; the webhook settles a job and needs the secret', async () => {
  const sb = createSandboxPayout({ delayMs: 0, webhookSecret: 's3cret' });
  assert.deepEqual(await sb.send({ ref: 'A', amount: 1, method: 'telebirr', account: '+251911000011' }), { providerRef: 'SBX-A', status: 'paid' });
  await assert.rejects(sb.send({ ref: 'B', amount: 1, method: 'telebirr', account: '+251911000099' }), (e) => e.kind === 'rejected');

  const slow = createSandboxPayout({ delayMs: 60_000, webhookSecret: 's3cret' });
  await slow.send({ ref: 'C', amount: 1, method: 'telebirr', account: '+251911000098' });
  const req = (headers, body) => ({ get: (h) => headers[h.toLowerCase()], body });
  assert.equal(await slow.handleWebhook(req({}, { ref: 'C', status: 'paid' })), null);
  assert.equal(await slow.handleWebhook(req({ 'x-sandbox-secret': 'wrong' }, { ref: 'C', status: 'paid' })), null);
  assert.equal(await slow.handleWebhook(req({ 'x-sandbox-secret': 's3cret' }, { ref: 'C', status: 'maybe' })), null);
  assert.deepEqual(await slow.handleWebhook(req({ 'x-sandbox-secret': 's3cret' }, { ref: 'C', status: 'failed' })), { ref: 'C', status: 'failed', providerRef: 'SBX-C', reason: 'sandbox: failed by webhook' });
  assert.equal((await slow.status('C')).status, 'failed');
  assert.deepEqual(await slow.lookupName(), { name: 'Sandbox Player' });
});
