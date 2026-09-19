/**
 * Sign-up for the bot: pure functions over the stored user record so the flow can be
 * unit-tested without Telegram. Two steps: the player picks a username (one tap on their
 * Telegram name, or they type their own), then shares (or skips) their phone number.
 * Both can be changed later in the Mini App's Profile screen.
 */
import { t, allTexts, langOf, md } from './i18n.js';

export { md };

export const STEP = Object.freeze({ NAME: 'name', PHONE: 'phone' });

export const NAME_MIN = 2;
export const NAME_MAX = 32;

/** The English label; a tapped "skip" is recognised in every language (see `isSkip`). */
export const SKIP = t('en', 'signup.skip');
export const isSkip = (text) => allTexts('signup.skip').includes(String(text ?? '').trim());

/** Sign-up messages in the player's language (Amharic unless they chose English). */
export const prompts = {
  name: (user) => t(langOf(user), 'signup.name', { min: NAME_MIN, max: NAME_MAX }),
  phone: (user) => t(langOf(user), 'signup.phone', { name: md(user.name) }),
  done: (user) =>
    t(langOf(user), 'signup.done', {
      name: md(user.name),
      phoneLine: user.phone ? t(langOf(user), 'signup.donePhone', { phone: user.phone }) : t(langOf(user), 'signup.doneNoPhone'),
    }),
  nameInvalid: (user) => t(langOf(user), 'signup.nameInvalid', { min: NAME_MIN, max: NAME_MAX }),
  nameFirst: (user) => t(langOf(user), 'signup.nameFirst'),
  phoneInvalid: (user) => t(langOf(user), 'signup.phoneInvalid'),
  ownContact: (user) => t(langOf(user), 'signup.ownContact'),
};

/** Suggested name from Telegram fields, trimmed to the profile limit. */
export function suggestedName(user) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username || `Player ${user.id}`;
  return name.slice(0, NAME_MAX);
}

/** One-tap username suggestions for the first step: the Telegram @username, then the Telegram name. */
export function nameChoices(user) {
  const choices = [user.username, suggestedName(user)].map(cleanName).filter(Boolean);
  return [...new Set(choices)];
}

/** A username as it will be stored, or null: single spaces, no leading @, 2–32 characters, at least one letter. */
export function cleanName(text) {
  const name = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^@+/, '');
  if (name.length < NAME_MIN || name.length > NAME_MAX) return null;
  if (name.startsWith('/') || !/\p{L}/u.test(name)) return null;
  return name;
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

/**
 * Starts (or restarts) sign-up. A player without a username is asked for it first; one who
 * already has a name (e.g. "Update phone number" from the profile) goes straight to the phone.
 */
export function begin(user) {
  return { ...user, signup: { step: user.name ? STEP.PHONE : STEP.NAME, startedAt: new Date().toISOString() } };
}

/** The question for the step the user is at (markdown), or null outside a sign-up. */
export function promptFor(user) {
  if (user.signup?.step === STEP.NAME) return prompts.name(user);
  if (user.signup?.step === STEP.PHONE) return prompts.phone(user);
  return null;
}

/**
 * Applies a text reply. Returns { user, reply, done } where `reply` is the next prompt
 * (markdown) and `done` tells the caller the flow finished.
 */
export function applyText(user, text) {
  const value = String(text ?? '').trim();
  if (user.signup?.step === STEP.NAME) {
    const name = cleanName(value);
    if (!name) return { user, reply: prompts.nameInvalid(user), done: false };
    const next = { ...user, name, signup: { ...user.signup, step: STEP.PHONE } };
    return { user: next, reply: prompts.phone(next), done: false };
  }
  if (user.signup?.step !== STEP.PHONE) return { user, reply: null, done: false };
  if (isSkip(value)) return finish({ ...user, phone: user.phone ?? null });
  const phone = normalizePhone(value);
  if (!phone) return { user, reply: prompts.phoneInvalid(user), done: false };
  return finish({ ...user, phone });
}

/** Applies a shared Telegram contact (only the user's own number is accepted). */
export function applyContact(user, contact) {
  if (user.signup?.step === STEP.NAME) return { user, reply: prompts.nameFirst(user), done: false };
  if (user.signup?.step !== STEP.PHONE) return { user, reply: null, done: false };
  if (contact?.user_id && contact.user_id !== user.id) return { user, reply: prompts.ownContact(user), done: false };
  const phone = normalizePhone(contact?.phone_number);
  if (!phone) return { user, reply: prompts.phoneInvalid(user), done: false };
  return finish({ ...user, phone });
}

function finish(user) {
  const next = { ...user, signup: null, signedUpAt: user.signedUpAt ?? new Date().toISOString() };
  return { user: next, reply: prompts.done(next), done: true };
}
