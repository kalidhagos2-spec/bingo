import { useEffect, useState } from 'react';
import { api, cached } from '../lib/api.js';
import { ScreenHeader, BottomNav } from './Nav.jsx';
import { currencyLabel, tError, tNote, useT } from '../lib/i18n.js';

const QUICK_AMOUNTS = [10, 20, 50, 100];
const fmt = (n) => Number(n ?? 0).toFixed(2);
const INPUT = 'rounded-xl bg-ink-900 border border-ink-600 px-3 py-2.5 font-bold text-slate-100 outline-none focus:border-aqua-400';

/** In-game wallet transfer: send ETB from my wallet to another player, addressed by phone number. */
export default function Transfer({ onNav, haptic }) {
  const t = useT();
  const [wallet, setWallet] = useState(() => cached('/payments/wallet'));
  const [minAmount, setMinAmount] = useState(() => cached('/payments/methods')?.p2p?.min ?? 5);
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState(null); // { id, name, phone } once the number is known
  const [lookupError, setLookupError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    const w = await api('/payments/wallet');
    setWallet(w);
    return w;
  };

  useEffect(() => {
    let alive = true;
    Promise.all([api('/payments/wallet'), api('/payments/methods')])
      .then(([w, cfg]) => {
        if (!alive) return;
        setWallet(w);
        setMinAmount(cfg.p2p?.min ?? 5);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  // Look the number up once it looks complete, so the sender sees who will receive the money.
  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    setRecipient(null);
    setLookupError('');
    if (digits.length < 9) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      api(`/payments/recipient?phone=${encodeURIComponent(phone)}`)
        .then((r) => alive && setRecipient(r))
        .catch((e) => alive && setLookupError(e.message));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [phone]);

  const send = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const r = await api('/payments/transfer', { method: 'POST', body: { phone, amount: Number(amount) } });
      haptic?.('success');
      setNotice(t('transfer.sent', { amount: `${fmt(r.amount)} ${currencyLabel(r.currency)}`, name: r.to.name, phone: r.to.phone }));
      setAmount('');
      await refresh();
    } catch (err) {
      setError(err.message);
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  const currency = currencyLabel(wallet?.currency ?? 'ETB');
  const value = Number(amount) || 0;
  const transfers = (wallet?.transactions ?? []).filter((tx) => tx.type === 'transfer');
  const canSend = Boolean(recipient) && value >= minAmount && value <= (wallet?.balance ?? 0) && !busy;

  return (
    <main className="h-[100dvh] overflow-hidden flex flex-col items-center gap-3 px-3 py-3 bg-ink-900 text-slate-100 animate-fade-in">
      <div className="w-full max-w-sm flex-1 min-h-0 flex flex-col gap-3">
        <ScreenHeader onBack={() => onNav('play')} title={`💸 ${t('transfer.title')}`} />
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pb-1">

        <section className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-800 p-4 text-ink-950 shadow-lg shadow-black/30">
          <p className="text-[10px] font-black uppercase tracking-wider opacity-80">{t('transfer.available')}</p>
          <p className="text-4xl font-black">
            {wallet ? fmt(wallet.balance) : '—'} <span className="text-lg">{currency}</span>
          </p>
        </section>

        <form onSubmit={send} className="rounded-2xl bg-ink-800 border border-ink-600/60 p-4 flex flex-col gap-3">
          <h2 className="font-black">{t('transfer.heading')}</h2>
          <p className="text-xs text-slate-300">{t('transfer.help')}</p>
          <label className="flex flex-col gap-1 text-xs text-slate-300">
            {t('transfer.phoneLabel')}
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder={t('common.phonePlaceholder')} className={INPUT} aria-label={t('transfer.phoneAria')} />
          </label>
          {recipient && (
            <p className="rounded-xl bg-lime-400/15 border border-lime-400/50 px-3 py-2 text-sm">
              <span className="font-black text-lime-300">{recipient.name}</span> <span className="text-slate-300">· {recipient.phone}</span>
            </p>
          )}
          {lookupError && <p className="text-xs text-amber-300">{tError(lookupError)}</p>}
          <div className="flex gap-2">
            {QUICK_AMOUNTS.map((a) => (
              <button type="button" key={a} onClick={() => setAmount(String(a))} className={`flex-1 py-2 rounded-xl text-sm font-black border ${value === a ? 'border-aqua-400 bg-ink-700' : 'border-ink-600 bg-ink-900'}`}>
                {a}
              </button>
            ))}
          </div>
          <div className={`flex items-center ${INPUT} py-0`}>
            <input type="number" inputMode="decimal" min={minAmount} max={wallet?.balance ?? undefined} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t('transfer.minPlaceholder', { n: minAmount })} className="flex-1 min-w-0 bg-transparent py-3 text-lg font-black outline-none" aria-label={t('transfer.amountAria')} />
            <button type="button" onClick={() => setAmount(String(Math.floor(wallet?.balance ?? 0)))} className="text-xs font-black text-aqua-300 mr-2">
              {t('common.max')}
            </button>
            <span className="text-slate-300 font-bold">{currency}</span>
          </div>
          {error && <p className="text-sm text-rose-400">{tError(error)}</p>}
          {notice && <p className="text-sm text-lime-400">{notice}</p>}
          <button type="submit" disabled={!canSend} className="py-3 rounded-xl bg-gradient-to-r from-blue-500 to-blue-700 text-ink-950 font-black active:scale-95 transition-transform disabled:opacity-50">
            {busy ? t('common.sending') : recipient ? t('transfer.sendTo', { amount: `${value || 0} ${currency}`, name: recipient.name }) : t('transfer.send', { amount: `${value || 0} ${currency}` })}
          </button>
        </form>

        <section className="rounded-2xl bg-ink-800 border border-ink-600/60 p-3">
          <h2 className="font-black mb-2">{t('transfer.recent')}</h2>
          {transfers.length ? (
            <ul className="flex flex-col gap-1.5">
              {transfers.map((tx) => (
                <li key={tx.ref} className="flex items-center justify-between rounded-xl bg-ink-700/70 px-3 py-2">
                  <span className="min-w-0">
                    <span className={`block font-bold ${tx.amount < 0 ? 'text-rose-300' : 'text-lime-300'}`}>
                      {tx.amount < 0 ? '⬆️' : '⬇️'} {tx.amount > 0 ? '+' : ''}
                      {fmt(tx.amount)} {currencyLabel(tx.currency)}
                    </span>
                    <span className="block text-xs text-slate-400 truncate">
                      {tx.note ? `${tNote(tx.note)} · ` : ''}
                      {new Date(tx.createdAt).toLocaleString()}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">{t('transfer.none')}</p>
          )}
        </section>

        </div>

        <BottomNav active="transfer" onNav={onNav} />
      </div>
    </main>
  );
}
