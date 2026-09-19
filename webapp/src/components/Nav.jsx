import { useT } from '../lib/i18n.js';

/** Shared chrome so every screen navigates the same way. Labels are the `nav.<id>` strings. */

export const NAV_ITEMS = [
  { id: 'play', icon: '🏠' },
  { id: 'missions', icon: '⭐' },
  { id: 'wallet', icon: '💵' },
  { id: 'transfer', icon: '💸' },
  { id: 'profile', icon: '👤' },
];

/** Header used by every sub-screen: back on the left, title centred, an optional right-hand slot. */
export function ScreenHeader({ onBack, title, right = null }) {
  const t = useT();
  return (
    <header className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/95 px-3 py-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.35)]">
      <button onClick={onBack} className="flex items-center gap-1 text-xs font-bold text-slate-300 transition active:text-white">
        <span className="text-base leading-none">‹</span>
        <span>{t('common.back')}</span>
      </button>
      <h1 className="text-sm font-black tracking-[0.08em] text-slate-100 uppercase">{title}</h1>
      <span className="min-w-12 text-right text-xs font-black text-amber-300">{right}</span>
    </header>
  );
}

/** Bottom bar: Lobby · Missions · Wallet · Send · Profile. `badges` marks items needing attention. */
export function BottomNav({ active, onNav, badges = {} }) {
  const t = useT();
  return (
    <nav className="mt-auto grid grid-cols-5 gap-1.5 rounded-2xl border border-white/10 bg-slate-900/95 p-2 shadow-[0_12px_30px_rgba(15,23,42,0.3)]">
      {NAV_ITEMS.map((item) => {
        const badge = badges[item.id];
        const activeItem = item.id === active;
        return (
          <button
            key={item.id}
            onClick={() => item.id !== active && onNav(item.id)}
            aria-current={activeItem ? 'page' : undefined}
            className={`relative rounded-xl border px-1 py-2 text-[10px] font-black tracking-wide transition active:scale-[0.98] ${activeItem ? 'border-aqua-300/70 bg-gradient-to-b from-aqua-400/30 to-slate-800 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]' : 'border-white/5 bg-slate-950/50 text-slate-300'}`}
          >
            <span className="block text-base leading-none">{item.icon}</span>
            <span className="mt-1 block">{t(`nav.${item.id}`)}</span>
            {badge && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-slate-900 bg-rose-500 px-1 text-[9px] font-black text-white">
                {badge === true ? '!' : badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
