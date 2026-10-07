/**
 * Referral rewards and table alerts, both kept in `profile.prefs` (a JSONB column).
 *
 * A player who joins through someone's link is recorded as `referredBy` once. Nothing is paid
 * at sign-up (fake accounts are free to make); the reward is coins, not money, and is paid to
 * both sides only when the new player's first deposit of at least MIN_DEPOSIT is confirmed.
 * A referrer is rewarded for at most MAX_REWARDED friends.
 */
export const REWARD_COINS = 100;
export const MIN_DEPOSIT = 50;
export const MAX_REWARDED = 20;
export const ALERT_GAP_MS = 30 * 60_000;

export const prefsOf = (profile) => (profile.prefs ??= {});

/** Records who invited this player. Only once, never themselves, only a signed-up player, only before they have deposited. */
export function setReferrer(profile, referrerId, referrerProfile, userId) {
  const prefs = prefsOf(profile);
  if (prefs.referredBy || Number(referrerId) === Number(userId)) return false;
  if (!referrerProfile?.signedUpAt) return false;
  prefs.referredBy = Number(referrerId);
  return true;
}

/**
 * Called when a deposit is confirmed. Returns the referrer's id when both players should now be
 * paid (and marks it done), else null.
 */
export function referralDue(profile, referrerProfile, creditedAmount, now = Date.now()) {
  const prefs = prefsOf(profile);
  if (!prefs.referredBy || prefs.referralPaidAt || creditedAmount < MIN_DEPOSIT) return null;
  const theirs = prefsOf(referrerProfile ?? {});
  if (!referrerProfile || (theirs.referralsPaid ?? 0) >= MAX_REWARDED) return null;
  prefs.referralPaidAt = new Date(now).toISOString();
  theirs.referralsPaid = (theirs.referralsPaid ?? 0) + 1;
  return prefs.referredBy;
}

/** Players to tell that a table is starting: opted in, not in the app right now, can afford it, not told recently. */
export function alertTargets({ profiles, stake, isConnected, balanceOf, blocked, adultOk, now = Date.now(), limit = 200 }) {
  const out = [];
  for (const [id, profile] of Object.entries(profiles)) {
    const userId = Number(id);
    const prefs = profile.prefs;
    if (!prefs?.tableAlerts || userId <= 0) continue;
    if (prefs.lastAlertAt && now - new Date(prefs.lastAlertAt).getTime() < ALERT_GAP_MS) continue;
    if (isConnected(userId) || blocked(userId)) continue;
    if (stake > 0 && (balanceOf(userId) < stake || !adultOk(userId))) continue;
    out.push(userId);
    if (out.length >= limit) break;
  }
  return out;
}
