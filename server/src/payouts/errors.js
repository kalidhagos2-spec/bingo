/**
 * What a payout gateway's refusal means for the money, so the admin route and the watcher
 * can act without knowing the provider:
 *   rejected   nothing was created and it never will be (bad account, bad amount): fail the
 *              cash-out and refund the hold;
 *   retry      nothing was created, for a passing reason (outside transfer hours, no float,
 *              rate limited): put the cash-out back to pending, the operator tries later;
 *   ambiguous  we do not know whether anything was created (timeout, 5xx, garbled answer):
 *              leave it processing and let the status check settle it. NEVER send again.
 */
export class PayoutError extends Error {
  constructor(message, { kind = 'ambiguous', providerRef = null, raw = null } = {}) {
    super(message);
    this.name = 'PayoutError';
    this.kind = ['rejected', 'retry', 'ambiguous'].includes(kind) ? kind : 'ambiguous';
    this.providerRef = providerRef;
    this.raw = raw;
  }
}

/** The kind of a thrown error: PayoutError's own, anything else is ambiguous. */
export const kindOf = (err) => (err instanceof PayoutError ? err.kind : 'ambiguous');
