import { useEffect, useState } from 'react';
import { api, cached } from '../lib/api.js';
import { verifyRound } from '../lib/fair.js';
import { LETTERS } from '../lib/bingo.js';
import { ScreenHeader } from './Nav.jsx';
import { etb, tError, useT } from '../lib/i18n.js';

const letterFor = (n) => LETTERS[Math.min(4, Math.floor((n - 1) / 15))];
const short = (hash) => (hash ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : '—');

/** Finished rounds with the balls in calling order, and a check — run on this device — that they match the seed committed to before the round. */
export default function History({ onNav }) {
  const t = useT();
  const [rounds, setRounds] = useState(() => cached('/rounds')?.rounds ?? null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/rounds').then((r) => setRounds(r.rounds)).catch((e) => setError(e.message));
  }, []);

  return (
    <main className="h-[100dvh] overflow-hidden flex flex-col items-center gap-3 px-3 py-3 bg-ink-900 text-slate-100 animate-fade-in">
      <div className="w-full max-w-sm flex-1 min-h-0 flex flex-col gap-3">
        <ScreenHeader onBack={() => onNav('play')} title={`🔍 ${t('history.title')}`} />
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 pb-1">
          <p className="text-xs text-slate-300 px-1">{t('history.how')}</p>
          {rounds?.length === 0 && <p className="text-sm text-slate-400 text-center py-6">{t('history.empty')}</p>}
          {rounds?.map((r) => (
            <RoundCard key={r.id} round={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
          ))}
          {error && <p className="text-sm text-rose-400 text-center">{tError(error)}</p>}
        </div>
      </div>
    </main>
  );
}

function RoundCard({ round: r, open, onToggle }) {
  const t = useT();
  const [check, setCheck] = useState(null);

  useEffect(() => {
    if (!open || check) return;
    verifyRound(r).then(setCheck).catch(() => setCheck({ ok: false, unavailable: true }));
  }, [open, check, r]);

  const w = r.winner;
  const winning = new Set(w?.numbers ?? []);
  return (
    <section className="rounded-2xl bg-ink-800 border border-ink-600/60">
      <button onClick={onToggle} className="w-full text-left p-3 flex items-center gap-3">
        <span className="flex-1 min-w-0">
          <span className="block font-black truncate">
            {w ? t('history.won', { name: w.name, cartela: w.cartela }) : t('history.noWinner')}
            {w?.demo ? ' 🤖' : ''}
          </span>
          <span className="block text-[11px] text-slate-400">
            {new Date(r.at).toLocaleString()} · {r.stake > 0 ? etb(r.stake) : t('game.free')} · {t('history.calls', { n: r.numbersCalled ?? 0 })}
          </span>
        </span>
        {w && r.prize > 0 && <span className="font-black text-amber-300 text-sm">{etb(r.prize)}</span>}
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2 text-xs">
          {w && !w.full && w.ball ? (
            <p className="text-slate-300">{t('history.winBall', { ball: `${letterFor(w.ball)}-${w.ball}`, call: w.ballCall })}</p>
          ) : null}
          {r.called ? (
            <div className="flex flex-wrap gap-1" aria-label={t('history.balls')}>
              {r.called.map((n, i) => (
                <span key={n} title={`#${i + 1}`} className={`rounded-md px-1.5 py-0.5 font-black ${winning.has(n) ? 'bg-amber-400 text-ink-950' : 'bg-ink-700 text-slate-200'}`}>
                  {letterFor(n)}-{n}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-slate-400">{t('history.noBalls')}</p>
          )}
          <div className="rounded-xl bg-ink-900/70 p-2 flex flex-col gap-1 font-mono text-[10px] break-all">
            <span>
              <span className="font-sans font-bold text-slate-400">{t('history.commit')}: </span>
              {short(r.commit)}
            </span>
            <span>
              <span className="font-sans font-bold text-slate-400">{t('history.seed')}: </span>
              {short(r.seed)}
            </span>
          </div>
          <p className={`font-black ${check?.ok ? 'text-lime-400' : check ? 'text-rose-400' : 'text-slate-400'}`}>
            {!check ? t('history.checking') : check.unavailable ? t('history.noProof') : check.ok ? `✓ ${t('history.verified')}` : `✗ ${t('history.mismatch')}`}
          </p>
        </div>
      )}
    </section>
  );
}
