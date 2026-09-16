/** Loading screen shown while the Mini App boots: the logo lockup, a bingo ball and a spinner. */
export default function Splash() {
  return (
    <main className="h-[100dvh] overflow-hidden flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-indigo-900 via-ink-900 to-ink-950 text-slate-100 animate-fade-in" aria-busy="true" aria-label="Loading">
      <div className="relative">
        <span className="absolute inset-0 rounded-full bg-amber-300/30 blur-2xl animate-pulse" aria-hidden="true" />
        <span className="relative flex h-28 w-28 items-center justify-center rounded-full border-8 border-white/80 bg-gradient-to-br from-rose-500 via-amber-400 to-emerald-500 text-5xl font-black text-ink-950 shadow-[0_18px_40px_rgba(0,0,0,0.5)] animate-wiggle">
          B
        </span>
      </div>
      <div className="text-center">
        <p className="text-xs font-black uppercase tracking-[0.4em] text-sky-200/80">Telegram</p>
        <p className="mt-1 text-5xl font-black tracking-[0.15em] text-amber-300 drop-shadow-[0_4px_0_rgba(0,0,0,0.45)]">BINGO</p>
      </div>
      <div className="flex items-center gap-2 text-sm font-bold text-slate-300">
        <span className="inline-block h-5 w-5 rounded-full border-4 border-aqua-400 border-t-transparent animate-spin" aria-hidden="true" />
        Loading…
      </div>
    </main>
  );
}
