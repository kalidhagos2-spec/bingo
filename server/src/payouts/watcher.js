import { STATUS } from '../store.js';

/**
 * Settles cash-outs that a gateway accepted but has not confirmed yet (status `processing`):
 * every `intervalMs` it asks the gateway for the status of each one and marks it paid (fee
 * booked) or failed (hold refunded). The payout webhook calls `checkOne` for the same
 * purpose: a notification is only a trigger, the gateway's own answer decides.
 *
 * Same shape as createDepositVerifier: { checkOne, sweep, start, stop }.
 */
export function createPayoutWatcher({
  store,
  payout = null,
  intervalMs = 60_000,
  minAgeMs = 20_000, // a transfer sent a moment ago is not asked about yet
  maxAgeHours = 48, // after this it is flagged for a person and no longer queried
  unknownGraceMs = 15 * 60_000, // "no record of it" for this long, with nothing to show for the send, means it never left
  now = Date.now,
  log = console,
  onSettled = () => {},
}) {
  let timer = null;
  let running = false;

  const settled = (tx) => {
    try {
      onSettled(tx);
    } catch (err) {
      log.warn(`[payouts] notify after ${tx.ref}: ${err.message}`);
    }
    return tx;
  };

  /** Asks the gateway about one cash-out and settles it. Returns { tx, check: { status, reason } }. */
  async function checkOne(ref) {
    let tx = await store.findByRef(ref);
    if (!tx || tx.type !== 'withdraw') throw new Error('Withdrawal not found');
    if (tx.status !== STATUS.PROCESSING) return { tx, check: { status: tx.status, reason: `already ${tx.status}` } };
    if (!payout || tx.payoutProvider !== payout.id) {
      tx = await store.recordPayoutCheck(ref, { note: `no gateway attached for ${tx.payoutProvider ?? 'unknown provider'}` });
      return { tx, check: { status: 'processing', reason: tx.autoCheck } };
    }
    let r;
    try {
      r = await payout.status(ref);
    } catch (err) {
      tx = await store.recordPayoutCheck(ref, { note: `status check failed: ${err.message}` });
      return { tx, check: { status: 'processing', reason: tx.autoCheck } };
    }
    try {
      if (r.status === 'paid') return { tx: settled(await store.completePayout(ref, { providerRef: r.providerRef ?? tx.providerRef, verified: 'gateway' })), check: r };
      if (r.status === 'failed') return { tx: settled(await store.failPayout(ref, { reason: r.reason ?? 'the provider reported a failure', providerRef: r.providerRef })), check: r };
      if (r.status === 'unknown') {
        const age = now() - Date.parse(tx.payoutStartedAt ?? tx.updatedAt);
        if (!tx.providerRef && age > unknownGraceMs) {
          return { tx: settled(await store.failPayout(ref, { reason: 'the provider has no record of this transfer' })), check: r };
        }
        const note = tx.providerRef ? `provider lost the reference ${tx.providerRef}: contact ${payout.id}` : `not found at ${payout.id} yet`;
        tx = await store.recordPayoutCheck(ref, { note });
        return { tx, check: { ...r, status: 'processing', reason: note } };
      }
    } catch (err) {
      // Lost a race with the webhook or an operator: the row moved under us. Report what it is now.
      if (!/^Withdrawal already/.test(err.message)) throw err;
      tx = await store.findByRef(ref);
      return { tx, check: { status: tx.status, reason: err.message } };
    }
    tx = await store.recordPayoutCheck(ref, { note: r.reason ?? `still processing at ${payout.id}`, providerRef: r.providerRef ?? null });
    return { tx, check: { status: 'processing', reason: tx.autoCheck } };
  }

  /** One pass over every processing cash-out of this gateway. */
  async function sweep() {
    const out = { checked: 0, paid: 0, failed: 0, stale: 0 };
    if (running || !payout) return out;
    running = true;
    try {
      const rows = await store.withdrawalsByStatus(STATUS.PROCESSING, 200);
      for (const tx of rows) {
        if (tx.payoutProvider !== payout.id) continue;
        const started = Date.parse(tx.payoutStartedAt ?? tx.updatedAt);
        if (now() - started < minAgeMs) continue;
        if (now() - started > maxAgeHours * 3600_000) {
          if (!String(tx.autoCheck ?? '').startsWith('stale:')) {
            await store.recordPayoutCheck(tx.ref, { note: `stale: no final answer after ${maxAgeHours}h. Check with ${payout.id}, then "Paid by hand" (with its reference) or "Mark failed"` });
            log.warn(`[payouts] ${tx.ref} is stale after ${maxAgeHours}h at ${payout.id}`);
            out.stale += 1;
          }
          continue;
        }
        try {
          const { tx: after } = await checkOne(tx.ref);
          out.checked += 1;
          if (after.status === STATUS.PAID) out.paid += 1;
          else if (after.status === STATUS.FAILED) out.failed += 1;
        } catch (err) {
          log.warn(`[payouts] check ${tx.ref}: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 250)); // never hammer the provider
      }
    } finally {
      running = false;
    }
    return out;
  }

  return {
    checkOne,
    sweep,
    start() {
      if (timer || intervalMs <= 0 || !payout) return;
      timer = setInterval(() => sweep().catch((err) => log.warn(`[payouts] sweep: ${err.message}`)), intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
