/**
 * Sign-up state machine for the bot: pure functions over the stored user record so the
 * flow can be unit-tested without Telegram. Steps: name -> phone (optional) -> done.
 */
export const STEP = Object.freeze({ NAME: 'name', PHONE: 'phone' });

export const NAME_MIN = 2;
export const NAME_MAX = 32;

export const SKIP = 'Skip for now';

export const prompts = {
  name: (user) =>
    [
      `👋 Welcome${user.firstName ? `, ${user.firstName}` : ''}! Let's set up your player profile.`,
      '',
      '*Step 1 of 2 — Display name*',
      `What name should other players see? (${NAME_MIN}–${NAME_MAX} characters)`,
    ].join('\n'),
  phone: () =>
    [
      '*Step 2 of 2 — Phone number*',
      'Share your phone number so we can match wallet top-ups, payouts and transfers to your account.',
      'Tap the button below, or type it (e.g. +2519…).',
    ].join('\n'),
  done: (user) =>
    [
      `✅ Profile saved, *${user.name}*!`,
      user.phone ? `📱 ${user.phone}` : '📱 No phone yet — add it later from *My profile*.',
      '',
      'Press *Play Bingo* to open the game.',
    ].join('\n'),
  nameTooShort: `Please send a name between ${NAME_MIN} and ${NAME_MAX} characters.`,
  phoneInvalid: 'That does not look like a phone number. Tap *Share my number* or type it like +251900000000.',
};

/** Suggested name from Telegram fields. */
export function suggestedName(user) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username || `Player ${user.id}`;
}

/**
 * True once the sign-up flow has been walked through to the end, whether or not the phone
 * step was skipped. The /start and /play gates use this so a player who chose "Skip for now"
 * is not sent through the whole flow again.
 */
export function hasSignedUp(user) {
  return Boolean(user?.signedUpAt);
}

/**
 * True only when the profile holds a name and a phone -- the same rule the server's profile
 * route and the Mini App's "Sign-up incomplete" badge apply. The phone step can be skipped
 * during the flow ("add it later from *My profile*"), so a signed-up user can still have an
 * incomplete profile.
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
    if (value === SKIP) return finish({ ...user, phone: user.phone ?? null });
    const phone = normalizePhone(value);
    if (!phone) return { user, reply: prompts.phoneInvalid, done: false };
    return finish({ ...user, phone });
  }
  return { user, reply: null, done: false };
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
