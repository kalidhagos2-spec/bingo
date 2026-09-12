import { useEffect, useMemo } from 'react';

/** Thin wrapper around the Telegram WebApp SDK loaded via <script> in index.html. */
export function useTelegram() {
  const tg = useMemo(() => window.Telegram?.WebApp ?? null, []);

  useEffect(() => {
    if (!tg) return;
    tg.ready();
    tg.expand();
    if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor('#0a1a5c');
    if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor('#0a1a5c');
  }, [tg]);

  const user = tg?.initDataUnsafe?.user ?? null;

  const haptic = (kind = 'light') => {
    const h = tg?.HapticFeedback;
    if (!h) return;
    if (kind === 'success' || kind === 'error' || kind === 'warning') h.notificationOccurred(kind);
    else h.impactOccurred(kind);
  };

  return { tg, user, haptic, isTelegram: Boolean(tg?.initData) };
}
