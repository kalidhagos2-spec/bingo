import { randomBytes, randomInt } from 'node:crypto';

/**
 * Email login: a one-time 6-digit code sent to the address, exchanged for a session token.
 * An address that already belongs to a Telegram player's profile logs into that player;
 * otherwise an email-only account is created with an id far above the Telegram id range.
 * Codes and sessions live in Postgres (see store.js); wallet/profile state stays in the
 * store's synchronous in-memory mirror as usual.
 */
export const CODE_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const EMAIL_ACCOUNT_BASE = 9_000_000_000_000; // Telegram ids are far below this

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(text) {
  const email = String(text ?? '').trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

/** Creates (or replaces) the pending code for an address. Returns the code for the mailer. */
export async function requestCode(store, emailText, now = Date.now()) {
  const email = normalizeEmail(emailText);
  if (!email) throw new Error('Enter a valid email address');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = now + CODE_TTL_MS;
  await store.saveLoginCode(email, { code, expiresAt, attempts: 0 });
  return { email, code, expiresAt };
}

/** Which player owns this email: a Telegram profile that added it, or an email-only account. */
export async function userIdForEmail(store, email) {
  return store.userIdForEmail(email);
}

/** Checks a code; on success returns { token, user } and remembers the email on the profile. */
export async function verifyCode(store, emailText, codeText, now = Date.now()) {
  const email = normalizeEmail(emailText);
  if (!email) throw new Error('Enter a valid email address');
  const pending = await store.getLoginCode(email);
  if (!pending || pending.expiresAt < now) {
    await store.deleteLoginCode(email);
    throw new Error('Code expired. Request a new one.');
  }
  if (String(codeText ?? '').trim() !== pending.code) {
    const attempts = pending.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) await store.deleteLoginCode(email);
    else await store.saveLoginCode(email, { code: pending.code, expiresAt: pending.expiresAt, attempts });
    throw new Error(attempts >= MAX_ATTEMPTS ? 'Too many attempts. Request a new code.' : 'Wrong code');
  }
  await store.deleteLoginCode(email);
  const userId = await store.userIdForEmail(email);
  await store.setProfile(userId, { email });
  const token = randomBytes(32).toString('hex');
  await store.createSession(token, { userId, email, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  return { token, user: await sessionUser(store, token, now) };
}

/** The user behind a session token, or null. */
export async function sessionUser(store, token, now = Date.now()) {
  if (!token) return null;
  const session = await store.getSession(token);
  if (!session) return null;
  if (session.expiresAt < now) {
    await store.deleteSession(token);
    return null;
  }
  const profile = store.profile(session.userId);
  return {
    id: session.userId,
    first_name: profile?.name || profile?.firstName || session.email.split('@')[0],
    username: profile?.username ?? null,
    email: session.email,
    via: 'email',
  };
}

export async function logout(store, token) {
  return store.deleteSession(token);
}
