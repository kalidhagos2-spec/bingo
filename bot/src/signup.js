/**
 * Sign-up for the bot: pure functions over the stored user record so the flow can be
 * unit-tested without Telegram. One step only: the display name is taken from Telegram
 * and the player shares (or skips) their phone number. The name can be changed later in
 * the Mini App's Profile screen.
 */
export const STEP = Object.freeze({ PHONE: 'phone' });

export const NAME_MIN = 2;
export const NAME_MAX = 32;

export const SKIP = 'Skip for now';

export const prompts = {
  phone: (user) =>
    [
      `👋 Welcome, *${user.name}*! One quick step and you are in.`,
      '',
      'Share your phone number so deposits, cash-outs and transfers are matched to your account.',
      'Tap the button below, or type it (e.g. +2519…).',
    ].join('\n'),
  done: (user) =>
    [
      `✅ You are registered, *${user.name}*!`,
      user.phone ? `📱 ${user.phone}` : '📱 No phone yet — add it later from *My profile*.',
      '',
      'Press *Play Bingo* to open the game.',
    ].join('\n'),
  phoneInvalid: 'That does not look like a phone number. Tap *Share my number* or type it like +251900000000.',
};

/** Suggested name from Telegram fields, trimmed to the profile limit. */
export function suggestedName(user) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username || `Player ${user.id}`;
  return name.slice(0, NAME_MAX);
}

/**
 * True once the sign-up flow has been walked through to the end, whether or not the phone
 * step was skipped. The /start and /play gates use this so a player who chose "Skip for now"
 * is not sent through the flow again.
 */
export function hasSignedUp(user) {
  return Boolean(user?.signedUpAt);
}

/**
 * True only when the profile holds a name and a phone -- the same rule the server's profile
 * route and the Mini App's "Sign-up incomplete" badge apply.
 */
export function isComplete(user) {
  return Boolean(user?.name && user?.phone);
}

/** Digits with optional leading +; Ethiopian local numbers (09…) are normalised to +251. */
export function normalizePhone(text) {
  const raw = String(text ?? '').replace(/[\s()-]/g, '');
  if (!/^\+?\d{7,15}$/.test(raw)) return null;
  if (/^0\d{9}$/.test(raw)) return `+251${raw.slice(1)}`;
  return raw.startsWith('+') ? raw : `+${raw}`;
}

/** Puts the user at the (only) step, with the display name filled in from Telegram unless they already chose one. */
export function begin(user) {
  return { ...user, name: user.name || suggestedName(user), signup: { step: STEP.PHONE, startedAt: new Date().toISOString() } };
}

/**
 * Applies a text reply. Returns { user, reply, done } where `reply` is the next prompt
 * (markdown) and `done` tells the caller the flow finished.
 */
export function applyText(user, text) {
  if (user.signup?.step !== STEP.PHONE) return { user, reply: null, done: false };
  const value = String(text ?? '').trim();
  if (value === SKIP) return finish({ ...user, phone: user.phone ?? null });
  const phone = normalizePhone(value);
  if (!phone) return { user, reply: prompts.phoneInvalid, done: false };
  return finish({ ...user, phone });
}

/** Applies a shared Telegram contact (only the user's own number is accepted). */
export function applyContact(user, contact) {
  if (user.signup?.step !== STEP.PHONE) return { user, reply: null, done: false };
  if (contact?.user_id && contact.user_id !== user.id) return { user, reply: 'Please share *your own* contact.', done: false };
  const phone = normalizePhone(contact?.phone_number);
  if (!phone) return { user, reply: prompts.phoneInvalid, done: false };
  return finish({ ...user, phone });
}

function finish(user) {
  const next = { ...user, signup: null, signedUpAt: user.signedUpAt ?? new Date().toISOString() };
  return { user: next, reply: prompts.done(next), done: true };
}
