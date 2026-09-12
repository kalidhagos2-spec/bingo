/** Email-login session token, kept per device. Telegram users never need one. */
const KEY = 'tgb-token';

export function getToken() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export const isTelegram = () => Boolean(window.Telegram?.WebApp?.initData);

/** True when the app can act as a signed-in player: inside Telegram or with an email session. */
export const isAuthed = () => isTelegram() || Boolean(getToken());
