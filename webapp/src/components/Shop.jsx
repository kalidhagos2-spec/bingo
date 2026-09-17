import { useEffect, useState } from 'react';
import { api, cached } from '../lib/api.js';
import { ScreenHeader, BottomNav } from './Nav.jsx';
import { themeFor } from '../lib/themes.js';

/** Coin shop: cartela skins (cosmetic). */
export default function Shop({ onNav, haptic }) {
  const [eco, setEco] = useState(() => cached('/economy'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api('/economy').then(setEco).catch((e) => setError(e.message));
  }, []);

  const run = async (id, path) => {
    setError('');
    setBusy(id);
    try {
      const r = await api(path, { method: 'POST' });
      setEco(r.economy);
      haptic?.('success');
    } catch (e) {
      setError(e.message);
      haptic?.('error');
    } finally {
      setBusy('');
    }
  };

  const items = eco?.shop.items ?? [];
  const skins = items.filter((i) => i.kind === 'theme');
  const boosts = items.filter((i) => i.kind === 'consumable');

  return (
    <main className="h-[100dvh] overflow-hidden flex flex-col items-center gap-3 px-3 py-3 bg-ink-900 text-slate-100 animate-fade-in">
      <div className="w-full max-w-sm flex-1 min-h-0 flex flex-col gap-3">
        <ScreenHeader onBack={() => onNav('play')} title="🛒 Shop" right={<>🪙 {eco?.coins ?? '—'}</>} />
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pb-1">

        <p className="text-xs text-slate-300 px-1">
          Earn coins from <button onClick={() => onNav('missions')} className="underline font-bold">missions</button>. Coins never convert to ETB.
        </p>

        <section>
          <h2 className="font-black mb-2 px-1">Cartela skins</h2>
          <ul className="grid grid-cols-2 gap-2">
            {[{ id: 'theme_classic', theme: 'classic', title: 'Classic cartela', price: 0, owned: true, selected: eco?.theme === 'classic' }, ...skins].map((s) => {
              const t = themeFor(s.theme);
              return (
                <li key={s.id} className={`rounded-2xl border p-2 flex flex-col gap-2 ${s.selected ? 'border-amber-400' : 'border-ink-600/60'} ${t.frame}`}>
                  <span className="grid grid-cols-5 gap-0.5">
                    {t.cols.map((c, i) => (
                      <span key={i} className={`${c} h-3 rounded-sm`} />
                    ))}
                  </span>
                  <span className="grid grid-cols-5 gap-0.5">
                    {[1, 0, 1, 0, 0, 0, 1, 0, 0, 1].map((m, i) => (
                      <span key={i} className={`h-3 rounded-sm ${m ? t.marked : t.idle}`} />
                    ))}
                  </span>
                  <span className="text-xs font-black truncate">{s.title}</span>
                  {s.selected ? (
                    <span className="text-[11px] font-black text-amber-300 text-center">In use ✓</span>
                  ) : s.owned ? (
                    <button disabled={busy === s.id} onClick={() => run(s.id, `/economy/theme/${s.theme}`)} className="rounded-lg bg-ink-700 border border-ink-600 py-1 text-[11px] font-black active:scale-95">
                      Use
                    </button>
                  ) : (
                    <button disabled={busy === s.id || (eco?.coins ?? 0) < s.price} onClick={() => run(s.id, `/economy/shop/${s.id}/buy`)} className="rounded-lg bg-gradient-to-b from-amber-300 to-orange-500 text-ink-950 py-1 text-[11px] font-black active:scale-95 disabled:opacity-40">
                      🪙 {s.price}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2 className="font-black mb-2 px-1">Boosters</h2>
          <ul className="flex flex-col gap-2">
            {boosts.map((b) => (
              <li key={b.id} className="rounded-2xl bg-ink-800 border border-ink-600/60 p-3 flex items-center gap-3">
                <span className="text-3xl">{b.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-black">
                    {b.title} {b.quantity > 0 && <span className="text-xs text-lime-400">× {b.quantity}</span>}
                  </span>
                  <span className="block text-[11px] text-slate-300">{b.desc}</span>
                </span>
                <button disabled={busy === b.id || (eco?.coins ?? 0) < b.price} onClick={() => run(b.id, `/economy/shop/${b.id}/buy`)} className="shrink-0 rounded-xl bg-gradient-to-b from-amber-300 to-orange-500 text-ink-950 px-3 py-2 text-sm font-black active:scale-95 disabled:opacity-40">
                  🪙 {b.price}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {eco?.coinLog?.length > 0 && (
          <section className="rounded-2xl bg-ink-800 border border-ink-600/60 p-3">
            <h2 className="font-black mb-1 text-sm">Coin history</h2>
            <ul className="text-xs text-slate-300 flex flex-col gap-0.5">
              {eco.coinLog.slice(0, 8).map((l, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">{l.note}</span>
                  <span className={`font-black ${l.delta < 0 ? 'text-rose-300' : 'text-lime-400'}`}>{l.delta > 0 ? '+' : ''}{l.delta}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {error && <p className="text-sm text-rose-400 text-center">{error}</p>}

        </div>
        <BottomNav active={null} onNav={onNav} />
      </div>
    </main>
  );
}
