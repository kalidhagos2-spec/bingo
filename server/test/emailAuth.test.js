import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentStore } from '../src/store.js';
import { requestCode, verifyCode, sessionUser, logout, normalizeEmail, CODE_TTL_MS, SESSION_TTL_MS, EMAIL_ACCOUNT_BASE } from '../src/emailAuth.js';
import { freshPool } from './helpers/pg.js';

async function freshStore(t) {
  const { pool } = await freshPool(t);
  const store = new PaymentStore(pool);
  await store.load();
  return { store, pool };
}
const T0 = Date.UTC(2026, 8, 8, 12, 0, 0);

test('email addresses are validated and normalised', () => {
  assert.equal(normalizeEmail('  Abebe@Example.COM '), 'abebe@example.com');
  assert.equal(normalizeEmail('nope'), null);
  assert.equal(normalizeEmail('a@b'), null);
});

test('code login creates an email account, then a session that survives a restart', async (t) => {
  const { store, pool } = await freshStore(t);
  await assert.rejects(() => requestCode(store, 'bad'), /valid email/);
  const { email, code } = await requestCode(store, 'Abebe@Example.com', T0);
  assert.equal(email, 'abebe@example.com');
  assert.match(code, /^\d{6}$/);

  await assert.rejects(() => verifyCode(store, email, '000000', T0), /Wrong code/);
  const { token, user } = await verifyCode(store, email, code, T0);
  assert.equal(user.id, EMAIL_ACCOUNT_BASE);
  assert.equal(user.first_name, 'abebe');
  assert.equal(user.email, email);
  assert.equal(store.profile(user.id).email, email);
  await assert.rejects(() => verifyCode(store, email, code, T0), /expired/); // single use

  // A second store instance on the SAME database (simulating a restart) sees the same session —
  // sessions live in Postgres now, so unlike the old per-file JSON store there is only one copy
  // of this state, shared by every server instance.
  const again = new PaymentStore(pool);
  await again.load();
  assert.equal((await sessionUser(again, token, T0 + 1000)).id, EMAIL_ACCOUNT_BASE);
  assert.equal(await sessionUser(again, token, T0 + SESSION_TTL_MS + 1), null); // expired: also deleted it
  assert.equal(await logout(store, token), false); // already gone (deleted by the expiry check above)
  assert.equal(await sessionUser(store, token, T0), null);

  // Same address again -> same account id.
  const r2 = await requestCode(store, email, T0 + 5000);
  assert.equal((await verifyCode(store, email, r2.code, T0 + 5000)).user.id, EMAIL_ACCOUNT_BASE);
  const r3 = await requestCode(store, 'other@example.com', T0);
  assert.equal((await verifyCode(store, 'other@example.com', r3.code, T0)).user.id, EMAIL_ACCOUNT_BASE + 1);
});

test('an email already on a Telegram profile logs into that player', async (t) => {
  const { store } = await freshStore(t);
  await store.setProfile(777, { name: 'Sara', email: 'sara@example.com' });
  const { code } = await requestCode(store, 'sara@example.com', T0);
  const { user } = await verifyCode(store, 'sara@example.com', code, T0);
  assert.equal(user.id, 777);
  assert.equal(user.first_name, 'Sara');
});

test('codes expire and lock after too many wrong attempts', async (t) => {
  const { store } = await freshStore(t);
  const { code } = await requestCode(store, 'x@example.com', T0);
  await assert.rejects(() => verifyCode(store, 'x@example.com', code, T0 + CODE_TTL_MS + 1), /expired/);
  await requestCode(store, 'x@example.com', T0);
  for (let i = 0; i < 4; i++) await assert.rejects(() => verifyCode(store, 'x@example.com', '1', T0), /Wrong code/);
  await assert.rejects(() => verifyCode(store, 'x@example.com', '1', T0), /Too many attempts/);
  await assert.rejects(() => verifyCode(store, 'x@example.com', '1', T0), /expired/);
});
