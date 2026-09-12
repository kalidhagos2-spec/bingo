import { createHash, publicEncrypt, publicDecrypt, randomBytes, constants } from 'node:crypto';
import { STATUS } from '../store.js';

/**
 * Telebirr (Ethio Telecom mobile money) Web API "toTradeWebPay" integration.
 *
 * Flow: build the order payload -> SHA-256 sign (payload + appKey) -> RSA-encrypt the
 * payload with the merchant public key -> POST {appid, sign, ussd} -> redirect the user
 * to `toPayUrl`. Telebirr later POSTs an encrypted notification to `notifyUrl`.
 *
 * Credentials (appId, appKey, publicKey, shortCode) come from the Telebirr merchant
 * onboarding. Confirm status codes against the merchant documentation you receive.
 */

const TRADE_STATUS_SUCCESS = '2';
const ENCRYPT_CHUNK = 117; // RSA-1024/2048 PKCS#1 v1.5 max plaintext block
const DECRYPT_CHUNK = 256;

/** Accepts a PEM or a bare base64 SPKI key and returns PEM. */
export function toPem(key) {
  if (key.includes('-----BEGIN')) return key;
  const body = key.replace(/\s+/g, '').match(/.{1,64}/g).join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

export function signPayload(payload, appKey) {
  const all = { ...payload, appKey };
  const str = Object.keys(all)
    .sort()
    .map((k) => `${k}=${all[k]}`)
    .join('&');
  return createHash('sha256').update(str).digest('hex');
}

export function encryptPayload(payload, publicKeyPem) {
  const buf = Buffer.from(JSON.stringify(payload), 'utf8');
  const parts = [];
  for (let i = 0; i < buf.length; i += ENCRYPT_CHUNK) {
    parts.push(
      publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING }, buf.subarray(i, i + ENCRYPT_CHUNK)),
    );
  }
  return Buffer.concat(parts).toString('base64');
}

export function decryptNotification(base64, publicKeyPem) {
  const buf = Buffer.from(base64, 'base64');
  const parts = [];
  for (let i = 0; i < buf.length; i += DECRYPT_CHUNK) {
    parts.push(
      publicDecrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_PADDING }, buf.subarray(i, i + DECRYPT_CHUNK)),
    );
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

export function telebirrProvider(cfg, { paymentUrl, fetchImpl = fetch }) {
  const configured = Boolean(cfg.appId && cfg.appKey && cfg.publicKey && cfg.shortCode);
  const pem = configured ? toPem(cfg.publicKey) : null;

  return {
    id: 'telebirr',
    label: 'Telebirr',
    description: 'Ethio Telecom mobile money',
    available: configured,
    /** Telebirr posts the encrypted body as raw text. */
    webhookBody: 'text',

    async initiate(tx) {
      const payload = {
        appId: cfg.appId,
        nonce: randomBytes(16).toString('hex'),
        notifyUrl: paymentUrl('/webhook/telebirr'),
        outTradeNo: tx.ref,
        receiveName: cfg.receiveName,
        returnUrl: paymentUrl(`/return?ref=${tx.ref}`),
        shortCode: cfg.shortCode,
        subject: 'Telegram Bingo top-up',
        timeoutExpress: '30',
        timestamp: String(Date.now()),
        totalAmount: tx.amount.toFixed(2),
      };
      const body = {
        appid: cfg.appId,
        sign: signPayload(payload, cfg.appKey),
        ussd: encryptPayload(payload, pem),
      };
      const res = await fetchImpl(`${cfg.baseUrl}/ammapi/payment/service-openup/toTradeWebPay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      const checkoutUrl = json?.data?.toPayUrl;
      if (!res.ok || !checkoutUrl) {
        throw new Error(`Telebirr initiate failed: ${json?.msg ?? res.status}`);
      }
      return { checkoutUrl };
    },

    /** Returns { ref, status, providerRef } or null when the notification is unusable. */
    async handleWebhook(req) {
      const raw = typeof req.body === 'string' ? req.body : req.body?.ussd ?? '';
      if (!raw) return null;
      const data = decryptNotification(raw.trim(), pem);
      const ok = String(data.tradeStatus) === TRADE_STATUS_SUCCESS;
      return {
        ref: data.outTradeNo,
        status: ok ? STATUS.PAID : STATUS.FAILED,
        providerRef: data.tradeNo ?? data.transactionNo ?? null,
        amount: Number(data.totalAmount),
      };
    },

    webhookResponse: 'success',
  };
}
