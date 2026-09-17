import { useCallback, useEffect, useMemo } from 'react';

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

  // Stable identity: screens list it in effect dependencies (the game socket must not reconnect on re-render).
  const haptic = useCallback(
    (kind = 'light') => {
      const h = tg?.HapticFeedback;
      if (!h) return;
      if (kind === 'success' || kind === 'error' || kind === 'warning') h.notificationOccurred(kind);
      else h.impactOccurred(kind);
    },
    [tg],
  );

  return { tg, user, haptic, isTelegram: Boolean(tg?.initData) };
}
