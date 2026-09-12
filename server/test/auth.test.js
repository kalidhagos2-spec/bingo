import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signInitData, verifyInitData } from '../src/auth.js';
import * as authModule from '../src/auth.js';

const TOKEN = '123456:TEST-TOKEN';
const user = { id: 42, first_name: 'Abebe', username: 'abebe' };
const now = Date.now();

test('accepts initData signed with the bot token', () => {
  const initData = signInitData({ auth_date: String(Math.floor(now / 1000)), query_id: 'q1', user }, TOKEN);
  assert.deepEqual(verifyInitData(initData, TOKEN, now), user);
});

test('rejects initData signed with another token', () => {
  const initData = signInitData({ auth_date: String(Math.floor(now / 1000)), user }, 'other');
  assert.equal(verifyInitData(initData, TOKEN, now), null);
});

test('rejects tampered user payload', () => {
  const initData = signInitData({ auth_date: String(Math.floor(now / 1000)), user }, TOKEN);
  const tampered = initData.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
  assert.notEqual(tampered, initData);
  assert.equal(verifyInitData(tampered, TOKEN, now), null);
});

test('rejects expired initData', () => {
  const old = Math.floor(now / 1000) - 3 * 24 * 3600;
  const initData = signInitData({ auth_date: String(old), user }, TOKEN);
  assert.equal(verifyInitData(initData, TOKEN, now), null);
});

test('rejects empty input', () => {
  assert.equal(verifyInitData('', TOKEN), null);
  assert.equal(verifyInitData('user=%7B%7D', TOKEN), null);
});


test('telegramAuth refuses a suspended player with the reason', () => {
  const { telegramAuth, suspendedMessage } = authModule;
  const mw = telegramAuth({ botToken: '', devAllowAnon: true, suspension: (id) => (id === 1 ? { reason: 'Fraud', until: null } : null) });
  const req = { get: () => '' };
  let status = 0;
  let body = null;
  const res = { status: (s) => ({ json: (b) => { status = s; body = b; } }) };
  let passed = false;
  mw(req, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(status, 403);
  assert.match(body.error, /suspended permanently: Fraud/);
  assert.equal(suspendedMessage({ reason: 'Late', until: '2026-09-15T00:00:00.000Z' }), 'Account suspended until 15/09/2026: Late');
});
