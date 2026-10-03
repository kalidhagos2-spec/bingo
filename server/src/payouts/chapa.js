import { createHmac, timingSafeEqual } from 'node:crypto';
import { PayoutError } from './errors.js';

/**
 * Chapa Transfers: pays a cash-out to a Telebirr wallet or an Ethiopian bank account from the
 * Chapa business balance. Docs: https://developer.chapa.co/transfer/transfers
 *
 * A transfer is asynchronous: `send` only queues it ("Transfer Queued Successfully"), and the
 * result comes later from `status` (GET /v1/transfers/verify/<reference>) and the payout
 * webhook. Our own cash-out ref is Chapa's `reference`, so a status check is always possible.
 *
 * Bank codes are Chapa's numeric ids from GET /v1/banks. Telebirr's id is not fixed in the
 * docs, so it is found by name at run time (and cached); CHAPA_BANK_CODE_<RAIL> overrides it.
 */
const BANK_MATCH = { telebirr: /telebirr/i, cbebirr: /cbe\s*birr/i, boa: /abyssinia/i };
const RETRY_MESSAGE = /transfer hours|insufficient|balance|try again|temporar|rate limit/i;
const BANKS_CACHE_MS = 6 * 3600_000;

const text = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));

/** +2519xxxxxxxx (how phones are stored) -> 09xxxxxxxx (how Chapa wants a wallet number); bank accounts: digits only. */
export function toLocalAccount(method, account) {
  const digits = String(account ?? '').replace(/\D/g, '');
  if ((method === 'telebirr' || method === 'cbebirr') && digits.length === 12 && digits.startsWith('251')) return `0${digits.slice(3)}`;
  return digits;
}

export function createChapaPayout(cfg = {}, { fetchImpl = globalThis.fetch, now = Date.now, log = console, timeoutMs = 15_000 } = {}) {
  const baseUrl = (cfg.baseUrl || 'https://api.chapa.co').replace(/\/+$/, '');
  const available = Boolean(cfg.secretKey);
  let banksCache = null; // { at, banks }
  let warnedNoSecret = false;

  async function call(method, path, body) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.secretKey}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  }

  async function banks() {
    if (banksCache && now() - banksCache.at < BANKS_CACHE_MS) return banksCache.banks;
    const { res, json } = await call('GET', '/v1/banks');
    const list = Array.isArray(json?.data) ? json.data : [];
    if (!res.ok || list.length === 0) throw new PayoutError(`Chapa: could not load the bank list (${text(json?.message) || res.status})`, { kind: 'retry' });
    banksCache = { at: now(), banks: list };
    return list;
  }

  async function resolveBankCode(method) {
    if (cfg.bankCodes?.[method]) return cfg.bankCodes[method];
    const re = BANK_MATCH[method];
    const matches = re ? (await banks()).filter((b) => re.test(String(b.name ?? ''))) : [];
    const pick = matches.find((b) => b.is_mobilemoney) ?? matches[0];
    if (!pick) throw new PayoutError(`Chapa: no bank code found for ${method}; set CHAPA_BANK_CODE_${String(method).toUpperCase()}`, { kind: 'retry' });
    return pick.id;
  }

  const hmac = (data) => createHmac('sha256', cfg.webhookSecret).update(data).digest('hex');
  const same = (a, b) => {
    const x = Buffer.from(String(a ?? ''));
    const y = Buffer.from(String(b ?? ''));
    return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
  };

  /** Both documented forms: x-chapa-signature = HMAC(payload), chapa-signature = HMAC(secret). */
  function signatureValid(req) {
    if (!cfg.webhookSecret) {
      if (!warnedNoSecret) log.warn('[payouts] CHAPA_WEBHOOK_SECRET is not set: payout webhooks are accepted unsigned (they only trigger a status check)');
      warnedNoSecret = true;
      return true;
    }
    const raw = req.rawBody ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    return same(req.get?.('x-chapa-signature'), hmac(raw)) || same(req.get?.('chapa-signature'), hmac(cfg.webhookSecret));
  }

  return {
    id: 'chapa',
    label: 'Chapa transfers',
    available,
    methods: ['telebirr', 'cbebirr', 'boa'],
    webhookResponse: { received: true },
    resolveBankCode,

    async send({ ref, amount, method, account, name }) {
      if (!available) throw new PayoutError('Chapa is not configured (CHAPA_SECRET_KEY)', { kind: 'retry' });
      const bank_code = await resolveBankCode(method);
      const body = {
        account_name: name || 'Bingo player',
        account_number: toLocalAccount(method, account),
        amount: Number(amount).toFixed(2),
        currency: 'ETB',
        reference: ref,
        bank_code,
      };
      let res;
      let json;
      try {
        ({ res, json } = await call('POST', '/v1/transfers', body));
      } catch (err) {
        throw new PayoutError(`Chapa did not answer: ${err.message}`, { kind: 'ambiguous' });
      }
      if (res.ok && json?.status === 'success') {
        const providerRef = typeof json.data === 'string' ? json.data : (json.data?.chapa_reference ?? json.data?.reference ?? null);
        return { providerRef, status: 'processing' }; // queued, never paid yet
      }
      const message = `Chapa: ${text(json?.message) || `HTTP ${res.status}`}`;
      if ([429, 401, 403].includes(res.status)) throw new PayoutError(message, { kind: 'retry', raw: json });
      if (res.status === 400 || res.status === 422) throw new PayoutError(message, { kind: RETRY_MESSAGE.test(message) ? 'retry' : 'rejected', raw: json });
      throw new PayoutError(message, { kind: 'ambiguous', raw: json });
    },

    async status(ref) {
      const { res, json } = await call('GET', `/v1/transfers/verify/${encodeURIComponent(ref)}`);
      const message = text(json?.message);
      if (res.status === 404 || (json?.status === 'failed' && /not found|no transfer|invalid reference/i.test(message))) return { status: 'unknown', providerRef: null, reason: message || 'not found' };
      if (!res.ok) throw new Error(`Chapa status check failed: ${message || `HTTP ${res.status}`}`);
      const data = json?.data ?? {};
      const s = String(data.status ?? '').toLowerCase();
      const providerRef = data.chapa_reference ?? data.bank_reference ?? data.reference ?? null;
      if (s === 'success' || s === 'successful' || s === 'completed') return { status: 'paid', providerRef };
      if (['failed', 'cancelled', 'canceled', 'reversed'].includes(s)) return { status: 'failed', providerRef, reason: text(data.message) || s };
      return { status: 'processing', providerRef, reason: s || 'queued' };
    },

    async handleWebhook(req) {
      if (!signatureValid(req)) return null;
      const body = (typeof req.body === 'object' && req.body) || {};
      const data = body.data && typeof body.data === 'object' ? body.data : body;
      const ref = data.reference ?? data.tx_ref ?? null;
      if (!ref) return null;
      const event = String(body.event ?? body.type ?? '').toLowerCase();
      const st = String(data.status ?? '').toLowerCase();
      const status = /success/.test(event) || st === 'success' ? 'paid' : /fail|cancel|revers/.test(`${event} ${st}`) ? 'failed' : 'processing';
      return { ref: String(ref), status, providerRef: data.chapa_reference ?? data.bank_reference ?? null, reason: text(data.message) || null };
    },
  };
}
