import { useState } from 'react';
import { api } from '../lib/api.js';
import { setToken } from '../lib/session.js';

/** Email login for players outside Telegram: address -> one-time code -> session. */
export default function Login({ onDone, onBack, haptic }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState('email'); // email | code
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const request = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api('/auth/email/request', { method: 'POST', body: { email } });
      setStage('code');
      setInfo(r.sent ? `We sent a 6-digit code to ${r.email}.` : `Mail is not configured on this server.${r.devCode ? ` Dev code: ${r.devCode}` : ''}`);
      if (r.devCode) setCode(r.devCode);
      haptic?.('light');
    } catch (err) {
      setError(err.message);
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api('/auth/email/verify', { method: 'POST', body: { email, code } });
      setToken(r.token);
      haptic?.('success');
      onDone(r.user);
    } catch (err) {
      setError(err.message);
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-full flex flex-col items-center justify-center gap-4 px-5 py-8 bg-ink-900 text-slate-100 animate-fade-in">
      <div className="w-full max-w-xs flex flex-col gap-4">
        <div className="text-center">
          <p className="text-2xl font-black tracking-wide leading-none drop-shadow">✈️ TELEGRAM</p>
          <p className="text-4xl font-black tracking-wider leading-none text-amber-300 drop-shadow-[0_3px_0_rgba(0,0,0,0.5)]">★ BINGO ★</p>
        </div>
        <h1 className="text-center font-black text-lg">Log in with your email</h1>
        <p className="text-center text-xs text-slate-300">
          Playing inside Telegram? You are logged in automatically. Everyone else gets a one-time code by email.
        </p>

        {stage === 'email' ? (
          <form onSubmit={request} className="rounded-2xl bg-ink-800 border border-ink-600/60 p-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs text-slate-300">
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="rounded-xl bg-ink-900 border border-ink-600 px-3 py-2.5 text-base font-bold text-slate-100 outline-none focus:border-aqua-400"
              />
            </label>
            <button type="submit" disabled={busy || !email} className="py-3 rounded-xl bg-gradient-to-r from-amber-300 to-orange-500 text-ink-950 font-black active:scale-95 disabled:opacity-50">
              {busy ? 'Sending…' : 'Send me a code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="rounded-2xl bg-ink-800 border border-ink-600/60 p-4 flex flex-col gap-3">
            <p className="text-xs text-slate-300">{info}</p>
            <label className="flex flex-col gap-1 text-xs text-slate-300">
              6-digit code
              <input
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="rounded-xl bg-ink-900 border border-ink-600 px-3 py-2.5 text-2xl font-black tracking-[0.4em] text-center text-slate-100 outline-none focus:border-aqua-400"
                aria-label="Login code"
              />
            </label>
            <button type="submit" disabled={busy || code.length !== 6} className="py-3 rounded-xl bg-gradient-to-r from-lime-400 to-green-600 text-white font-black active:scale-95 disabled:opacity-50">
              {busy ? 'Checking…' : 'Log in'}
            </button>
            <button type="button" onClick={() => setStage('email')} className="text-xs text-slate-400">
              Use a different email
            </button>
          </form>
        )}

        {error && <p className="text-sm text-rose-400 text-center">{error}</p>}
        {onBack && (
          <button onClick={onBack} className="text-sm text-slate-400">
            ‹ Back
          </button>
        )}
      </div>
    </main>
  );
}
