/**
 * Best-effort automatic check of a Telebirr receipt. Ethio Telecom publishes each
 * transaction at transactioninfo.ethiotelecom.et/receipt/<transaction id>; when the page
 * can be fetched and it mentions the transaction id, the paid amount and the house's
 * receiving number, the deposit is approved without an operator. Anything else leaves the
 * deposit pending for manual confirmation, so a format change can never credit wrongly.
 */
export const TELEBIRR_RECEIPT_URL = 'https://transactioninfo.ethiotelecom.et/receipt/';

const digits = (s) => String(s ?? '').replace(/\D/g, '');

/** Pure check on receipt text: does it confirm `amount` paid to `houseAccount` under `txId`? */
export function receiptConfirms(html, { txId, amount, houseAccount }) {
  const text = String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  if (!text.toUpperCase().includes(String(txId).toUpperCase())) return { ok: false, reason: 'transaction id not on receipt' };
  const wanted = Number(amount).toFixed(2);
  const amounts = [...text.matchAll(/(\d[\d,]*\.\d{2})/g)].map((m) => m[1].replace(/,/g, ''));
  if (!amounts.includes(wanted)) return { ok: false, reason: `amount ${wanted} not on receipt` };
  // Receipts print numbers in international form (2519…); house accounts are usually local (09…): compare without the leading zero.
  const account = digits(houseAccount).replace(/^0+/, '');
  const last4 = account.slice(-4);
  const masked = new RegExp(`\\*{2,}\\s*${last4}\\b`);
  if (!(account.length >= 6 && (digits(text).includes(account) || masked.test(text)))) return { ok: false, reason: 'house account not on receipt' };
  return { ok: true };
}

/** Fetches the public Telebirr receipt and runs `receiptConfirms`; network problems just mean "not verified". */
export async function verifyTelebirrReceipt({ txId, amount, houseAccount }, fetchImpl = globalThis.fetch) {
  const id = String(txId ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{8,14}$/.test(id)) return { ok: false, reason: 'not a Telebirr transaction id' };
  try {
    const res = await fetchImpl(TELEBIRR_RECEIPT_URL + id, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, reason: `receipt page HTTP ${res.status}` };
    return receiptConfirms(await res.text(), { txId: id, amount, houseAccount });
  } catch (err) {
    return { ok: false, reason: `receipt fetch failed: ${err.message}` };
  }
}
