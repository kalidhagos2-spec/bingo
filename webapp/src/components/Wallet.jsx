import { useCallback, useEffect, useRef, useState } from 'react';
import { api, cached, openCheckout } from '../lib/api.js';
import { ScreenHeader, BottomNav } from './Nav.jsx';
import { currencyLabel, tError, tNote, tServer, tSplit, useT } from '../lib/i18n.js';

const ICONS = { telebirr: '📱', cbebirr: '🏦', boa: '🏛️', game: '🎱', transfer: '💸', admin: '🛠️' };
const STATUS_STYLE = {
  paid: 'text-lime-400',
  pending: 'text-amber-300',
  failed: 'text-rose-400',
  cancelled: 'text-slate-400',
  rejected: 'text-rose-400',
};
const QUICK_AMOUNTS = [50, 100, 200, 500];
const POLL_MS = 3000;

/** Deposit by transfer when house accounts exist, else online checkout, else nothing. */
const modeOf = (cfg) => (cfg?.transfer?.accounts?.length ? 'transfer' : cfg?.methods?.length ? 'online' : null);
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
  const t = useT();
  // Painted from the last answers of this session first; the fresh ones replace them below.
  const [wallet, setWallet] = useState(() => cached('/payments/wallet'));
  const [config, setConfig] = useState(() => cached('/payments/methods'));
  const [tab, setTab] = useState('deposit'); // deposit | cashout
  const [mode, setMode] = useState(() => modeOf(cached('/payments/methods'))); // transfer | online
  const [method, setMethod] = useState(() => cached('/payments/methods')?.methods[0]?.id ?? '');
  const [amount, setAmount] = useState(hint?.need ? String(hint.need) : '100');
  const [txAccount, setTxAccount] = useState(() => cached('/payments/methods')?.transfer?.accounts?.[0] ?? null); // { method, account, name, label } the player paid into
  const [txAmount, setTxAmount] = useState(hint?.need ? String(hint.need) : '');
  const [txId, setTxId] = useState('');
  const [payerPhone, setPayerPhone] = useState(''); // optional: the number the player sent from
  const [payerName, setPayerName] = useState(''); // optional: the name printed on the receipt
  const [copied, setCopied] = useState('');
  const [outMethod, setOutMethod] = useState(() => cached('/payments/methods')?.payoutMethods?.[0]?.id ?? '');
  const [outAmount, setOutAmount] = useState('');
  const [account, setAccount] = useState(''); // Telebirr number the player wants the cash-out sent to (asked every time)
  const [profilePhone, setProfilePhone] = useState(() => cached('/profile')?.phone ?? '');
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
        setMethod((m) => (cfg.methods.some((x) => x.id === m) ? m : cfg.methods[0]?.id ?? ''));
        // Keep what the player already picked, unless the operator changed the house accounts meanwhile.
        setTxAccount((a) => cfg.transfer?.accounts?.find((x) => x.method === a?.method && x.account === a?.account) ?? cfg.transfer?.accounts?.[0] ?? null);
        setOutMethod((m) => (cfg.payoutMethods?.some((x) => x.id === m) ? m : cfg.payoutMethods?.[0]?.id ?? ''));
        setMode((m) => m ?? modeOf(cfg));
        if (profile?.phone) setProfilePhone(profile.phone);
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
      setError(t('wallet.copyFailed'));
    }
  };

  const submitTransfer = (e) => {
    e.preventDefault();
    run(async () => {
      const tx = await api('/payments/deposit', {
        method: 'POST',
        body: { method: txAccount.method, account: txAccount.account, amount: Number(txAmount), txId, payerPhone: payerPhone.trim() || undefined, payerName: payerName.trim() || undefined },
      });
      haptic?.('success');
      setNotice(
        tx.autoVerified
          ? t('wallet.notice.depositVerified', { ref: tx.providerRef, amount: `${fmt(tx.credited)} ${currencyLabel(tx.currency)}` })
          : t('wallet.notice.depositSubmitted', { ref: tx.providerRef }),
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
      setNotice(t('wallet.notice.cashoutRequested', { amount: `${fmt(-tx.amount)} ${currencyLabel(tx.currency)}`, payout: `${fmt(tx.payout)} ${currencyLabel(tx.currency)}` }));
      setOutAmount('');
      await refresh();
    });
  };

  const cancel = (ref) =>
    run(async () => {
      await api(`/payments/withdraw/${ref}/cancel`, { method: 'POST' });
      haptic?.('light');
      setNotice(t('wallet.notice.cashoutCancelled'));
      await refresh();
    });

  const currency = currencyLabel(wallet?.currency ?? 'ETB');
  const methodLabel = (m) => tServer(`method.${m.id ?? m.method}.label`, m.label);
  const feePercent = config?.depositFeePercent ?? 0;
  const accounts = config?.transfer?.accounts ?? [];
  const online = config?.methods ?? [];
  const payoutMethods = config?.payoutMethods ?? [];
  const payout = config?.payout ?? null;
  const payoutLabel = methodLabel(payoutMethods.find((m) => m.id === payout?.method) ?? { id: 'telebirr', label: 'Telebirr' });
  const wd =config?.withdraw ?? { min: 0, max: 0, feePercent: 0 };
  const outGross = Number(outAmount) || 0;
  const accountOk = account.replace(/\D/g, '').length >= 9; // a full Ethiopian mobile number
  const outNet = afterFee(outGross, wd.feePercent);
  const pendingOut = (wallet?.transactions ?? []).filter((tx) => tx.type === 'withdraw' && tx.status === 'pending');
  const held = pendingOut.reduce((s, tx) => s - tx.amount, 0);
  const short = hint?.need && wallet ? Math.max(0, hint.need - wallet.balance) : 0;
  // Sentences with a bold account number in the middle: the text before and after it.
  const [fromBefore, fromAfter] = tSplit('wallet.cashout.from', 'account');
  const [sendBefore, sendAfter] = tSplit('wallet.cashout.willSend', 'account', { amount: `${fmt(outNet)} ${currency}`, method: payoutLabel });

  const feeLine = (gross) =>
    feePercent > 0 && gross > 0 ? (
      <p className="text-xs text-slate-400">
        <span className="text-amber-300 font-bold">{t('wallet.fee', { percent: feePercent })}</span> · {t('wallet.youReceive')}{' '}
        <span className="text-lime-400 font-black">
          {fmt(afterFee(gross, feePercent))} {currency}
        </span>
      </p>
    ) : null;

  const messages = (
    <>
      {error && <p className="text-sm text-rose-400">{tError(error)}</p>}
      {notice && <p className="text-sm text-lime-400">{notice}</p>}
    </>
  );

  return (
    <main className="h-[100dvh] overflow-hidden flex flex-col items-center gap-3 px-3 py-3 bg-ink-900 text-slate-100 animate-fade-in">
      <div className="w-full max-w-sm flex-1 min-h-0 flex flex-col gap-3">
        <ScreenHeader onBack={() => onNav('play')} title={`💵 ${t('wallet.title')}`} />
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pb-1">

        <section className="rounded-2xl bg-gradient-to-br from-lime-400 to-emerald-600 p-4 text-ink-950 shadow-lg shadow-black/30">
          <p className="text-[10px] font-black uppercase tracking-wider opacity-80">{t('wallet.available')}</p>
          <p className="text-4xl font-black">
            {wallet ? fmt(wallet.balance) : '—'} <span className="text-lg">{currency}</span>
          </p>
          {held > 0 && (
            <p className="mt-1 text-xs font-bold">
              ⏳ {t('wallet.held', { amount: `${fmt(held)} ${currency}` })}
            </p>
          )}
          {pendingRef && <p className="mt-1 text-xs font-bold">⏳ {t('wallet.waitingPayment')}</p>}
          <button type="button" onClick={() => onNav('transfer')} className="mt-3 w-full rounded-xl bg-ink-950/80 text-slate-100 py-2 text-sm font-black active:scale-95">
            💸 {t('wallet.sendToPlayer')}
          </button>
        </section>

        {short > 0 && (
          <p className="rounded-xl bg-amber-400 text-ink-950 px-3 py-2 text-sm font-bold">
            {t('wallet.short', { amount: `${fmt(short)} ${currency}`, table: `${hint.need} ${currency}` })}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setTab('deposit')} className={segment(tab === 'deposit')}>
            ⬇️ {t('wallet.tab.deposit')}
          </button>
          <button onClick={() => setTab('cashout')} className={segment(tab === 'cashout')}>
            ⬆️ {t('wallet.tab.cashout')}
          </button>
        </div>

        {tab === 'deposit' && accounts.length > 0 && online.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMode('transfer')} className={`${segment(mode === 'transfer')} text-xs py-2`}>
              🧾 {t('wallet.mode.transfer')}
            </button>
            <button onClick={() => setMode('online')} className={`${segment(mode === 'online')} text-xs py-2`}>
              💳 {t('wallet.mode.online')}
            </button>
          </div>
        )}

        {tab === 'deposit' && config && mode === null && (
          <div className={`${PANEL} text-center`}>
            <p className="font-black">{t('wallet.soonTitle')}</p>
            <p className="text-xs text-slate-300">{t('wallet.soonBody')}</p>
          </div>
        )}

        {tab === 'deposit' && mode === 'transfer' && (
          <form onSubmit={submitTransfer} className={PANEL}>
            <h2 className="font-black uppercase tracking-wide">{t('wallet.bankAccounts')}</h2>
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
                      {ICONS[a.method]} {methodLabel(a)}
                    </span>
                    <span className="text-xs text-slate-300 truncate">
                      {t('wallet.accountName')} <span className="font-bold text-slate-100">{a.name || '—'}</span>
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
                      {done ? t('wallet.copied') : t('wallet.copy')}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-slate-300">
              {t('wallet.sendInstruction', { account: txAccount ? ` (${methodLabel(txAccount)} · ${txAccount.account})` : '' })}
            </p>
            <div className={`flex items-center ${INPUT} py-0`}>
              <input type="number" inputMode="decimal" min={config.min} max={config.max} step="1" value={txAmount} onChange={(e) => setTxAmount(e.target.value)} placeholder={t('wallet.amountSent')} className="flex-1 min-w-0 bg-transparent py-3 text-lg font-black outline-none" aria-label={t('wallet.amountSentAria')} />
              <span className="text-slate-300 font-bold">{currency}</span>
            </div>
            <div className="flex gap-2">
              <input value={txId} onChange={(e) => setTxId(e.target.value.toUpperCase())} placeholder={t('wallet.receiptId')} className={`${INPUT} flex-1 min-w-0 uppercase tracking-widest`} aria-label={t('wallet.receiptIdAria')} autoCapitalize="characters" />
              <button
                type="button"
                onClick={async () => {
                  try {
                    setTxId((await navigator.clipboard.readText()).trim().toUpperCase());
                  } catch {
                    setError(t('wallet.pasteFailed'));
                  }
                }}
                className="shrink-0 rounded-xl bg-ink-700 border border-ink-600 px-3 text-xs font-black active:scale-95"
              >
                {t('wallet.paste')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                {t('wallet.payerPhone')} <span className="text-slate-500">{t('common.optional')}</span>
                <input value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} inputMode="tel" placeholder={profilePhone || '09…'} className={`${INPUT} min-w-0`} aria-label={t('wallet.payerPhone')} />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-400">
                {t('wallet.payerName')} <span className="text-slate-500">{t('common.optional')}</span>
                <input value={payerName} onChange={(e) => setPayerName(e.target.value)} maxLength={60} placeholder={t('wallet.senderName')} className={`${INPUT} min-w-0`} aria-label={t('wallet.payerName')} />
              </label>
            </div>
            <p className="text-xs text-slate-400">
              {t('wallet.transferHelp', { limits: t('wallet.limits', { min: config.min, max: config.max, currency }) })}
            </p>
            {feeLine(Number(txAmount) || 0)}
            {messages}
            <button type="submit" disabled={busy || !txAccount || !(Number(txAmount) > 0) || txId.trim().length < 6} className={PRIMARY}>
              {busy ? t('wallet.submitting') : t('wallet.confirmTransfer')}
            </button>
          </form>
        )}

        {tab === 'deposit' && mode === 'online' && (
          <form onSubmit={payOnline} className={PANEL}>
            <h2 className="font-black">{t('wallet.mode.online')}</h2>
            <div className="flex flex-col gap-2">
              {online.map((m) => (
                <label key={m.id} className={methodCard(method === m.id)}>
                  <input type="radio" name="method" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} className="accent-aqua-400" />
                  <span className="text-2xl">{ICONS[m.id] ?? '💳'}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold">{methodLabel(m)}</span>
                    <span className="block text-xs text-slate-300">{tServer(`method.${m.id}.desc`, m.description)}</span>
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
              <input type="number" inputMode="decimal" min={config.min} max={config.max} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="flex-1 min-w-0 bg-transparent py-3 text-lg font-black outline-none" aria-label={t('wallet.amountAria')} />
              <span className="text-slate-300 font-bold">{currency}</span>
            </div>
            <p className="text-xs text-slate-400">
              {t('wallet.limits', { min: config.min, max: config.max, currency })}
            </p>
            {feeLine(Number(amount) || 0)}
            {messages}
            <button type="submit" disabled={busy || !method} className={PRIMARY}>
              {busy ? t('wallet.startingPayment') : t('wallet.pay', { amount: `${Number(amount) || 0} ${currency}` })}
            </button>
          </form>
        )}

        {tab === 'cashout' && (
          <form onSubmit={cashOut} className={PANEL}>
            <h2 className="font-black">{t('wallet.cashout.title')}</h2>
            <p className="text-xs text-slate-300">
              {t('wallet.cashout.help')}
              {payout?.account && (
                <>
                  {' '}
                  {fromBefore}
                  <span className="font-black text-slate-100">{payoutLabel} {payout.account}</span>
                  {payout.name ? ` (${payout.name})` : ''}
                  {fromAfter}
                </>
              )}
            </p>
            <div className={`flex flex-col gap-2 ${payoutMethods.length < 2 ? 'hidden' : ''}`}>
              {payoutMethods.map((m) => (
                <label key={m.id} className={methodCard(outMethod === m.id)}>
                  <input type="radio" name="outMethod" value={m.id} checked={outMethod === m.id} onChange={() => setOutMethod(m.id)} className="accent-aqua-400" />
                  <span className="text-2xl">{ICONS[m.id] ?? '💳'}</span>
                  <span className="font-bold">{methodLabel(m)}</span>
                </label>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-xs text-slate-300">
              <span className="font-black text-slate-100">📱 {t('wallet.cashout.which', { method: payoutLabel })}</span>
              <input value={account} onChange={(e) => setAccount(e.target.value)} inputMode="tel" required placeholder={t('common.phonePlaceholder')} className={INPUT} aria-label={t('wallet.cashout.accountAria', { method: payoutLabel })} />
            </label>
            {profilePhone && account.trim() !== profilePhone && (
              <button type="button" onClick={() => setAccount(profilePhone)} className="self-start rounded-lg bg-ink-700 border border-ink-600 px-3 py-1.5 text-xs font-black text-aqua-300 active:scale-95">
                {t('wallet.cashout.useMine', { phone: profilePhone })}
              </button>
            )}
            {accountOk && outGross > 0 && (
              <p className="text-xs text-lime-300">
                {sendBefore}
                <span className="font-black">{account.trim()}</span>
                {sendAfter}
              </p>
            )}
            <div className={`flex items-center ${INPUT} py-0`}>
              <input type="number" inputMode="decimal" min={wd.min} max={Math.min(wd.max, wallet?.balance ?? wd.max)} step="1" value={outAmount} onChange={(e) => setOutAmount(e.target.value)} placeholder={`${wd.min} – ${wd.max}`} className="flex-1 min-w-0 bg-transparent py-3 text-lg font-black outline-none" aria-label={t('wallet.cashout.amountAria')} />
              <button type="button" onClick={() => setOutAmount(String(Math.min(Math.floor(wallet?.balance ?? 0), wd.max)))} className="text-xs font-black text-aqua-300 mr-2">
                {t('common.max')}
              </button>
              <span className="text-slate-300 font-bold">{currency}</span>
            </div>
            <p className="text-xs text-slate-400">
              {t('wallet.limits', { min: wd.min, max: wd.max, currency })}
              {outGross > 0 && (
                <>
                  {' · '}
                  {wd.feePercent > 0 && <span className="text-amber-300 font-bold">{t('wallet.fee', { percent: wd.feePercent })} · </span>}
                  {t('wallet.youReceive')}{' '}
                  <span className="text-lime-400 font-black">
                    {fmt(outNet)} {currency}
                  </span>
                </>
              )}
            </p>
            {messages}
            <button type="submit" disabled={busy || !outMethod || !config || outGross <= 0 || !accountOk} className="py-3 rounded-xl bg-gradient-to-r from-amber-300 to-orange-500 text-ink-950 font-black active:scale-95 transition-transform disabled:opacity-50">
              {busy ? t('common.sending') : t('wallet.cashout.request', { amount: `${outGross || 0} ${currency}` })}
            </button>
            {pendingOut.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {pendingOut.map((tx) => (
                  <li key={tx.ref} className="flex items-center justify-between rounded-xl bg-ink-700/70 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block font-bold">
                        {ICONS[tx.method]} {fmt(-tx.amount)} {currencyLabel(tx.currency)} → {tx.account}
                      </span>
                      <span className="block text-xs text-amber-300">{t('wallet.cashout.pending')}</span>
                    </span>
                    <button type="button" disabled={busy} onClick={() => cancel(tx.ref)} className="text-xs font-black text-rose-300">
                      {t('wallet.cashout.cancel')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </form>
        )}

        <section className="rounded-2xl bg-ink-800 border border-ink-600/60 p-3">
          <h2 className="font-black mb-2">{t('wallet.activity')}</h2>
          {wallet?.transactions?.length ? (
            <ul className="flex flex-col gap-1.5">
              {wallet.transactions.map((tx) => (
                <li key={tx.ref} className="flex items-center justify-between rounded-xl bg-ink-700/70 px-3 py-2">
                  <span className="min-w-0">
                    <span className={`block font-bold ${tx.amount < 0 ? 'text-rose-300' : ''}`}>
                      {tx.type === 'withdraw' ? '⬆️' : tx.type === 'deposit' ? '🧾' : (ICONS[tx.method] ?? '💳')} {tx.amount > 0 ? '+' : ''}
                      {fmt(tx.credited ?? tx.amount)} {currencyLabel(tx.currency)}
                    </span>
                    <span className="block text-xs text-slate-400 truncate">
                      {tx.note ? `${tNote(tx.note)} · ` : ''}
                      {tx.type !== 'withdraw' && tx.fee > 0 ? `${t('wallet.ledgerFee', { amount: fmt(tx.amount), fee: fmt(tx.fee) })} · ` : ''}
                      {tx.reason ? `${tNote(tx.reason)} · ` : ''}
                      {new Date(tx.createdAt).toLocaleString()}
                    </span>
                  </span>
                  <span className={`text-xs font-black capitalize ${STATUS_STYLE[tx.status] ?? ''}`}>{tServer(`status.${tx.status}`, tx.status)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">{t('wallet.noActivity')}</p>
          )}
        </section>

        </div>

        <BottomNav active="wallet" onNav={onNav} />
      </div>
    </main>
  );
}
