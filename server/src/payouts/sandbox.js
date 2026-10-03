import { PayoutError } from './errors.js';

/**
 * A simulated payout gateway: no money moves. It lets the whole cash-out flow be rehearsed
 * and tested before a real provider account exists (PAYOUT_PROVIDER=sandbox).
 *
 * The outcome is decided by the last two digits of the account, so a rehearsal can pick
 * every path on purpose; anything else follows `outcome` (PAYOUT_SANDBOX_OUTCOME):
 *   …99  the transfer fails after the delay (hold refunded)
 *   …98  stays pending for ever (exercises the stale flag)
 *   …97  the first send times out (ambiguous); the status check later finds it paid
 *   …96  refused before anything is created: "Transfer hours…" (back to pending, try later)
 *   …95  refused for good: invalid account (failed, refunded)
 * A transfer is "paid" `delayMs` after it was sent, like a real queued transfer.
 */
export function createSandboxPayout({ outcome = 'success', delayMs = 15_000, webhookSecret = '', now = Date.now, decide = null } = {}) {
  const jobs = new Map(); // ref -> { providerRef, startedAt, outcome, account }

  const bySuffix = (account) => {
    const digits = String(account ?? '').replace(/\D/g, '');
    return { 99: 'failed', 98: 'pending', 97: 'timeout', 96: 'retry', 95: 'rejected' }[digits.slice(-2)] ?? null;
  };

  return {
    id: 'sandbox',
    label: 'Sandbox (simulated, no money moves)',
    available: true,
    methods: ['telebirr', 'cbebirr', 'boa'],
    webhookResponse: { received: true },

    async send({ ref, amount, method, account }) {
      const plan = decide?.({ ref, amount, method, account }) ?? bySuffix(account) ?? outcome;
      if (plan === 'rejected') throw new PayoutError('sandbox: invalid account number', { kind: 'rejected' });
      if (plan === 'retry') throw new PayoutError('sandbox: Transfer hours are Mon-Sat from 08:30 AM - 04:30 PM only', { kind: 'retry' });
      if (plan === 'timeout') {
        // The provider did take the order; we just never heard back. status() will report it paid.
        if (!jobs.has(ref)) jobs.set(ref, { providerRef: `SBX-${ref}`, startedAt: now(), outcome: 'success', account });
        throw new PayoutError('sandbox: the request timed out', { kind: 'ambiguous' });
      }
      const job = { providerRef: `SBX-${ref}`, startedAt: now(), outcome: plan, account };
      jobs.set(ref, job);
      if (delayMs === 0 && plan === 'success') return { providerRef: job.providerRef, status: 'paid' };
      if (delayMs === 0 && plan === 'failed') {
        jobs.delete(ref);
        throw new PayoutError('sandbox: simulated failure', { kind: 'rejected' });
      }
      return { providerRef: job.providerRef, status: 'processing' };
    },

    async status(ref) {
      const job = jobs.get(ref);
      if (!job) return { status: 'failed', providerRef: null, reason: 'sandbox: no record of this transfer (server restarted)' };
      if (job.outcome === 'pending' || now() - job.startedAt < delayMs) return { status: 'processing', providerRef: job.providerRef, reason: 'sandbox: still queued' };
      if (job.outcome === 'failed') return { status: 'failed', providerRef: job.providerRef, reason: 'sandbox: simulated failure' };
      return { status: 'paid', providerRef: job.providerRef };
    },

    /** POST {ref, status: paid|failed} with header x-sandbox-secret; settles the job at once. */
    async handleWebhook(req) {
      if (webhookSecret && req.get?.('x-sandbox-secret') !== webhookSecret) return null;
      const body = req.body ?? {};
      const ref = String(body.ref ?? '');
      const status = body.status === 'paid' || body.status === 'failed' ? body.status : null;
      if (!ref || !status) return null;
      const job = jobs.get(ref) ?? { providerRef: `SBX-${ref}`, account: null };
      jobs.set(ref, { ...job, outcome: status === 'paid' ? 'success' : 'failed', startedAt: -Infinity });
      return { ref, status, providerRef: job.providerRef, reason: status === 'failed' ? 'sandbox: failed by webhook' : null };
    },

    async lookupName() {
      return { name: 'Sandbox Player' };
    },
  };
}
