/**
 * Sign-up state machine for the bot: pure functions over the stored user record so the
 * flow can be unit-tested without Telegram. Steps: name -> phone -> done.
 */
export const STEP = Object.freeze({ NAME: 'name', PHONE: 'phone', EMAIL: 'email' });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const NAME_MIN = 2;
export const NAME_MAX = 32;

export const SKIP = 'Skip for now';

export const prompts = {
  name: (user) =>
    [
      `👋 Welcome${user.firstName ? `, ${user.firstName}` : ''}! Let's set up your player profile.`,
      '',
      '*Step 1 of 3 — Display name*',
      `What name should other players see? (${NAME_MIN}–${NAME_MAX} characters)`,
    ].join('\n'),
  phone: () =>
    [
      '*Step 2 of 3 — Phone number*',
      'Share your phone number so we can match wallet top-ups and payouts to your account.',
      'Tap the button below, or type it (e.g. +2519…).',
    ].join('\n'),
  email: () =>
    [
      '*Step 3 of 3 — Email*',
      'Type your email address. You will use it to log in to the game outside Telegram.',
    ].join('\n'),
  done: (user) =>
    [
      `✅ Profile saved, *${user.name}*!`,
      user.phone ? `📱 ${user.phone}` : '📱 No phone yet — add it later from *My profile*.',
      `✉️ ${user.email}`,
      '',
      'Press *Play Bingo* to open the game.',
    ].join('\n'),
  nameTooShort: `Please send a name between ${NAME_MIN} and ${NAME_MAX} characters.`,
  phoneInvalid: 'That does not look like a phone number. Tap *Share my number* or type it like +251900000000.',
  emailInvalid: 'That does not look like an email address. Try again, e.g. name@example.com.',
};

export function normalizeEmail(text) {
  const email = String(text ?? '').trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

/** Suggested name from Telegram fields. */
export function suggestedName(user) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username || `Player ${user.id}`;
}

// Phone is optional (the sign-up flow's "Skip for now" button explicitly allows leaving it
// out, with "add it later from *My profile*"), so it isn't required here -- otherwise every
// caller of isComplete() (the /start and /play gates, the profile screen's button label)
// would treat a user who skipped phone as never having finished sign-up, and re-run the
// entire 3-step flow on every future /start.
export function isComplete(user) {
  return Boolean(user?.name && user?.email);
}

/** Digits with optional leading +; Ethiopian local numbers (09…) are normalised to +251. */
export function normalizePhone(text) {
  const raw = String(text ?? '').replace(/[\s()-]/g, '');
  if (!/^\+?\d{7,15}$/.test(raw)) return null;
  if (/^0\d{9}$/.test(raw)) return `+251${raw.slice(1)}`;
  return raw.startsWith('+') ? raw : `+${raw}`;
}

/** Puts the user at the first step. */
export function begin(user) {
  return { ...user, signup: { step: STEP.NAME, startedAt: new Date().toISOString() } };
}

/**
 * Applies a text reply. Returns { user, reply, done } where `reply` is the next prompt
 * (markdown) and `done` tells the caller the flow finished.
 */
export function applyText(user, text) {
  const step = user.signup?.step;
  const value = String(text ?? '').trim();
  if (step === STEP.NAME) {
    if (value.length < NAME_MIN || value.length > NAME_MAX) return { user, reply: prompts.nameTooShort, done: false };
    return { user: { ...user, name: value, signup: { ...user.signup, step: STEP.PHONE } }, reply: prompts.phone(), done: false };
  }
  if (step === STEP.PHONE) {
    if (value === SKIP) return toEmail(user, null);
    const phone = normalizePhone(value);
    if (!phone) return { user, reply: prompts.phoneInvalid, done: false };
    return toEmail(user, phone);
  }
  if (step === STEP.EMAIL) {
    const email = normalizeEmail(value);
    if (!email) return { user, reply: prompts.emailInvalid, done: false };
    return finish({ ...user, email });
  }
  return { user, reply: null, done: false };
}

function toEmail(user, phone) {
  return { user: { ...user, phone: phone ?? user.phone ?? null, signup: { ...user.signup, step: STEP.EMAIL } }, reply: prompts.email(), done: false };
}

/** Applies a shared Telegram contact (only the user's own number is accepted). */
export function applyContact(user, contact) {
  if (user.signup?.step !== STEP.PHONE) return { user, reply: null, done: false };
  if (contact?.user_id && contact.user_id !== user.id) return { user, reply: 'Please share *your own* contact.', done: false };
  const phone = normalizePhone(contact?.phone_number);
  if (!phone) return { user, reply: prompts.phoneInvalid, done: false };
  return toEmail(user, phone);
}

function finish(user) {
  const next = { ...user, signup: null, signedUpAt: user.signedUpAt ?? new Date().toISOString() };
  return { user: next, reply: prompts.done(next), done: true };
}
