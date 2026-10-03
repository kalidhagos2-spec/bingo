import { createSandboxPayout } from './sandbox.js';
import { createChapaPayout } from './chapa.js';
import { telebirrPayoutAdapter } from './telebirr.js';

/**
 * Payout gateways: how an approved cash-out is sent to the player's Telebirr wallet or bank
 * account. One is chosen by PAYOUT_PROVIDER; `none` keeps cash-outs paid by hand and confirmed
 * by receipt id in the dashboard.
 *
 * Every gateway has the same shape:
 *   id, label, available, methods          methods: the rails (METHODS ids) it can pay to
 *   send({ ref, amount, method, account, name })
 *       -> { providerRef, status: 'processing' | 'paid' }   or throws PayoutError (see errors.js)
 *   status(ref) -> { status: 'paid' | 'failed' | 'processing' | 'unknown', providerRef?, reason? }
 *   handleWebhook(req) -> { ref, status, providerRef?, reason? } | null   (null = not ours / bad signature)
 *   webhookResponse?                       what to answer the provider with
 *   lookupName?(account, method) -> { name } | null
 * Our cash-out ref is always the provider's reference, so a status check is always possible.
 */
export const PROVIDERS = Object.freeze(['none', 'sandbox', 'chapa', 'telebirr']);

export function buildPayout(config, deps = {}) {
  const log = deps.log ?? console;
  const id = String(config.payout?.provider ?? 'none').toLowerCase();
  let gateway = null;
  if (id === 'sandbox') gateway = createSandboxPayout({ ...config.payout?.sandbox, now: deps.now });
  else if (id === 'chapa') gateway = createChapaPayout(config.chapa, deps);
  else if (id === 'telebirr') gateway = telebirrPayoutAdapter(config.telebirr, deps);
  else if (id !== 'none') log.warn(`[payouts] unknown PAYOUT_PROVIDER "${id}": cash-outs are paid by hand`);
  if (gateway && !gateway.available) {
    log.warn(`[payouts] PAYOUT_PROVIDER=${id} is not configured (missing credentials): cash-outs are paid by hand`);
    return null;
  }
  if (gateway?.id === 'sandbox') log.warn('[payouts] SIMULATED payout gateway: cash-outs are "sent" by the sandbox and NO MONEY MOVES');
  return gateway;
}

/** True when `payout` can pay cash-outs on `method`. */
export const canPay = (payout, method) => Boolean(payout?.available && payout.methods.includes(method));
