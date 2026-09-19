import { useEffect, useState } from 'react';
import { api, cached } from '../lib/api.js';
import { ScreenHeader, BottomNav } from './Nav.jsx';
import { LANGS, etb, tError, tSplit, useLang, useT } from '../lib/i18n.js';

/** Player profile: the fields collected by the bot at sign-up, editable here. */
export default function Profile({ user, onNav, haptic }) {
  const t = useT();
  const [lang, setLang] = useLang();
  const [profile, setProfile] = useState(() => cached('/profile'));
  const [name, setName] = useState(() => cached('/profile')?.name ?? '');
  const [phone, setPhone] = useState(() => cached('/profile')?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    const painted = Boolean(cached('/profile')); // the form is already filled in: do not type over the player
    api('/profile')
      .then((p) => {
        if (!alive) return;
        setProfile(p);
        if (painted) return;
        setName(p.name ?? '');
        setPhone(p.phone ?? '');
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setSaved(false);
    setBusy(true);
    try {
      const p = await api('/profile', { method: 'PUT', body: { name, phone } });
      setProfile(p);
      setName(p.name ?? '');
      setPhone(p.phone ?? ''); // show the normalised values the server stored
      setSaved(true);
      haptic?.('success');
    } catch (err) {
      setError(err.message);
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  /**
   * The account is the Telegram account, so "logging out" means forgetting this device's
   * preferences and closing the Mini App; opening it again from the bot signs in afresh.
   */
  const logout = () => {
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('tgb-')) localStorage.removeItem(key);
      sessionStorage.clear();
    } catch {
      /* storage unavailable */
    }
    const tg = window.Telegram?.WebApp;
    if (tg?.initData && typeof tg.close === 'function') tg.close();
    else window.location.replace(window.location.pathname);
  };

  const display = profile?.name || user?.first_name || t('common.player');
  const [finishBefore, finishAfter] = tSplit('profile.finishBody', 'command');
  const stats = profile?.stats ?? { games: 0, wins: 0, winnings: 0 };

  return (
    <main className="h-[100dvh] overflow-hidden flex flex-col items-center gap-3 px-3 py-3 bg-ink-900 text-slate-100 animate-fade-in">
      <div className="w-full max-w-sm flex-1 min-h-0 flex flex-col gap-3">
        <ScreenHeader onBack={() => onNav('play')} title={`👤 ${t('profile.title')}`} />
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pb-1">

        <section className="rounded-2xl bg-gradient-to-br from-ink-700 to-ink-800 border border-ink-600/60 p-4 flex items-center gap-4">
          <span className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-300 to-orange-500 flex items-center justify-center text-3xl font-black text-ink-950 border-4 border-ink-600 shadow-lg">
            {display.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xl font-black truncate">{display}</span>
            <span className="block text-xs text-slate-300 truncate">
              {profile?.username ? `@${profile.username} · ` : ''}ID {profile?.id ?? user?.id ?? '—'}
            </span>
            {profile && (
              <span className={`inline-block mt-1 text-[10px] font-black px-2 py-0.5 rounded-full ${profile.complete ? 'bg-lime-400 text-ink-950' : 'bg-amber-400 text-ink-950'}`}>
                {profile.complete ? t('profile.signedUp') : t('profile.incomplete')}
              </span>
            )}
          </span>
        </section>

        {profile && !profile.complete && (
          <p className="rounded-2xl bg-amber-400/15 border border-amber-400/50 px-4 py-3 text-sm">
            <span className="font-black text-amber-300">{t('profile.finishLead')}</span> {finishBefore}
            <span className="font-bold">/start</span>
            {finishAfter}
          </p>
        )}

        <section className="grid grid-cols-3 gap-2">
          <Stat label={t('profile.stat.games')} value={stats.games} />
          <Stat label={t('profile.stat.wins')} value={stats.wins} />
          <Stat label={t('profile.stat.won')} value={etb(stats.winnings)} />
        </section>

        <section className="rounded-2xl bg-ink-800 border border-ink-600/60 px-4 py-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-black">🌐 {t('profile.language')}</h2>
          <div className="flex gap-2" role="radiogroup" aria-label={t('profile.language')}>
            {LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={lang === l.id}
                onClick={() => setLang(l.id)}
                className={`rounded-xl border px-3 py-1.5 text-sm font-black active:scale-95 ${lang === l.id ? 'bg-ink-700 border-aqua-400 text-amber-300' : 'bg-ink-900 border-ink-600 text-slate-300'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </section>

        <form onSubmit={save} className="rounded-2xl bg-ink-800 border border-ink-600/60 p-4 flex flex-col gap-3">
          <h2 className="font-black">{t('profile.fields')}</h2>
          <label className="flex flex-col gap-1 text-xs text-slate-300">
            {t('profile.displayName')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder={t('profile.displayNameHint')}
              className="rounded-xl bg-ink-900 border border-ink-600 px-3 py-2.5 text-base font-bold text-slate-100 outline-none focus:border-aqua-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-300">
            {t('profile.phone')}
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="+251900000000"
              className="rounded-xl bg-ink-900 border border-ink-600 px-3 py-2.5 text-base font-bold text-slate-100 outline-none focus:border-aqua-400"
            />
          </label>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-400">
            <dt>{t('profile.telegram')}</dt>
            <dd className="text-right text-slate-200">{profile?.firstName ?? user?.first_name ?? '—'}</dd>
            <dt>{t('profile.signedUpAt')}</dt>
            <dd className="text-right text-slate-200">{profile?.signedUpAt ? new Date(profile.signedUpAt).toLocaleDateString() : '—'}</dd>
          </dl>
          {error && <p className="text-sm text-rose-400">{tError(error)}</p>}
          {saved && !error && <p className="text-sm text-lime-400">{t('profile.saved')}</p>}
          <button type="submit" disabled={busy || !profile} className="py-3 rounded-xl bg-gradient-to-r from-amber-300 to-orange-500 text-ink-950 font-black active:scale-95 transition-transform disabled:opacity-50">
            {busy ? t('profile.saving') : t('profile.save')}
          </button>
        </form>

        </div>
        <button
          type="button"
          onClick={logout}
          className="w-full py-2.5 rounded-xl bg-ink-800 border border-rose-500/40 text-rose-300 text-sm font-black active:scale-95"
        >
          🚪 {t('profile.logout')}
        </button>

        <BottomNav active="profile" onNav={onNav} badges={{ profile: profile && !profile.complete }} />
      </div>
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-ink-800 border border-ink-600/60 text-center py-2">
      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      <span className="block text-lg font-black text-amber-300 leading-tight">{value}</span>
    </div>
  );
}
