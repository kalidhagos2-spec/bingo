import { createHmac, timingSafeEqual } from 'node:crypto';
import { STATUS } from '../store.js';

/**
 * Chapa hosted checkout (https://developer.chapa.co). Chapa is a licensed Ethiopian
 * payment aggregator whose checkout page offers CBE Birr, Bank of Abyssinia, Telebirr
 * and other local rails, so one merchant account covers the bank methods.
 *
 * Crediting is driven by `GET /v1/transaction/verify/:tx_ref`, never by the webhook
 * body alone, so a forged callback cannot credit a wallet.
 */
export function chapaProvider({ id, label, description, methodHint }, cfg, { paymentUrl, fetchImpl = fetch }) {
  const configured = Boolean(cfg.secretKey);
  const headers = () => ({ authorization: `Bearer ${cfg.secretKey}`, 'content-type': 'application/json' });

  async function verifyRef(ref) {
    const res = await fetchImpl(`${cfg.baseUrl}/v1/transaction/verify/${encodeURIComponent(ref)}`, {
      headers: headers(),
    });
    const json = await res.json().catch(() => ({}));
    const status = json?.data?.status;
    if (status === 'success') return { status: STATUS.PAID, providerRef: json.data.reference ?? null };
    if (status === 'failed' || status === 'cancelled') return { status: STATUS.FAILED, providerRef: null };
    return { status: STATUS.PENDING, providerRef: null };
  }

  function signatureValid(req) {
    if (!cfg.webhookSecret) return true; // signature check is optional; verifyRef is the source of truth
    const given = req.get('chapa-signature') ?? req.get('x-chapa-signature') ?? '';
    const raw = req.rawBody ?? JSON.stringify(req.body ?? {});
    const expected = createHmac('sha256', cfg.webhookSecret).update(raw).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  return {
    id,
    label,
    description,
    available: configured,
    webhookBody: 'json',

    async initiate(tx, user) {
      const body = {
        amount: tx.amount.toFixed(2),
        currency: tx.currency,
        tx_ref: tx.ref,
        first_name: user?.first_name ?? 'Player',
        last_name: user?.last_name ?? String(user?.id ?? ''),
        callback_url: paymentUrl(`/webhook/${id}`),
        return_url: paymentUrl(`/return?ref=${tx.ref}`),
        customization: {
          title: 'Telegram Bingo',
          description: `${label} top-up${methodHint ? ` (choose ${methodHint} at checkout)` : ''}`,
        },
      };
      const res = await fetchImpl(`${cfg.baseUrl}/v1/transaction/initialize`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      const checkoutUrl = json?.data?.checkout_url;
      if (!res.ok || !checkoutUrl) {
        throw new Error(`Chapa initiate failed: ${json?.message ?? res.status}`);
      }
      return { checkoutUrl };
    },

    async handleWebhook(req) {
      if (!signatureValid(req)) return null;
      const ref = req.body?.tx_ref ?? req.query?.trx_ref ?? null;
      if (!ref) return null;
      const result = await verifyRef(ref);
      return { ref, ...result };
    },

    /** Used when the client polls a pending transaction. */
    verify: (tx) => verifyRef(tx.ref),
    webhookResponse: { received: true },
  };
}
