import { Router, json, text, urlencoded } from 'express';
import { STATUS } from '../store.js';
import { describeProviders, METHODS } from '../payments/registry.js';
import { verifyTelebirrReceipt, TELEBIRR_RECEIPT_URL } from '../receipts.js';
import { normalizePhone } from './profile.js';

const returnPage = (title, body) => `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center}
.card{background:#1e293b;padding:32px;border-radius:24px;max-width:360px;width:90%}</style></head>
<body><div class="card"><h2>${title}</h2><p>${body}</p><p>You can close this page and return to Telegram.</p></div></body></html>`;

const publicTx = ({ ref, type = 'topup', method, account, amount, fee, payout, credited, currency, status, reason, note, providerRef, verified, createdAt, updatedAt }) => ({
  ref, type, method, account, amount, fee, payout, credited, currency, status, reason, note, providerRef, verified, createdAt, updatedAt,
});

const list = (s) => String(s ?? '').split(',').map((x) => x.trim());

/**
 * House accounts players transfer to, one entry per account. `HOUSE_<METHOD>_ACCOUNT` and
 * `HOUSE_<METHOD>_NAME` may hold several comma-separated values (paired by position), so
 * a rail can show more than one receiving number, e.g. two Telebirr wallets.
 */
const houseAccounts = (config) =>
  METHODS.flatMap((m) => {
    const cfg = config.houseAccounts?.[m.id] ?? {};
    const names = list(cfg.name);
    return list(cfg.account)
      .filter(Boolean)
      .map((account, i) => ({ method: m.id, label: m.label, account, name: names[i] ?? names[0] ?? '' }));
  });

const isMethod = (id) => METHODS.some((m) => m.id === id);

/** `notifyBalance(userId, balance)` pushes a live wallet update to a connected player (optional). */
export function paymentsRouter({ config, store, providers, auth, notifyBalance = () => {} }) {
  const router = Router();
  const jsonWithRaw = json({ verify: (req, _res, buf) => (req.rawBody = buf.toString('utf8')) });

  async function applyResult(provider, result) {
    if (!result?.ref) return null;
    const tx = await store.findByRef(result.ref);
    if (!tx || tx.method !== provider.id) return null;
    if (result.amount != null && Math.abs(result.amount - tx.amount) > 0.005) {
      console.warn(`[payments] amount mismatch for ${tx.ref}: expected ${tx.amount}, got ${result.amount}`);
      return store.markFailed(tx.ref, STATUS.FAILED, result.providerRef);
    }
    if (result.status === STATUS.PAID) return store.markPaid(tx.ref, result.providerRef);
    if (result.status === STATUS.PENDING) return tx;
    return store.markFailed(tx.ref, result.status, result.providerRef);
  }

  // ---------- public provider callbacks (no Telegram auth) ----------

  router.post('/webhook/:method', text({ type: 'text/*' }), jsonWithRaw, urlencoded({ extended: false }), async (req, res) => {
    const provider = providers.get(req.params.method);
    if (!provider) return res.status(404).json({ error: 'Unknown method' });
    try {
      const result = await provider.handleWebhook(req);
      const tx = await applyResult(provider, result);
      if (!tx) return res.status(400).json({ error: 'Unrecognised notification' });
      res.send(provider.webhookResponse ?? { received: true });
    } catch (err) {
      console.error(`[payments] webhook ${provider.id} failed:`, err);
      res.status(400).json({ error: 'Webhook processing failed' });
    }
  });

  router.get('/return', async (req, res) => {
    const tx = await store.findByRef(String(req.query.ref ?? ''));
    if (!tx) return res.status(404).send(returnPage('Unknown payment', 'We could not find that reference.'));
    const copy = {
      [STATUS.PAID]: ['Payment received 🎉', `${tx.amount.toFixed(2)} ${tx.currency} was added to your Bingo wallet.`],
      [STATUS.PENDING]: ['Payment pending ⏳', 'We are waiting for confirmation from your bank. Your wallet updates automatically.'],
      [STATUS.FAILED]: ['Payment failed', 'The payment did not go through. You have not been charged.'],
      [STATUS.CANCELLED]: ['Payment cancelled', 'The payment was cancelled. You have not been charged.'],
    }[tx.status];
    res.send(returnPage(...copy));
  });

  // ---------- authenticated Mini App API ----------

  router.use(auth);

  router.get('/methods', (_req, res) => {
    res.json({
      currency: config.currency,
      min: config.minTopup,
      max: config.maxTopup,
      depositFeePercent: config.depositFeePercent,
      withdraw: { min: config.minWithdraw, max: config.maxWithdraw, feePercent: config.withdrawFeePercent },
      p2p: { min: config.minTransfer },
      // Online checkout is offered only for methods with a configured gateway; cash-outs
      // and transfer deposits work on every rail.
      methods: describeProviders(providers),
      payoutMethods: METHODS.map(({ id, label, description }) => ({ id, label, description })),
      transfer: { accounts: houseAccounts(config), receiptUrl: TELEBIRR_RECEIPT_URL },
    });
  });

  router.get('/wallet', async (req, res) => {
    res.json({
      balance: store.balance(req.user.id),
      currency: config.currency,
      transactions: await store.transactionsFor(req.user.id),
    });
  });

  router.post('/topup', json(), async (req, res) => {
    const { method, amount } = req.body ?? {};
    const provider = providers.get(method);
    const value = Math.round(Number(amount) * 100) / 100;
    if (!provider) return res.status(400).json({ error: 'Unknown payment method' });
    if (!Number.isFinite(value) || value < config.minTopup || value > config.maxTopup) {
      return res.status(400).json({ error: `Amount must be between ${config.minTopup} and ${config.maxTopup} ${config.currency}` });
    }
    const tx = await store.createTransaction({ userId: req.user.id, method, amount: value, currency: config.currency });
    try {
      const { checkoutUrl, providerRef = null } = await provider.initiate(tx, req.user);
      const updated = await store.update(tx.ref, { checkoutUrl, providerRef });
      res.status(201).json({ ref: updated.ref, checkoutUrl, status: updated.status });
    } catch (err) {
      console.error(`[payments] initiate ${method} failed:`, err);
      await store.markFailed(tx.ref);
      res.status(502).json({ error: 'Could not start payment. Please try again.' });
    }
  });

  // ---------- deposits by bank transfer + pasted receipt id ----------

  router.post('/deposit', json(), async (req, res) => {
    const { method, amount, txId, account } = req.body ?? {};
    const value = Math.round(Number(amount) * 100) / 100;
    // `account` picks which of the rail's house accounts the player paid into (default: the first).
    const rail = houseAccounts(config).filter((a) => a.method === method);
    const house = (account && rail.find((a) => a.account === String(account).trim())) || rail[0];
    if (!house) return res.status(400).json({ error: 'Transfers are not accepted through this method' });
    if (!Number.isFinite(value) || value < config.minTopup || value > config.maxTopup) {
      return res.status(400).json({ error: `Amount must be between ${config.minTopup} and ${config.maxTopup} ${config.currency}` });
    }
    let tx;
    try {
      tx = await store.submitDeposit({ userId: req.user.id, method, amount: value, txId, account: house.account });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    // Telebirr receipts are public: confirm automatically when the receipt matches, else leave it for the operator.
    let check = null;
    if (config.autoApproveDeposits) {
      // TEST MODE: every receipt is taken at face value.
      tx = await store.resolveDeposit(tx.ref, { approved: true, verified: 'auto-test' });
      check = { ok: true };
    } else if (method === 'telebirr') {
      check = await verifyTelebirrReceipt({ txId: tx.providerRef, amount: value, houseAccount: house.account });
      if (check.ok) tx = await store.resolveDeposit(tx.ref, { approved: true, verified: 'auto' });
      else await store.update(tx.ref, { autoCheck: check.reason });
    }
    res.status(201).json({ ...publicTx(tx), autoVerified: Boolean(check?.ok), balance: store.balance(req.user.id) });
  });

  // ---------- player-to-player transfers (by phone number) ----------

  /** Who a phone number belongs to, so the sender can confirm before sending. */
  router.get('/recipient', (req, res) => {
    const phone = normalizePhone(req.query.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid phone number, e.g. 0900000000' });
    const player = store.playerByPhone(phone);
    if (!player) return res.status(404).json({ error: 'No player with that phone number has signed up yet' });
    if (player.id === req.user.id) return res.status(400).json({ error: 'That is your own number' });
    res.json({ id: player.id, name: player.name ?? player.firstName ?? `Player ${player.id}`, phone });
  });

  router.post('/transfer', json(), (req, res) => {
    const phone = normalizePhone(req.body?.phone);
    const value = Math.round(Number(req.body?.amount) * 100) / 100;
    if (!phone) return res.status(400).json({ error: 'Enter a valid phone number, e.g. 0900000000' });
    if (!Number.isFinite(value) || value < config.minTransfer) return res.status(400).json({ error: `Minimum transfer is ${config.minTransfer} ${config.currency}` });
    const player = store.playerByPhone(phone);
    if (!player) return res.status(404).json({ error: 'No player with that phone number has signed up yet' });
    if (player.id === req.user.id) return res.status(400).json({ error: 'You cannot send money to yourself' });
    const senderName = store.profile(req.user.id)?.name ?? req.user.first_name ?? `Player ${req.user.id}`;
    const recipientName = player.name ?? player.firstName ?? `Player ${player.id}`;
    try {
      const result = store.transfer({ fromId: req.user.id, toId: player.id, amount: value, note: `Transfer ${senderName} → ${recipientName} (${phone})` });
      notifyBalance(player.id, result.recipientBalance);
      notifyBalance(req.user.id, result.senderBalance);
      res.status(201).json({ ref: result.ref, amount: value, currency: config.currency, to: { id: player.id, name: recipientName, phone }, balance: result.senderBalance });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---------- cash-outs ----------

  router.post('/withdraw', json(), async (req, res) => {
    const { method, amount } = req.body ?? {};
    const account = String(req.body?.account ?? '').trim();
    const value = Math.round(Number(amount) * 100) / 100;
    if (!isMethod(method)) return res.status(400).json({ error: 'Unknown payout method' });
    if (!Number.isFinite(value) || value < config.minWithdraw || value > config.maxWithdraw) {
      return res.status(400).json({ error: `Amount must be between ${config.minWithdraw} and ${config.maxWithdraw} ${config.currency}` });
    }
    if (account.length < 4 || account.length > 40) return res.status(400).json({ error: 'Enter the phone or account number to pay out to' });
    try {
      const tx = await store.requestWithdrawal({ userId: req.user.id, method, amount: value, account });
      res.status(201).json({ ...publicTx(tx), balance: store.balance(req.user.id) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/withdraw/:ref/cancel', async (req, res) => {
    const tx = await store.findByRef(req.params.ref);
    if (!tx || tx.userId !== req.user.id || tx.type !== 'withdraw') return res.status(404).json({ error: 'Not found' });
    try {
      const updated = await store.resolveWithdrawal(tx.ref, { approved: false, status: STATUS.CANCELLED, reason: 'Cancelled by player' });
      res.json({ ...publicTx(updated), balance: store.balance(req.user.id) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/:ref', async (req, res) => {
    let tx = await store.findByRef(req.params.ref);
    if (!tx || tx.userId !== req.user.id) return res.status(404).json({ error: 'Not found' });
    const provider = providers.get(tx.method);
    if (tx.status === STATUS.PENDING && provider?.verify) {
      try {
        tx = (await applyResult(provider, { ref: tx.ref, ...(await provider.verify(tx)) })) ?? tx;
      } catch (err) {
        console.warn(`[payments] verify ${tx.ref} failed:`, err.message);
      }
    }
    const { ref, method, amount, currency, status, createdAt, updatedAt } = tx;
    res.json({ ref, method, amount, currency, status, createdAt, updatedAt, balance: store.balance(req.user.id) });
  });

  return router;
}
