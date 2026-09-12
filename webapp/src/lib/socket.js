import { io } from 'socket.io-client';
import { getToken } from './session.js';

/** Stable per-tab guest id so several browser tabs act as different players in dev. */
function devId() {
  try {
    let id = sessionStorage.getItem('tgb-dev-id');
    if (!id) {
      id = String(Math.floor(Math.random() * 1_000_000) + 1000);
      sessionStorage.setItem('tgb-dev-id', id);
    }
    return id;
  } catch {
    return '1';
  }
}

// Same-origin ('/') by default, matching the docker-compose setup. Set VITE_API_URL at
// build time to point this at the server's own origin when the webapp is deployed
// separately (see lib/api.js for the matching REST-call change).
const SOCKET_URL = import.meta.env.VITE_API_URL || '/';

export function connectSocket() {
  const initData = window.Telegram?.WebApp?.initData ?? '';
  const token = getToken();
  return io(SOCKET_URL, {
    path: '/socket.io',
    auth: initData ? { initData } : token ? { token } : { devId: devId() },
    transports: ['websocket', 'polling'],
  });
}

/** Promise wrapper around an acknowledged emit. */
export function request(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const cb = (res) => (res?.ok ? resolve(res) : reject(new Error(res?.error ?? 'Request failed')));
    if (payload === undefined) socket.emit(event, cb);
    else socket.emit(event, payload, cb);
  });
}
