/** Cartela skins sold in the shop. Header colours per column, plus marked / idle cell looks. */
export const THEMES = {
  classic: {
    label: 'Classic',
    cols: ['bg-rose-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-400', 'bg-violet-500'],
    marked: 'bg-lime-400 text-ink-950',
    idle: 'bg-ink-700 text-slate-100',
    frame: 'bg-ink-800 border-ink-600/60',
  },
  emerald: {
    label: 'Emerald',
    cols: ['bg-emerald-400', 'bg-emerald-500', 'bg-amber-300', 'bg-emerald-500', 'bg-emerald-400'],
    marked: 'bg-amber-300 text-emerald-950',
    idle: 'bg-emerald-900 text-emerald-50',
    frame: 'bg-emerald-950 border-emerald-500/50',
  },
  sunset: {
    label: 'Sunset',
    cols: ['bg-orange-500', 'bg-rose-500', 'bg-pink-500', 'bg-rose-500', 'bg-orange-500'],
    marked: 'bg-yellow-300 text-rose-950',
    idle: 'bg-rose-950 text-orange-50',
    frame: 'bg-[#3b0a1e] border-rose-500/50',
  },
  neon: {
    label: 'Neon',
    cols: ['bg-cyan-400', 'bg-fuchsia-500', 'bg-cyan-400', 'bg-fuchsia-500', 'bg-cyan-400'],
    marked: 'bg-fuchsia-400 text-slate-950',
    idle: 'bg-slate-950 text-cyan-100 border border-cyan-500/40',
    frame: 'bg-black border-cyan-400/60',
  },
  gold: {
    label: 'Gold',
    cols: ['bg-amber-300', 'bg-yellow-400', 'bg-amber-300', 'bg-yellow-400', 'bg-amber-300'],
    marked: 'bg-amber-300 text-amber-950',
    idle: 'bg-amber-950 text-amber-50',
    frame: 'bg-[#2a1a05] border-amber-400/60',
  },
};

export const themeFor = (name) => THEMES[name] ?? THEMES.classic;
