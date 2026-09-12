/** Shared chrome so every screen navigates the same way. */

export const NAV_ITEMS = [
  { id: 'play', label: 'Lobby', icon: '🏠' },
  { id: 'missions', label: 'Missions', icon: '⭐' },
  { id: 'wallet', label: 'Wallet', icon: '💵' },
  { id: 'profile', label: 'Profile', icon: '👤' },
];

/** Header used by every sub-screen: back on the left, title centred, an optional right-hand slot. */
export function ScreenHeader({ onBack, title, right = null }) {
  return (
    <header className="flex items-center justify-between rounded-2xl bg-ink-800 border border-ink-600/60 px-3 py-2">
      <button onClick={onBack} className="text-xs font-bold text-slate-300 active:text-white">
        ‹ Back
      </button>
      <h1 className="font-black tracking-tight">{title}</h1>
      <span className="min-w-10 text-right text-xs font-black text-amber-300">{right}</span>
    </header>
  );
}

/** Bottom bar: Lobby · Missions · Wallet · Profile. `badges` marks items needing attention. */
export function BottomNav({ active, onNav, badges = {} }) {
  return (
    <nav className="mt-auto grid grid-cols-4 gap-2 pt-1">
      {NAV_ITEMS.map((item) => {
        const badge = badges[item.id];
        return (
          <button
            key={item.id}
            onClick={() => item.id !== active && onNav(item.id)}
            aria-current={item.id === active ? 'page' : undefined}
            className={`relative py-2.5 rounded-xl border text-xs font-black active:scale-95 ${item.id === active ? 'bg-ink-700 border-aqua-400' : 'bg-ink-800 border-ink-600'}`}
          >
            <span className="block text-base leading-none">{item.icon}</span>
            <span className="block mt-0.5">{item.label}</span>
            {badge && (
              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-[9px] font-black flex items-center justify-center border-2 border-ink-900">
                {badge === true ? '!' : badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
