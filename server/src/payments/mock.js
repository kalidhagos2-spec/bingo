import { STATUS } from '../store.js';

/**
 * Local sandbox gateway. Serves a fake checkout page so the full top-up flow
 * (initiate -> checkout -> webhook -> wallet credit) can run without any
 * merchant credentials. Never enable in production.
 */
export function mockProvider({ id, label, description }, { paymentUrl }) {
  return {
    id,
    label,
    description,
    available: true,
    sandbox: true,
    webhookBody: 'json',

    async initiate(tx) {
      return { checkoutUrl: paymentUrl(`/mock/checkout?ref=${tx.ref}`) };
    },

    async handleWebhook(req) {
      const { ref, outcome } = req.body ?? {};
      if (!ref) return null;
      return {
        ref,
        status: outcome === 'paid' ? STATUS.PAID : STATUS.CANCELLED,
        providerRef: `MOCK-${Date.now()}`,
      };
    },

    webhookResponse: { received: true },
  };
}

export function mockCheckoutPage(tx, { paymentUrl }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sandbox checkout</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#1e293b;padding:32px;border-radius:24px;max-width:360px;width:90%;text-align:center}
button{width:100%;padding:14px;border:0;border-radius:14px;font-size:16px;font-weight:700;margin-top:12px;cursor:pointer}
.pay{background:#10b981;color:#0f172a}.cancel{background:#334155;color:#f8fafc}
.tag{display:inline-block;background:#f59e0b;color:#0f172a;font-size:12px;font-weight:800;padding:2px 8px;border-radius:999px}</style></head>
<body><div class="card"><span class="tag">SANDBOX</span>
<h2>${esc(tx.method)} checkout</h2>
<p>Pay <strong>${esc(tx.amount.toFixed(2))} ${esc(tx.currency)}</strong><br><small>Ref ${esc(tx.ref)}</small></p>
<form method="post" action="${esc(paymentUrl('/mock/complete'))}">
<input type="hidden" name="ref" value="${esc(tx.ref)}">
<button class="pay" name="outcome" value="paid">Pay now</button>
<button class="cancel" name="outcome" value="cancelled">Cancel</button>
</form></div></body></html>`;
}
