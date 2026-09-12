import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Validates Telegram Mini App initData per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Returns the parsed user object or null when invalid.
 */
export function verifyInitData(initData, botToken, now = Date.now()) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || now / 1000 - authDate > MAX_AGE_SECONDS) return null;

  try {
    const user = JSON.parse(params.get('user') ?? 'null');
    return user && typeof user.id === 'number' ? user : null;
  } catch {
    return null;
  }
}

/** Builds a signed initData string. Used by tests and local tooling. */
export function signInitData(fields, botToken) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return params.toString();
}

const DEV_USER = { id: 1, first_name: 'Dev', last_name: 'User', username: 'dev' };

/**
 * Express middleware: `Authorization: tma <initData>` (Telegram) or `Bearer <token>`
 * (email login session, resolved by `sessions(token)`) sets req.user.
 */
export function telegramAuth({ botToken, devAllowAnon, sessions = () => null, suspension = () => null }) {
  return async (req, res, next) => {
    const header = req.get('authorization') ?? '';
    const [scheme, ...rest] = header.split(' ');
    const initData = scheme?.toLowerCase() === 'tma' ? rest.join(' ') : '';

    // `suspension(userId)` returns the active block (with a reason) or null.
    const admit = (user) => {
      const blocked = suspension(user.id);
      if (blocked) return res.status(403).json({ error: suspendedMessage(blocked), suspended: blocked });
      req.user = user;
      return next();
    };

    const user = verifyInitData(initData, botToken);
    if (user) return admit(user);
    if (scheme?.toLowerCase() === 'bearer') {
      const sessionUser = await sessions(rest[0]);
      if (sessionUser) return admit(sessionUser);
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    if (devAllowAnon && !initData) return admit(DEV_USER);
    res.status(401).json({ error: 'Invalid or missing Telegram initData' });
  };
}

/** Player-facing text for a suspension record. */
export function suspendedMessage(s) {
  const until = s.until ? ` until ${new Date(s.until).toLocaleDateString('en-GB')}` : ' permanently';
  return `Account suspended${until}: ${s.reason}`;
}
