import { useCallback, useEffect, useRef, useState } from 'react';
import { api, openCheckout } from '../lib/api.js';
import { ScreenHeader, BottomNav } from './Nav.jsx';

const ICONS = { telebirr: '📱', cbebirr: '🏦', boa: '🏛️', game: '🎱' };
const STATUS_STYLE = {
  paid: 'text-lime-400',
  pending: 'text-amber-300',
  failed: 'text-rose-400',
  cancelled: 'text-slate-400',
  rejected: 'text-rose-400',
};
const QUICK_AMOUNTS = [50, 100, 200, 500];
const POLL_MS = 3000;
const ACCOUNT_HINT = { telebirr: 'Telebirr phone number', cbebirr: 'CBE Birr phone or account', boa: 'Bank of Abyssinia account number' };

const fmt = (n) => Number(n ?? 0).toFixed(2);

/** ETB wallet: balance, top-up through the payment gateways, cash-out requests, activity ledger. */
export default function Wallet({ onNav, haptic }) {
  const [wallet, setWallet] = useState(null);
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState('topup'); // topup | cashout
  const [method, setMethod] = useState('');
  const [amount, setAmount] = useState('100');
  const [depositMode, setDepositMode] = useState('online'); // online | transfer
  const [txMethod, setTxMethod] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txId, setTxId] = useState('');
  const [copied, setCopied] = useState('');
  const [outMethod, setOutMethod] = useState('');
  const [outAmount, setOutAmount] = useState('');
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingRef, setPendingRef] = useState(null);
  const pollTimer = useRef(null);

  const refresh = useCallback(async () => {
    const w = await api('/payments/wallet');
    setWallet(w);
    return w;
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([api('/payments/methods'), api('/payments/wallet'), api('/profile').catch(() => null)])
      .then(([cfg, w, profile]) => {
        if (!alive) return;
        setConfig(cfg);
        setWallet(w);
        setMethod(cfg.methods[0]?.id ?? '');
        setOutMethod(cfg.methods[0]?.id ?? '');
        setTxMethod(cfg.transfer?.accounts?.[0]?.method ?? '');
        if (profile?.phone) setAccount(profile.phone);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  // Poll the pending top-up until it settles.
  useEffect(() => {
    if (!pendingRef) return undefined;
    const tick = async () => {
      try {
        const tx = await api(`/payments/${pendingRef}`);
        if (tx.status !== 'pending') {
          setPendingRef(null);
          await refresh();
          haptic?.(tx.status === 'paid' ? 'success' : 'warning');
          return;
        }
      } catch {
        /* keep polling */
      }
      pollTimer.current = setTimeout(tick, POLL_MS);
    };
    pollTimer.current = setTimeout(tick, POLL_MS);
    return () => clearTimeout(pollTimer.current);
  }, [pendingRef, refresh, haptic]);

  const run = async (fn) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  const topUp = (e) => {
    e.preventDefault();
    run(async () => {
      const { ref, checkoutUrl } = await api('/payments/topup', { method: 'POST', body: { method, amount: Number(amount) } });
      haptic?.('light');
      openCheckout(checkoutUrl);
      setPendingRef(ref);
      await refresh();
    });
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      haptic?.('light');
      setTimeout(() => setCopied(''), 1500);
    } catch {
      setError('Could not copy. Long-press the number to copy it.');
    }
  };

  const submitTransfer = (e) => {
    e.preventDefault();
    run(async () => {
      const tx = await api('/payments/deposit', { method: 'POST', body: { method: txMethod, amount: Number(txAmount), txId } });
      haptic?.('success');
      setNotice(
        tx.autoVerified
          ? `Receipt ${tx.providerRef} confirmed automatically. ${fmt(tx.credited)} ${tx.currency} added to your wallet.`
          : `Receipt ${tx.providerRef} submitted. Your wallet is credited as soon as the transfer is confirmed, usually within a few minutes.`,
      );
      setTxId('');
      setTxAmount('');
      await refresh();
    });
  };

  const cashOut = (e) => {
    e.preventDefault();
    run(async () => {
      const tx = await api('/payments/withdraw', { method: 'POST', body: { method: outMethod, amount: Number(outAmount), account } });
      haptic?.('success');
      setNotice(`Cash-out of ${fmt(-tx.amount)} ${tx.currency} requested. You will receive ${fmt(tx.payout)} ${tx.currency} once it is approved.`);
      setOutAmount('');
      await refresh();
    });
  };

  const cancel = (ref) =>
    run(async () => {
      await api(`/payments/withdraw/${ref}/cancel`, { method: 'POST' });
      haptic?.('light');
      setNotice('Cash-out cancelled and refunded to your wallet.');
      await refresh();
    });

  const currency = wallet?.currency ?? 'ETB';
  const feePercent = config?.depositFeePercent ?? 0;
  const gross = Number(amount) || 0;
  const fee = Math.round(gross * feePercent) / 100;
  const credited = Math.round((gross - fee) * 100) / 100;
  const wd = config?.withdraw ?? { min: 0, max: 0, feePercent: 0 };
  const outGross = Number(outAmount) || 0;
  const outFee = Math.round(outGross * wd.feePercent) / 100;
  const outNet = Math.round((outGross - outFee) * 100) / 100;
  const pendingOut = (wallet?.transactions ?? []).filter((t) => t.type === 'withdraw' && t.status === 'pending');
  const held = pendingOut.reduce((s, t) => s - t.amount, 0);
  const input = 'rounded-xl bg-ink-900 border border-ink-600 px-3 py-2.5 font-bold text-slate-100 outline-none focus:border-aqua-400';
  const methodCard = (selected) => `flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${selected ? 'border-aqua-400 bg-ink-700' : 'border-ink-600 bg-ink-900'}`;

  return (
    <main className="min-h-full flex flex-col items-center gap-3 px-3 py-4 bg-ink-900 text-slate-100 animate-fade-in">
      <div className="w-full max-w-sm flex flex-col gap-3">
        <ScreenHeader onBack={() => onNav('play')} title="💵 Wallet" />

        <section className="rounded-2xl bg-gradient-to-br from-lime-400 to-emerald-600 p-4 text-ink-950 shadow-lg shadow-black/30">
          <p className="text-[10px] font-black uppercase tracking-wider opacity-80">Available balance</p>
          <p className="text-4xl font-black">
            {wallet ? fmt(wallet.balance) : '—'} <span className="text-lg">{currency}</span>
          </p>
          {held > 0 && <p className="mt-1 text-xs font-bold">⏳ {fmt(held)} {currency} held for pending cash-outs</p>}
          {pendingRef && <p className="mt-1 text-xs font-bold">⏳ Waiting for payment confirmation…</p>}
        </section>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setTab('topup')} className={`py-2.5 rounded-xl text-sm font-black border ${tab === 'topup' ? 'bg-ink-700 border-aqua-400' : 'bg-ink-800 border-ink-600'}`}>
            ⬇️ Deposit
          </button>
          <button onClick={() => setTab('cashout')} className={`py-2.5 rounded-xl text-sm font-black border ${tab === 'cashout' ? 'bg-ink-700 border-aqua-400' : 'bg-ink-800 border-ink-600'}`}>
            ⬆️ Cash out
          </button>
        </div>

        {tab === 'topup' && (config?.transfer?.accounts?.length ?? 0) > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setDepositMode('online')} className={`py-2 rounded-xl text-xs font-black border ${depositMode === 'online' ? 'bg-ink-700 border-aqua-400' : 'bg-ink-800 border-ink-600'}`}>
              💳 Pay online
            </button>
            <button onClick={() => setDepositMode('transfer')} className={`py-2 rounded-xl text-xs font-black border ${depositMode === 'transfer' ? 'bg-ink-700 border-aqua-400' : 'bg-ink-800 border-ink-600'}`}>
              🧾 Transfer + receipt id
            </button>
          </div>
        )}

        {tab === 'topup' && depositMode === 'transfer' && (
          <form onSubmit={submitTransfer} className="rounded-2xl bg-ink-800 border border-ink-600/60 p-4 flex flex-col gap-3">
            <h2 className="font-black">Transfer, then paste the receipt id</h2>
            <p className="text-xs text-slate-300">1. Send the amount to one of our accounts below (tap COPY). 2. Paste the transaction id from your Telebirr / bank receipt. Telebirr receipts are checked automatically; others are confirmed by our team.</p>
            <div className="flex flex-col gap-2">
              {config.transfer.accounts.map((a) => (
                <label key={a.method} className={`${methodCard(txMethod === a.method)} items-start`}>
                  <input type="radio" name="txMethod" value={a.method} checked={txMethod === a.method} onChange={() => setTxMethod(a.method)} className="accent-aqua-400 mt-1" />
                  <span className="text-2xl">{ICONS[a.method] ?? '💳'}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[10px] font-black uppercase tracking-wider text-aqua-300">{a.label}</span>
                    {a.name && <span className="block text-xs text-slate-300">Name: {a.name}</span>}
                    <span className="block font-black text-lg tracking-wider">{a.account}</span>
                  </span>
                  <button type="button" onClick={() => copy(a.account)} className="shrink-0 rounded-lg bg-aqua-400 text-ink-950 px-3 py-1.5 text-xs font-black active:scale-95">
                    {copied === a.account ? 'COPIED ✓' : 'COPY'}
                  </button>
                </label>
              ))}
            </div>
            <div className={`flex items-center ${input} py-0`}>
              <input type="number" inputMode="decimal" min={config?.min ?? 1} max={config?.max ?? 100000} step="1" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} placeholder="Amount you sent" className="flex-1 min-w-0 bg-transparent py-3 text-lg font-black outline-none" aria-label="Transferred amount" />
              <span className="text-slate-300 font-bold">{currency}</span>
            </div>
            <label className="flex flex-col gap-1 text-xs text-slate-300">
              Transaction / receipt id
              <span className="flex gap-2">
                <input value={txId} onChange={(e) => setTxId(e.target.value.toUpperCase())} placeholder="e.g. AB12CD34EF" className={`${input} flex-1 min-w-0 uppercase tracking-widest`} aria-label="Transaction id" autoCapitalize="characters" />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setTxId((await navigator.clipboard.readText()).trim().toUpperCase());
                    } catch {
                      setError('Paste the id into the field (clipboard access was refused).');
                    }
                  }}
                  className="shrink-0 rounded-xl bg-ink-700 border border-ink-600 px-3 text-xs font-black active:scale-95"
                >
                  PASTE
                </button>
              </span>
            </label>
            {feePercent > 0 && Number(txAmount) > 0 && (
              <p className="text-xs text-slate-400">
                <span className="text-amber-300 font-bold">{feePercent}% fee</span> · you receive <span className="text-lime-400 font-black">{fmt(Math.round((Number(txAmount) - Math.round(Number(txAmount) * feePercent) / 100) * 100) / 100)} {currency}</span>
              </p>
            )}
            {error && <p className="text-sm text-rose-400">{error}</p>}
            {notice && <p className="text-sm text-lime-400">{notice}</p>}
            <button type="submit" disabled={busy || !txMethod || !(Number(txAmount) > 0) || txId.trim().length < 6} className="py-3 rounded-xl bg-gradient-to-r from-lime-400 to-emerald-600 text-ink-950 font-black active:scale-95 transition-transform disabled:opacity-50">
              {busy ? 'Submitting…' : 'Confirm my transfer'}
            </button>
          </form>
        )}

        {tab === 'topup' && depositMode === 'online' ? (
          <form onSubmit={topUp} className="rounded-2xl bg-ink-800 border border-ink-600/60 p-4 flex flex-col gap-3">
            <h2 className="font-black">Add funds</h2>
            <div className="grid grid-cols-1 gap-2">
              {(config?.methods ?? []).map((m) => (
                <label key={m.id} className={methodCard(method === m.id)}>
                  <input type="radio" name="method" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} className="accent-aqua-400" />
                  <span className="text-2xl">{ICONS[m.id] ?? '💳'}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold">{m.label}</span>
                    <span className="block text-xs text-slate-300">{m.description}</span>
                  </span>
                  {m.sandbox && <span className="text-[10px] font-black bg-amber-400 text-ink-950 px-2 py-0.5 rounded-full">SANDBOX</span>}
                </label>
              ))}
            </div>
            <div>
              <div className="flex gap-2 mb-2">
                {QUICK_AMOUNTS.map((a) => (
                  <button type="button" key={a} onClick={() => setAmount(String(a))} className={`flex-1 py-2 rounded-xl text-sm font-black border ${Number(amount) === a ? 'border-aqua-400 bg-ink-700' : 'border-ink-600 bg-ink-900'}`}>
                    {a}
                  </button>
                ))}
              </div>
              <div className={`flex items-center ${input} py-0`}>
                <input type="number" inputMode="decimal" min={config?.min ?? 1} max={config?.max ?? 100000} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="flex-1 min-w-0 bg-transparent py-3 text-lg font-black outline-none" aria-label="Amount" />
                <span className="text-slate-300 font-bold">{currency}</span>
              </div>
              {config && (
                <p className="mt-1 text-xs text-slate-400">
                  Min {config.min} · Max {config.max} {currency}
                  {feePercent > 0 && gross > 0 && (
                    <>
                      {' · '}
                      <span className="text-amber-300 font-bold">{feePercent}% fee {fmt(fee)}</span> · you receive <span className="text-lime-400 font-black">{fmt(credited)} {currency}</span>
                    </>
                  )}
                </p>
              )}
            </div>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <button type="submit" disabled={busy || !method || !config} className="py-3 rounded-xl bg-gradient-to-r from-lime-400 to-emerald-600 text-ink-950 font-black active:scale-95 transition-transform disabled:opacity-50">
              {busy ? 'Starting payment…' : `Pay ${Number(amount) || 0} ${currency}`}
            </button>
          </form>
        ) : tab === 'cashout' ? (
          <form onSubmit={cashOut} className="rounded-2xl bg-ink-800 border border-ink-600/60 p-4 flex flex-col gap-3">
            <h2 className="font-black">Cash out</h2>
            <p className="text-xs text-slate-300">The amount is held from your balance right away and paid out once the operator approves it, usually within a day.</p>
            <div className="grid grid-cols-1 gap-2">
              {(config?.methods ?? []).map((m) => (
                <label key={m.id} className={methodCard(outMethod === m.id)}>
                  <input type="radio" name="outMethod" value={m.id} checked={outMethod === m.id} onChange={() => setOutMethod(m.id)} className="accent-aqua-400" />
                  <span className="text-2xl">{ICONS[m.id] ?? '💳'}</span>
                  <span className="font-bold">{m.label}</span>
                </label>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-xs text-slate-300">
              {ACCOUNT_HINT[outMethod] ?? 'Account'}
              <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="+2519… or account number" className={input} aria-label="Payout account" />
            </label>
            <div className={`flex items-center ${input} py-0`}>
              <input type="number" inputMode="decimal" min={wd.min} max={Math.min(wd.max, wallet?.balance ?? wd.max)} step="1" value={outAmount} onChange={(e) => setOutAmount(e.target.value)} placeholder={`${wd.min} – ${wd.max}`} className="flex-1 min-w-0 bg-transparent py-3 text-lg font-black outline-none" aria-label="Cash-out amount" />
              <button type="button" onClick={() => setOutAmount(String(Math.min(Math.floor(wallet?.balance ?? 0), wd.max)))} className="text-xs font-black text-aqua-300 mr-2">
                MAX
              </button>
              <span className="text-slate-300 font-bold">{currency}</span>
            </div>
            <p className="text-xs text-slate-400">
              Min {wd.min} · Max {wd.max} {currency}
              {outGross > 0 && (
                <>
                  {' · '}
                  {wd.feePercent > 0 ? <><span className="text-amber-300 font-bold">{wd.feePercent}% fee {fmt(outFee)}</span> · </> : ''}
                  you receive <span className="text-lime-400 font-black">{fmt(outNet)} {currency}</span>
                </>
              )}
            </p>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            {notice && <p className="text-sm text-lime-400">{notice}</p>}
            <button type="submit" disabled={busy || !outMethod || !config || outGross <= 0} className="py-3 rounded-xl bg-gradient-to-r from-amber-300 to-orange-500 text-ink-950 font-black active:scale-95 transition-transform disabled:opacity-50">
              {busy ? 'Sending…' : `Request ${outGross || 0} ${currency}`}
            </button>

            {pendingOut.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {pendingOut.map((t) => (
                  <li key={t.ref} className="flex items-center justify-between rounded-xl bg-ink-700/70 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block font-bold">
                        {ICONS[t.method]} {fmt(-t.amount)} {t.currency} → {t.account}
                      </span>
                      <span className="block text-xs text-amber-300">Pending approval</span>
                    </span>
                    <button type="button" disabled={busy} onClick={() => cancel(t.ref)} className="text-xs font-black text-rose-300">
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </form>
        ) : null}

        <section className="rounded-2xl bg-ink-800 border border-ink-600/60 p-3">
          <h2 className="font-black mb-2">Recent activity</h2>
          {wallet?.transactions?.length ? (
            <ul className="flex flex-col gap-1.5">
              {wallet.transactions.map((t) => (
                <li key={t.ref} className="flex items-center justify-between rounded-xl bg-ink-700/70 px-3 py-2">
                  <span className="min-w-0">
                    <span className={`block font-bold ${t.amount < 0 ? 'text-rose-300' : ''}`}>
                      {t.type === 'withdraw' ? '⬆️' : t.type === 'deposit' ? '🧾' : (ICONS[t.method] ?? '💳')} {t.amount > 0 ? '+' : ''}
                      {fmt(t.credited ?? t.amount)} {t.currency}
                    </span>
                    <span className="block text-xs text-slate-400 truncate">
                      {t.note ? `${t.note} · ` : ''}
                      {t.type !== 'withdraw' && t.fee > 0 ? `top-up ${fmt(t.amount)} − ${fmt(t.fee)} fee · ` : ''}
                      {t.reason ? `${t.reason} · ` : ''}
                      {new Date(t.createdAt).toLocaleString()}
                    </span>
                  </span>
                  <span className={`text-xs font-black capitalize ${STATUS_STYLE[t.status] ?? ''}`}>{t.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">No activity yet.</p>
          )}
        </section>

        <BottomNav active="wallet" onNav={onNav} />
      </div>
    </main>
  );
}
