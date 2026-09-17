// Empty by default: the app is served from the same origin as the API (docker-compose's
// nginx reverse-proxies /api there), so a relative path is correct and this is a no-op.
// Set at build time (VITE_API_URL) when the webapp is deployed separately from the server,
// e.g. the webapp on Vercel and the server on Render -- then this needs to be an absolute
// URL pointing at the server, and the server needs that webapp's origin in ALLOWED_ORIGINS.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

// Last good answer of every GET, kept for the life of the page. Screens paint from it at once
// (see `cached`) and then replace it with the fresh answer, so moving between screens never
// waits on the network.
const lastGet = new Map();

/** The previous answer of `GET path` in this session, or null. */
export const cached = (path) => lastGet.get(path) ?? null;

/** Fetch wrapper for the backend. Authenticates with Telegram initData when available. */
export async function api(path, { method = 'GET', body } = {}) {
  const initData = window.Telegram?.WebApp?.initData ?? '';
  const headers = { accept: 'application/json' };
  if (initData) headers.authorization = `tma ${initData}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`${API_BASE}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.suspended) window.dispatchEvent(new CustomEvent('tgb-suspended', { detail: data.error }));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  // A write (deposit, profile save, purchase…) may change any of the remembered answers.
  if (method === 'GET') lastGet.set(path, data);
  else lastGet.clear();
  return data;
}

/** Opens a checkout URL: external browser inside Telegram, new tab otherwise. */
export function openCheckout(url) {
  const tg = window.Telegram?.WebApp;
  if (tg?.initData && typeof tg.openLink === 'function') tg.openLink(url);
  else window.open(url, '_blank', 'noopener');
}
