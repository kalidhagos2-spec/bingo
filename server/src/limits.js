/**
 * Responsible-play controls kept on the profile (`profile.limits`):
 *   - a daily deposit limit the player sets for themselves. Lowering it applies at once;
 *     raising or removing it only takes effect after a 24 h cooling-off, so a bad evening can't undo it.
 *   - self-exclusion for 1, 7 or 30 days: no paid or free tables, no deposits. It can be extended
 *     but never shortened, and withdrawals stay open.
 * Pure functions over the profile object; the store persists it.
 */
export const DAY_MS = 86_400_000;
export const EXCLUSION_DAYS = Object.freeze([1, 7, 30]);
export const COOLING_MS = DAY_MS;

const iso = (ms) => new Date(ms).toISOString();

/** Applies a pending change that has come due, and returns the live limits record. */
function live(profile, now) {
  const limits = (profile.limits ??= { depositLimit: null, pending: null, excludedUntil: null, ageConfirmedAt: null });
  if (limits.pending && new Date(limits.pending.at).getTime() <= now) {
    limits.depositLimit = limits.pending.amount;
    limits.pending = null;
  }
  return limits;
}

export function limitsView(profile, now = Date.now()) {
  const l = live(profile ?? {}, now);
  const until = exclusionUntil(profile ?? {}, now);
  return { depositLimit: l.depositLimit, pending: l.pending, excludedUntil: until, exclusionDays: EXCLUSION_DAYS, ageConfirmed: Boolean(l.ageConfirmedAt) };
}

export function exclusionUntil(profile, now = Date.now()) {
  const until = profile?.limits?.excludedUntil;
  return until && new Date(until).getTime() > now ? until : null;
}

/** `amount` null removes the limit. Returns { applied, effectiveAt }. */
export function setDepositLimit(profile, amount, now = Date.now()) {
  const l = live(profile, now);
  if (amount !== null && !(Number.isFinite(amount) && amount > 0)) throw new Error('Enter a limit above zero, or leave it empty to remove it');
  const value = amount === null ? null : Math.round(amount * 100) / 100;
  const stricter = value !== null && (l.depositLimit === null || value < l.depositLimit);
  if (value === l.depositLimit) {
    l.pending = null;
    return { applied: true, effectiveAt: null };
  }
  if (stricter) {
    l.depositLimit = value;
    l.pending = null;
    return { applied: true, effectiveAt: null };
  }
  l.pending = { amount: value, at: iso(now + COOLING_MS) };
  return { applied: false, effectiveAt: l.pending.at };
}

/** The player states they are 18 or older; paid tables stay closed until they have. */
export function confirmAge(profile, now = Date.now()) {
  const l = live(profile, now);
  l.ageConfirmedAt ??= iso(now);
  return l.ageConfirmedAt;
}

export const AGE_REQUIRED = 'Confirm you are 18 or older to play paid tables';

export function selfExclude(profile, days, now = Date.now()) {
  if (!EXCLUSION_DAYS.includes(days)) throw new Error(`Choose ${EXCLUSION_DAYS.join(', ')} days`);
  const l = live(profile, now);
  const current = exclusionUntil(profile, now);
  const next = now + days * DAY_MS;
  if (!current || new Date(current).getTime() < next) l.excludedUntil = iso(next);
  return l.excludedUntil;
}

/** Throws the player-facing reason when a deposit of `amount` is not allowed, given what they already deposited in the last 24 h. */
export function assertDepositAllowed(profile, amount, depositedToday, now = Date.now()) {
  const until = exclusionUntil(profile, now);
  if (until) throw new Error(`You have excluded yourself until ${until.slice(0, 10)}; deposits are paused`);
  const { depositLimit } = live(profile ?? {}, now);
  if (depositLimit !== null && depositedToday + amount > depositLimit) {
    const left = Math.max(0, Math.round((depositLimit - depositedToday) * 100) / 100);
    throw new Error(`This is over your daily deposit limit of ${depositLimit} (${left} left in the last 24 hours)`);
  }
}
