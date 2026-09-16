import { verifyTelebirrReceipt } from './receipts.js';
import { STATUS } from './store.js';

/**
 * Keeps checking pending Telebirr deposits against Ethio Telecom's public receipt page.
 * A player's receipt is often not published the second they paste the id, so the first
 * check at submit time can miss it; this sweeps every `intervalMs` for deposits younger
 * than `maxAgeHours` and credits the wallet as soon as the receipt confirms the transfer.
 * The operator can also trigger a check for one deposit from the dashboard (`checkOne`).
 */
export function createDepositVerifier({ store, intervalMs = 180_000, maxAgeHours = 24, fetchImpl = globalThis.fetch, now = Date.now, log = console }) {
  let timer = null;
  let running = false;

  /** Re-checks one deposit. Returns { tx, check } where check is { ok, reason? }. */
  async function checkOne(ref) {
    const tx = await store.findByRef(ref);
    if (!tx || tx.type !== 'deposit') throw new Error('Deposit not found');
    if (tx.status !== STATUS.PENDING) return { tx, check: { ok: tx.status === STATUS.PAID, reason: `already ${tx.status}` } };
    if (tx.method !== 'telebirr') return { tx, check: { ok: false, reason: 'only Telebirr receipts can be checked automatically' } };
    const check = await verifyTelebirrReceipt({ txId: tx.providerRef, amount: tx.amount, houseAccount: tx.account }, fetchImpl);
    if (check.ok) {
      const paid = await store.resolveDeposit(tx.ref, { approved: true, verified: 'auto' });
      return { tx: paid, check };
    }
    const updated = await store.update(tx.ref, { autoCheck: check.reason });
    return { tx: updated ?? tx, check };
  }

  /** One pass over every pending Telebirr deposit that is still young enough to matter. */
  async function sweep() {
    if (running) return { checked: 0, approved: 0 };
    running = true;
    try {
      const pending = await store.depositsByStatus(STATUS.PENDING, 200);
      const cutoff = now() - maxAgeHours * 3_600_000;
      let checked = 0;
      let approved = 0;
      for (const tx of pending) {
        if (tx.method !== 'telebirr' || new Date(tx.createdAt).getTime() < cutoff) continue;
        try {
          const r = await checkOne(tx.ref);
          checked++;
          if (r.check.ok) approved++;
        } catch (err) {
          log.warn(`[verifier] ${tx.ref}: ${err.message}`);
        }
      }
      if (approved) log.log(`[verifier] auto-confirmed ${approved} of ${checked} pending Telebirr deposit(s)`);
      return { checked, approved };
    } finally {
      running = false;
    }
  }

  return {
    checkOne,
    sweep,
    start() {
      if (timer || intervalMs <= 0) return;
      timer = setInterval(() => sweep().catch((err) => log.warn(`[verifier] sweep failed: ${err.message}`)), intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/**
 * Checks the public receipt of a Telebirr payout the operator sent by hand: the transaction
 * id, the net amount and the player's number must all appear on it.
 */
export function verifyPayoutReceipt({ txId, amount, account }, fetchImpl = globalThis.fetch) {
  return verifyTelebirrReceipt({ txId, amount, houseAccount: account }, fetchImpl);
}
