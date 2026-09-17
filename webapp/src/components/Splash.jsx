import Logo from './Logo.jsx';

/** Loading screen shown while the Mini App boots: the USA Bingo logo and a spinner on flag navy. */
export default function Splash() {
  return (
    <main
      className="h-[100dvh] overflow-hidden flex flex-col items-center justify-center gap-8 text-slate-100 animate-fade-in"
      style={{
        background:
          'radial-gradient(circle at 50% 30%, rgba(225,29,46,0.28), transparent 45%), radial-gradient(circle at 50% 90%, rgba(255,210,0,0.16), transparent 40%), linear-gradient(180deg, #06123a 0%, #0b1f5c 55%, #030b2a 100%)',
      }}
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="relative">
        <span className="absolute inset-0 rounded-full bg-[#ffd200]/20 blur-3xl animate-pulse" aria-hidden="true" />
        <Logo size="lg" className="relative animate-wiggle" />
      </div>
      <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
        <span className="inline-block h-5 w-5 rounded-full border-4 border-[#ffd200] border-t-transparent animate-spin" aria-hidden="true" />
        Loading…
      </div>
    </main>
  );
}
