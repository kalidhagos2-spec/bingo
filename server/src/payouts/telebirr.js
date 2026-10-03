import { randomBytes } from 'node:crypto';
import { signPayload, encryptPayload, toPem } from '../payments/telebirr.js';
import { PayoutError } from './errors.js';

/**
 * Telebirr disbursement (B2C): pays a cash-out straight to the player's Telebirr number.
 *
 * Available only when the merchant credentials (TELEBIRR_APP_ID / APP_KEY / PUBLIC_KEY /
 * SHORT_CODE) and the disbursement endpoint (TELEBIRR_B2C_URL) from your Telebirr merchant
 * contract are configured. The request uses the same SHA-256 signature + RSA-encrypted
 * payload scheme as Telebirr's Web API; the endpoint path and the receiver field are the
 * ones Ethio Telecom hands out with the B2C contract, so confirm them against your
 * merchant documentation before going live. Until then cash-outs are paid by hand and
 * confirmed by receipt id.
 */
export function createTelebirrPayout(cfg, { fetchImpl = globalThis.fetch } = {}) {
  const available = Boolean(cfg?.b2cUrl && cfg.appId && cfg.appKey && cfg.publicKey && cfg.shortCode);
  const pem = available ? toPem(cfg.publicKey) : null;

  return {
    id: 'telebirr',
    label: 'Telebirr',
    available,

    /** Sends `amount` ETB to `phone` for withdrawal `ref`. Resolves { providerRef } or throws. */
    async send({ phone, amount, ref, subject = 'Telegram Bingo cash-out' }) {
      if (!available) throw new Error('Telebirr disbursement is not configured (TELEBIRR_B2C_URL and merchant credentials)');
      const payload = {
        appId: cfg.appId,
        nonce: randomBytes(16).toString('hex'),
        outTradeNo: ref,
        receiverMsisdn: String(phone).replace(/^\+/, ''),
        shortCode: cfg.shortCode,
        subject,
        timestamp: String(Date.now()),
        totalAmount: Number(amount).toFixed(2),
      };
      const res = await fetchImpl(cfg.b2cUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appid: cfg.appId, sign: signPayload(payload, cfg.appKey), ussd: encryptPayload(payload, pem) }),
      });
      const json = await res.json().catch(() => ({}));
      const providerRef = json?.data?.transactionNo ?? json?.data?.tradeNo ?? null;
      if (!res.ok || !providerRef) throw new Error(`Telebirr disbursement failed: ${json?.msg ?? res.status}`);
      return { providerRef, raw: json };
    },
  };
}

/**
 * The B2C stub in the gateway shape used by payouts/registry.js. It has no status query and
 * no callback, so a sent cash-out can only be settled by an operator who checked with Ethio
 * Telecom ("Paid by hand" with the transaction number, or "Mark failed").
 */
export function telebirrPayoutAdapter(cfg, deps = {}) {
  const stub = createTelebirrPayout(cfg, deps);
  return {
    id: 'telebirr',
    label: 'Telebirr B2C (unverified merchant API)',
    available: stub.available,
    methods: ['telebirr'],
    webhookResponse: 'success',
    async send({ ref, amount, account }) {
      try {
        const sent = await stub.send({ phone: account, amount, ref });
        return { providerRef: sent.providerRef, status: 'paid' };
      } catch (err) {
        throw new PayoutError(err.message, { kind: 'ambiguous' }); // no way to know what Ethio Telecom did with it
      }
    },
    async status() {
      return { status: 'processing', reason: 'Telebirr B2C has no status query: confirm with Ethio Telecom, then "Paid by hand" (with the transaction number) or "Mark failed"' };
    },
    async handleWebhook() {
      return null;
    },
  };
}
