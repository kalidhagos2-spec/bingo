import { useEffect, useState } from 'react';
import { api, cached } from '../lib/api.js';
import { ScreenHeader, BottomNav } from './Nav.jsx';
import { t, tError, tServer, tSplit, useT } from '../lib/i18n.js';

/** Daily missions: progress comes from real rounds, rewards are coins. */
export default function Missions({ onNav, haptic }) {
  const t = useT();
  const [eco, setEco] = useState(() => cached('/economy'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api('/economy').then(setEco).catch((e) => setError(e.message));
  }, []);

  const claim = async (id) => {
    setError('');
    setBusy(id);
    try {
      const r = await api(`/economy/missions/${id}/claim`, { method: 'POST' });
      setEco(r.economy);
      haptic?.('success');
    } catch (e) {
      setError(e.message);
      haptic?.('error');
    } finally {
      setBusy('');
    }
  };

  const missions = eco?.missions ?? [];
  const claimable = missions.filter((m) => m.claimable).length;
  const resetIn = eco ? untilText(eco.bonus.nextAt) : '';
  const [resetBefore, resetAfter] = tSplit('missions.resetIn', 'time');

  return (
    <main className="h-[100dvh] overflow-hidden flex flex-col items-center gap-3 px-3 py-3 bg-ink-900 text-slate-100 animate-fade-in">
      <div className="w-full max-w-sm flex-1 min-h-0 flex flex-col gap-3">
        <ScreenHeader onBack={() => onNav('play')} title={`⭐ ${t('missions.title')}`} right={<>🪙 {eco?.coins ?? '—'}</>} />
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pb-1">

        <p className="text-xs text-slate-300 px-1">
          {resetBefore}
          <span className="font-black text-white">{resetIn}</span>
          {resetAfter}
          {claimable > 0 ? ` ${t(claimable === 1 ? 'missions.ready' : 'missions.readyMany', { n: claimable })}` : ''}
        </p>

        <ul className="flex flex-col gap-2">
          {missions.map((m) => (
            <li key={m.id} className={`rounded-2xl border p-3 flex items-center gap-3 ${m.claimed ? 'bg-ink-800/60 border-ink-700 opacity-70' : m.claimable ? 'bg-gradient-to-r from-amber-400/20 to-orange-500/20 border-amber-400' : 'bg-ink-800 border-ink-600/60'}`}>
              <span className="text-3xl">{m.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-black">{tServer(`mission.${m.id}.title`, m.title)}</span>
                <span className="block text-[11px] text-slate-300">
                  {m.progress}/{m.goal} · {t('missions.reward')} 🪙 {m.reward}
                </span>
                <span className="block h-1.5 mt-1 rounded-full bg-ink-950 overflow-hidden">
                  <span className={`block h-full rounded-full ${m.done ? 'bg-amber-400' : 'bg-aqua-400'}`} style={{ width: `${(m.progress / m.goal) * 100}%` }} />
                </span>
              </span>
              {m.claimed ? (
                <span className="text-xs font-black text-lime-400">{t('missions.done')}</span>
              ) : (
                <button disabled={!m.claimable || busy === m.id} onClick={() => claim(m.id)} className="shrink-0 rounded-xl bg-gradient-to-b from-amber-300 to-orange-500 text-ink-950 px-3 py-2 text-sm font-black active:scale-95 disabled:opacity-40">
                  {t('missions.claim')}
                </button>
              )}
            </li>
          ))}
        </ul>

        {error && <p className="text-sm text-rose-400 text-center">{tError(error)}</p>}

        </div>
        <BottomNav active="missions" onNav={onNav} badges={{ missions: claimable > 0 ? claimable : false }} />
      </div>
    </main>
  );
}

export function untilText(iso) {
  const ms = Math.max(0, new Date(iso).getTime() - Date.now());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? t('time.hm', { h, m }) : t('time.m', { m });
}
