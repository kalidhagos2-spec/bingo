/**
 * A rough risk score for a deposit waiting for the operator, from signals the operator would
 * check by eye anyway. It never blocks anything: it ranks and explains so the risky ones get
 * looked at first. `history` is what this player has done before (see store.depositHistory).
 */
export function depositRisk({ tx, profile, history, now = Date.now() }) {
  const reasons = [];
  let score = 0;
  const add = (points, why) => {
    score += points;
    reasons.push(why);
  };
  const amount = Number(tx.amount);
  const signedUp = profile?.signedUpAt ? new Date(profile.signedUpAt).getTime() : null;

  if (!profile?.name || !profile?.phone) add(15, 'profile incomplete');
  if (signedUp !== null && now - signedUp < 86_400_000) add(20, 'account under a day old');
  if (!history.paidCount) {
    add(10, 'first deposit');
    if (amount >= 1000) add(20, 'large first deposit');
  } else if (amount > 5 * (history.paidTotal / history.paidCount)) {
    add(20, 'much larger than their usual deposit');
  }
  if (history.pendingCount >= 3) add(20, `${history.pendingCount} deposits waiting`);
  if (history.last24hCount >= 4) add(15, `${history.last24hCount} deposits in 24 h`);
  if (tx.payerPhone && profile?.phone && tx.payerPhone !== profile.phone) add(10, 'paid from a different phone than their profile');
  if (tx.autoCheck && !/^ok/i.test(tx.autoCheck)) add(30, 'receipt did not match automatically');
  if (!(profile?.stats?.games > 0) && history.paidCount >= 2) add(10, 'repeated deposits without playing');

  const capped = Math.min(100, score);
  return { score: capped, level: capped >= 50 ? 'high' : capped >= 25 ? 'medium' : 'low', reasons };
}
