import { useCallback, useEffect, useRef, useState } from 'react';
import { api, openCheckout } from '../lib/api.js';
import { ScreenHeader, BottomNav } from './Nav.jsx';

const ICONS = { telebirr: '📱', cbebirr: '🏦', boa: '🏛️', game: '🎱', transfer: '💸' };
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
const afterFee = (gross, percent) => Math.round((gross - Math.round(gross * percent) / 100) * 100) / 100;

const INPUT = 'rounded-xl bg-ink-900 border border-ink-600 px-3 py-2.5 font-bold text-slate-100 outline-none focus:border-aqua-400';
const PANEL = 'rounded-2xl bg-ink-800 border border-ink-600/60 p-4 flex flex-col gap-3';
const PRIMARY = 'py-3 rounded-xl bg-gradient-to-r from-lime-400 to-emerald-600 text-ink-950 font-black active:scale-95 transition-transform disabled:opacity-50';
const methodCard = (selected) => `flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${selected ? 'border-aqua-400 bg-ink-700' : 'border-ink-600 bg-ink-900'}`;
const segment = (active) => `py-2.5 rounded-xl text-sm font-black border ${active ? 'bg-ink-700 border-aqua-400' : 'bg-ink-800 border-ink-600'}`;

/**
 * ETB wallet: balance, deposits (transfer + receipt id to the house accounts, or online
 * checkout when a gateway is configured), cash-out requests and the activity ledger.
 * `hint.need` is set when the lobby sent the player here to fund a paid table.
 */
export default function Wallet({ onNav, hint = null, haptic }) {
  const [wallet, setWallet] = useState(null);
  const [config, setConfig] = useState(null);
  const [tab, setTab] = useState('deposit'); // deposit | cashout
  const [mode, setMode] = useState(null); // transfer | online
  const [method, setMethod] = useState('');
  const [amount, setAmount] = useState(hint?.need ? String(hint.need) : '100');
  const [txAccount, setTxAccount] = useState(null); // { method, account, name, label } the player paid into
  const [txAmount, setTxAmount] = useState(hint?.need ? String(hint.need) : '');
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
        setTxAccount(cfg.transfer?.accounts?.[0] ?? null);
        setOutMethod(cfg.payoutMethods?.[0]?.id ?? '');
        setMode(cfg.transfer?.accounts?.length ? 'transfer' : cfg.methods.length ? 'online' : null);
        if (profile?.phone) setAccount(profile.phone);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  // Poll a pending online top-up until it settles.
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

  const payOnline = (e) => {
    e.preventDefault();
    run(async () => {
      const { ref, checkoutUrl } = await api('/payments/topup', { method: 'POST', body: { method, amount: Number(amount) } });
      haptic?.('light');
      openCheckout(checkoutUrl);
      setPendingRef(ref);
      await refresh();
    });
  };

  /** Copies a house account number and makes it the account this deposit is for. */
  const copy = async (a) => {
    setTxAccount(a);
    try {
      await navigator.clipboard.writeText(a.account);
      setCopied(a.account);
      haptic?.('light');
      setTimeout(() => setCopied(''), 2500);
    } catch {
      setError('Could not copy. Long-press the number to copy it.');
    }
  };

  const submitTransfer = (e) => {
    e.preventDefault();
    run(async () => {
      const tx = await api('/payments/deposit', {
        method: 'POST',
        body: { method: txAccount.method, account: txAccount.account, amount: Number(txAmount), txId },
      });
      haptic?.('success');
      setNotice(
        tx.autoVerified
          ? `Receipt ${tx.providerRef} confirmed. ${fmt(tx.credited)} ${tx.currency} added to your wallet.`
          : `Receipt ${tx.providerRef} submitted. Your wallet is credited once the transfer is confirmed, usually within minutes.`,
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
      setNotice(`Cash-out of ${fmt(-tx.amount)} ${tx.currency} requested. You receive ${fmt(tx.payout)} ${tx.currency} once approved.`);
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
  const accounts = config?.transfer?.accounts ?? [];
  const online = config?.methods ?? [];
  const payoutMethods = config?.payoutMethods ?? [];
  const wd = config?.withdraw ?? { min: 0, max: 0, feePercent: 0 };
  const outGross = Number(outAmount) || 0;
  const outNet = afterFee(outGross, wd.feePercent);
  const pendingOut = (wallet?.transactions ?? []).filter((t) => t.type === 'withdraw' && t.status === 'pending');
  const held = pendingOut.reduce((s, t) => s - t.amount, 0);
  const short = hint?.need && wallet ? Math.max(0, hint.need - wallet.balance) : 0;

  const feeLine = (gross) =>
    feePercent > 0 && gross > 0 ? (
      <p className="text-xs text-slate-400">
        <span className="text-amber-300 font-bold">{feePercent}% fee</span> · you receive{' '}
        <span className="text-lime-400 font-black">
          {fmt(afterFee(gross, feePercent))} {currency}
        </span>
      </p>
    ) : null;

  const messages = (
    <>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {notice && <p className="text-sm text-lime-400">{notice}</p>}
    </>
  );

  return (
    <main className="min-h-full flex flex-col items-center gap-3 px-3 py-4 bg-ink-900 text-slate-100 animate-fade-in">
      <div className="w-full max-w-sm flex flex-col gap-3">
        <ScreenHeader onBack={() => onNav('play')} title="💵 Wallet" />

        <section className="rounded-2xl bg-gradient-to-br from-lime-400 to-emerald-600 p-4 text-ink-950 shadow-lg shadow-black/30">
          <p className="text-[10px] font-black uppercase tracking-wider opacity-80">Available balance</p>
          <p className="text-4xl font-black">
            {wallet ? fmt(wallet.balance) : '—'} <span className="text-lg">{currency}</span>
          </p>
          {held > 0 && (
            <p className="mt-1 text-xs font-bold">
              ⏳ {fmt(held)} {currency} held for pending cash-outs
            </p>
          )}
          {pendingRef && <p className="mt-1 text-xs font-bold">⏳ Waiting for payment confirmation…</p>}
        </section>

        {short > 0 && (
          <p className="rounded-xl bg-amber-400 text-ink-950 px-3 py-2 text-sm font-bold">
            Deposit at least {fmt(short)} {currency} to join the {hint.need} {currency} table.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setTab('deposit')} className={segment(tab === 'deposit')}>
            ⬇️ Deposit
          </button>
          <button onClick={() => setTab('cashout')} className={segment(tab === 'cashout')}>
            ⬆️ Cash out
          </button>
        </div>

        {tab === 'deposit' && accounts.length > 0 && online.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMode('transfer')} className={`${segment(mode === 'transfer')} text-xs py-2`}>
              🧾 Transfer + receipt
            </button>
            <button onClick={() => setMode('online')} className={`${segment(mode === 'online')} text-xs py-2`}>
              💳 Pay online
            </button>
          </div>
        )}

        {tab === 'deposit' && config && mode === null && (
          <div className={`${PANEL} text-center`}>
            <p className="font-black">Deposits open soon</p>
            <p className="text-xs text-slate-300">Our Telebirr, CBE Birr and Bank of Abyssinia accounts are being set up. Free tables are always open.</p>
          </div>
        )}

        {tab === 'deposit' && mode === 'transfer' && (
          <form onSubmit={submitTransfer} className={PANEL}>
            <h2 className="font-black uppercase tracking-wide">Bank accounts</h2>
            <div className="grid grid-cols-2 gap-2">
              {accounts.map((a) => {
                const selected = txAccount?.method === a.method && txAccount?.account === a.account;
                const done = copied === a.account;
                return (
                  <div
                    key={`${a.method}:${a.account}`}
                    role="radio"
                    aria-checked={selected}
                    tabIndex={0}
                    onClick={() => setTxAccount(a)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setTxAccount(a)}
                    className={`rounded-xl border p-2.5 flex flex-col gap-1 cursor-pointer transition-colors ${selected ? 'border-aqua-400 bg-ink-700' : 'border-ink-600 bg-ink-900'}`}
                  >
                    <span className="text-[10px] font-black uppercase tracking-wider text-aqua-300">
                      {ICONS[a.method]} {a.label}
                    </span>
                    <span className="text-xs text-slate-300 truncate">
                      Name: <span className="font-bold text-slate-100">{a.name || '—'}</span>
                    </span>
                    <span className="rounded-lg bg-ink-950 px-2 py-1.5 font-black tracking-wider text-sm select-all">{a.account}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        copy(a);
                      }}
                      className={`rounded-lg py-1.5 text-xs font-black text-ink-950 active:scale-95 ${done ? 'bg-lime-400' : 'bg-aqua-400'}`}
                    >
                      {done ? 'DONE ✓' : 'COPY'}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-slate-300">
              Send the amount to the account you copied{txAccount ? ` (${txAccount.label} · ${txAccount.account})` : ''}, then paste the receipt id below.
            </p>
            <div className={`flex items-center ${INPUT} py-0`}>
              <input type="number" inputMode="decimal" min={config.min} max={config.max} step="1" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} placeholder="Amount you sent" className="flex-1 min-w-0 bg-transparent py-3 text-lg font-black outline-none" aria-label="Transferred amount" />
              <span className="text-slate-300 font-bold">{currency}</span>
            </div>
            <div className="flex gap-2">
              <input value={txId} onChange={(e) => setTxId(e.target.value.toUpperCase())} placeholder="Receipt / transaction id" className={`${INPUT} flex-1 min-w-0 uppercase tracking-widest`} aria-label="Transaction id" autoCapitalize="characters" />
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
            </div>
            <p className="text-xs text-slate-400">
              Min {config.min} · Max {config.max} {currency}. Telebirr receipts are checked automatically; others are confirmed by our team.
            </p>
            {feeLine(Number(txAmount) || 0)}
            {messages}
            <button type="submit" disabled={busy || !txAccount || !(Number(txAmount) > 0) || txId.trim().length < 6} className={PRIMARY}>
              {busy ? 'Submitting…' : 'Confirm my transfer'}
            </button>
          </form>
        )}

        {tab === 'deposit' && mode === 'online' && (
          <form onSubmit={payOnline} className={PANEL}>
            <h2 className="font-black">Pay online</h2>
            <div className="flex flex-col gap-2">
              {online.map((m) => (
                <label key={m.id} className={methodCard(method === m.id)}>
                  <input type="radio" name="method" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} className="accent-aqua-400" />
                  <span className="text-2xl">{ICONS[m.id] ?? '💳'}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold">{m.label}</span>
                    <span className="block text-xs text-slate-300">{m.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              {QUICK_AMOUNTS.map((a) => (
                <button type="button" key={a} onClick={() => setAmount(String(a))} className={`flex-1 py-2 rounded-xl text-sm font-black border ${Number(amount) === a ? 'border-aqua-400 bg-ink-700' : 'border-ink-600 bg-ink-900'}`}>
                  {a}
                </button>
              ))}
            </div>
            <div className={`flex items-center ${INPUT} py-0`}>
              <input type="number" inputMode="decimal" min={config.min} max={config.max} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="flex-1 min-w-0 bg-transparent py-3 text-lg font-black outline-none" aria-label="Amount" />
              <span className="text-slate-300 font-bold">{currency}</span>
            </div>
            <p className="text-xs text-slate-400">
              Min {config.min} · Max {config.max} {currency}
            </p>
            {feeLine(Number(amount) || 0)}
            {messages}
            <button type="submit" disabled={busy || !method} className={PRIMARY}>
              {busy ? 'Starting payment…' : `Pay ${Number(amount) || 0} ${currency}`}
            </button>
          </form>
        )}

        {tab === 'cashout' && (
          <form onSubmit={cashOut} className={PANEL}>
            <h2 className="font-black">Cash out</h2>
            <p className="text-xs text-slate-300">The amount is held from your balance right away and paid out once approved, usually within a day.</p>
            <div className="flex flex-col gap-2">
              {payoutMethods.map((m) => (
                <label key={m.id} className={methodCard(outMethod === m.id)}>
                  <input type="radio" name="outMethod" value={m.id} checked={outMethod === m.id} onChange={() => setOutMethod(m.id)} className="accent-aqua-400" />
                  <span className="text-2xl">{ICONS[m.id] ?? '💳'}</span>
                  <span className="font-bold">{m.label}</span>
                </label>
              ))}
            </div>
            <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder={ACCOUNT_HINT[outMethod] ?? 'Payout account'} className={INPUT} aria-label="Payout account" />
            <div className={`flex items-center ${INPUT} py-0`}>
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
                  {wd.feePercent > 0 && <span className="text-amber-300 font-bold">{wd.feePercent}% fee · </span>}
                  you receive{' '}
                  <span className="text-lime-400 font-black">
                    {fmt(outNet)} {currency}
                  </span>
                </>
              )}
            </p>
            {messages}
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
        )}

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
                      {t.type !== 'withdraw' && t.fee > 0 ? `${fmt(t.amount)} − ${fmt(t.fee)} fee · ` : ''}
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
