import { Router, json } from 'express';
import { dashboardPage } from './adminDashboard.js';
import { houseAccounts } from './payments.js';
import { verifyPayoutReceipt } from '../verifier.js';
import { STATUS } from '../store.js';
import { canPay } from '../payouts/registry.js';
import { kindOf } from '../payouts/errors.js';

/**
 * /api/admin — operator view of the house: fees kept from stakes and totals.
 * Protected by ADMIN_TOKEN (header `x-admin-token`); in dev mode without a token it is open.
 */
/** Deposits and cash-outs are shown with the player's display name and the house account's name. */
function decorate(config, store, rows) {
  const names = new Map(houseAccounts(config).map((a) => [a.account, a.name]));
  return rows.map((t) => ({ ...t, playerName: store.profile(t.userId)?.name ?? null, accountName: names.get(t.account) ?? null }));
}

/** Largest single manual wallet adjustment, a guard against a slipped zero. */
const MAX_ADJUST = 50_000;

export function adminRouter({ config, store, manager = null, notifyBalance = () => {}, notifyWithdrawal = () => {}, kick = () => {}, closeRoom = null, settings = null, announcements = null, verifier = null, payout = null, payoutWatcher = null, receiptFetch = globalThis.fetch }) {
  const router = Router();

  // The page itself is public; every data call from it carries the admin token.
  router.get('/dashboard', (_req, res) => {
    res.type('html').send(dashboardPage({ currency: config.currency, payout: config.payout, gateway: payout?.available ? payout.id : null, gatewayLabel: payout?.label ?? null, gatewayMethods: payout?.methods ?? [] }));
  });

  router.use((req, res, next) => {
    const allowed = config.adminToken ? req.get('x-admin-token') === config.adminToken : config.devAllowAnon;
    if (!allowed) return res.status(401).json({ error: 'Admin token required' });
    next();
  });

  const houseTotals = async () => ({
    houseCutPercent: config.game.houseCutPercent,
    depositFeePercent: config.depositFeePercent,
    ...(await store.houseTotals()),
  });

  router.get('/summary', async (_req, res) => {
    const stats = manager?.stats() ?? { rooms: 0, players: 0 };
    const [summary, house] = await Promise.all([store.adminSummary(), houseTotals()]);
    res.json({ ...summary, house, rooms: stats.rooms, online: stats.players });
  });

  router.get('/house', async (_req, res) => {
    const [totals, house] = await Promise.all([houseTotals(), store.house(100)]);
    res.json({ ...totals, entries: house.entries.slice(-100).reverse() });
  });

  router.get('/players', async (req, res) => {
    const rows = await store.adminPlayers(String(req.query.q ?? ''));
    res.json({ total: rows.length, players: rows.slice(0, 200) });
  });

  router.post('/players/:id/suspend', json(), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });
    const days = req.body?.days == null || req.body.days === '' ? null : Number(req.body.days);
    if (days !== null && !(days > 0)) return res.status(400).json({ error: 'Days must be a positive number, or empty for a permanent ban' });
    const reason = String(req.body?.reason ?? '').trim() || 'Suspended by operator';
    const suspended = store.suspend(id, { reason, days });
    kick(id, reason);
    res.json({ id, suspended });
  });

  router.post('/players/:id/unsuspend', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });
    res.json({ id, lifted: store.unsuspend(id) });
  });

  /**
   * Credits (+) or debits (-) a player's wallet by hand, with a reason that is kept in the
   * player's ledger and the house ledger. For refunds after a fault, goodwill credits and
   * clawbacks; deposits and cash-outs have their own, receipt-checked flows.
   */
  router.post('/players/:id/adjust', json(), (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Bad id (demo players hold play money: nothing to adjust)' });
    if (!store.knowsPlayer(id)) return res.status(404).json({ error: `No player with id ${id}` });
    const amount = Math.round(Number(req.body?.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'Amount must be a number other than 0 (use a minus sign to take money back)' });
    if (Math.abs(amount) > MAX_ADJUST) return res.status(400).json({ error: `One adjustment is limited to ${MAX_ADJUST} ${config.currency}` });
    const reason = String(req.body?.reason ?? '').trim().slice(0, 140);
    if (reason.length < 3) return res.status(400).json({ error: 'A reason is required: it is shown in the player\'s wallet history' });
    const done = store.adminAdjust(id, amount, reason);
    if (!done) return res.status(400).json({ error: `The wallet holds only ${store.balance(id)} ${config.currency}` });
    notifyBalance(id, done.balance);
    console.log(`[admin] wallet of ${id} adjusted by ${amount} ${config.currency}: ${reason}`);
    res.json({ id, amount, balance: done.balance, reason });
  });

  router.get('/players/:id/transactions', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });
    res.json({ transactions: await store.transactionsFor(id, 50) });
  });

  router.get('/announcements', async (_req, res) => {
    if (!announcements) return res.status(503).json({ error: 'Announcements not attached' });
    res.json({ announcements: await announcements.all(), telegramRecipients: announcements.telegramRecipients().length, telegramEnabled: Boolean(config.botToken) });
  });

  router.post('/announcements', json(), async (req, res) => {
    if (!announcements) return res.status(503).json({ error: 'Announcements not attached' });
    try {
      const { text, level, expiresInHours, telegram } = req.body ?? {};
      res.status(201).json(await announcements.post({ text, level: level || 'info', expiresInHours, telegram: Boolean(telegram) }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/announcements/:id', async (req, res) => {
    if (!announcements) return res.status(503).json({ error: 'Announcements not attached' });
    try {
      res.json(await announcements.remove(req.params.id));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get('/settings', (_req, res) => {
    if (!settings) return res.status(503).json({ error: 'Settings not attached' });
    res.json({ schema: settings.schema, values: settings.values(), defaults: settings.defaults, overrides: settings.overrides() });
  });

  router.put('/settings', json(), async (req, res) => {
    if (!settings) return res.status(503).json({ error: 'Settings not attached' });
    try {
      res.json({ values: await settings.update(req.body ?? {}), overrides: settings.overrides() });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/settings/reset', async (_req, res) => {
    if (!settings) return res.status(503).json({ error: 'Settings not attached' });
    res.json({ values: await settings.reset(), overrides: {} });
  });

  router.get('/rooms', (_req, res) => {
    res.json({ rooms: manager?.liveRooms() ?? [], now: Date.now() });
  });

  router.post('/rooms/:code/close', json(), (req, res) => {
    if (!closeRoom) return res.status(503).json({ error: 'Realtime layer not attached' });
    try {
      const reason = String(req.body?.reason ?? '').trim() || 'This table was closed by the operator';
      res.json({ closed: closeRoom(req.params.code, reason) });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  router.get('/rounds', async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const [total, rounds] = await Promise.all([store.roundCount(), store.gameHistory(String(req.query.q ?? ''), limit)]);
    res.json({ total, rounds });
  });

  router.get('/deposits', async (req, res) => {
    const status = String(req.query.status ?? 'pending');
    // depositsByStatus already returns newest-first.
    res.json({ deposits: decorate(config, store, await store.depositsByStatus(status, 100)) });
  });

  /** Re-runs the Telebirr receipt check for one pending deposit and credits it if the receipt matches. */
  router.post('/deposits/:ref/verify', async (req, res) => {
    if (!verifier) return res.status(503).json({ error: 'Receipt verification is not attached' });
    try {
      const { tx, check } = await verifier.checkOne(req.params.ref);
      res.json({ ...tx, check });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/deposits/:ref/approve', async (req, res) => {
    try {
      res.json(await store.resolveDeposit(req.params.ref, { approved: true, verified: 'operator' }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/deposits/:ref/reject', json(), async (req, res) => {
    try {
      res.json(await store.resolveDeposit(req.params.ref, { approved: false, reason: req.body?.reason ?? 'Transfer could not be confirmed' }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/withdrawals', async (req, res) => {
    const status = String(req.query.status ?? 'pending');
    // withdrawalsByStatus already returns newest-first.
    res.json({ withdrawals: decorate(config, store, await store.withdrawalsByStatus(status, 100)) });
  });

  // ---------- cash-outs ----------
  //
  // Approve sends the money. With a payout gateway that covers the rail, the row is moved to
  // `processing` under a lock first and the gateway is asked to send exactly once; the answer
  // (or, later, the watcher's status check) settles it. Without a gateway, or with a
  // transaction id typed in, the operator paid by hand: the Telebirr receipt is checked unless
  // `force` says the operator takes responsibility.
  const limit = () => Number(config.maxAutoPayout ?? Infinity);
  const already = (res, tx) => res.status(409).json({ error: `Withdrawal already ${tx.status}` });

  router.post('/withdrawals/:ref/approve', json(), async (req, res) => {
    try {
      const tx = await store.findByRef(req.params.ref);
      if (!tx || tx.type !== 'withdraw') return res.status(404).json({ error: 'Withdrawal not found' });
      const providerRef = String(req.body?.providerRef ?? '').trim() || null;
      const force = Boolean(req.body?.force);

      if (providerRef) {
        // Paid by hand. A processing row may be settled this way only with force: the operator
        // has checked with the provider that the money went out.
        if (tx.status !== STATUS.PENDING && !(tx.status === STATUS.PROCESSING && force)) return already(res, tx);
        let verified = 'operator';
        if (tx.method === 'telebirr' && !force) {
          const check = await verifyPayoutReceipt({ txId: providerRef, amount: tx.payout, account: tx.account }, receiptFetch);
          if (!check.ok) return res.status(409).json({ error: `Receipt check failed: ${check.reason}`, check });
          verified = 'receipt';
        }
        const paid = await store.completePayout(tx.ref, { providerRef, verified });
        notifyWithdrawal(paid);
        return res.json(paid);
      }

      if (!canPay(payout, tx.method)) return res.status(400).json({ error: `Enter the transaction id of the payout you sent (no payout gateway is configured for ${tx.method})` });
      if (tx.status !== STATUS.PENDING) return already(res, tx);
      if (tx.payout > limit() && !force) {
        return res.status(409).json({ error: `Payout of ${tx.payout} ${config.currency} is above the one-click limit of ${limit()} ${config.currency}: confirm to send it`, confirmRequired: true });
      }
      try {
        await store.beginPayout(tx.ref, { provider: payout.id }); // the double-click guard: one of two Approves fails here
      } catch (err) {
        return res.status(409).json({ error: err.message });
      }
      const name = store.profile(tx.userId)?.name ?? null;
      try {
        const sent = await payout.send({ ref: tx.ref, amount: tx.payout, method: tx.method, account: tx.account, name });
        if (sent.status === 'paid') {
          const paid = await store.completePayout(tx.ref, { providerRef: sent.providerRef ?? null, verified: 'gateway' });
          notifyWithdrawal(paid);
          return res.json(paid);
        }
        const queued = await store.recordPayoutCheck(tx.ref, { providerRef: sent.providerRef ?? null, note: `queued at ${payout.id}` });
        return res.status(202).json(queued);
      } catch (err) {
        const kind = kindOf(err);
        console.warn(`[payouts] ${payout.id} send ${tx.ref} (${kind}): ${err.message}`);
        if (kind === 'rejected') {
          const failed = await store.failPayout(tx.ref, { reason: err.message, providerRef: err.providerRef ?? null });
          notifyWithdrawal(failed);
          return res.json(failed);
        }
        if (kind === 'retry') {
          await store.revertPayout(tx.ref, { note: err.message });
          return res.status(409).json({ error: err.message, retryable: true });
        }
        // Ambiguous: the money may or may not have left. Never send again; the watcher asks the gateway.
        const unsure = await store.recordPayoutCheck(tx.ref, { note: `send did not answer: ${err.message}` });
        return res.status(202).json({ ...unsure, warning: 'The gateway did not answer; the status is checked automatically. Nothing is re-sent.' });
      }
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/withdrawals/:ref/reject', json(), async (req, res) => {
    try {
      const tx = await store.resolveWithdrawal(req.params.ref, { approved: false, reason: req.body?.reason ?? 'Rejected by operator' });
      notifyWithdrawal(tx);
      res.json(tx);
    } catch (err) {
      res.status(/^Withdrawal already/.test(err.message) ? 409 : 400).json({ error: err.message });
    }
  });

  /** Asks the gateway about a processing cash-out now, instead of waiting for the watcher. */
  router.post('/withdrawals/:ref/check', async (req, res) => {
    if (!payoutWatcher || !payout) return res.status(503).json({ error: 'No payout gateway is configured' });
    try {
      const { tx, check } = await payoutWatcher.checkOne(req.params.ref);
      res.json({ ...tx, check });
    } catch (err) {
      res.status(/not found/i.test(err.message) ? 404 : 400).json({ error: err.message });
    }
  });

  /** The operator, having checked with the provider that nothing was paid, fails a processing cash-out (hold refunded). */
  router.post('/withdrawals/:ref/fail', json(), async (req, res) => {
    try {
      const tx = await store.findByRef(req.params.ref);
      if (!tx || tx.type !== 'withdraw') return res.status(404).json({ error: 'Withdrawal not found' });
      if (tx.status !== STATUS.PROCESSING) return already(res, tx);
      const reason = String(req.body?.reason ?? '').trim();
      if (reason.length < 3) return res.status(400).json({ error: 'A reason is required: it is shown to the player' });
      const failed = await store.failPayout(tx.ref, { reason: `Operator: ${reason}` });
      notifyWithdrawal(failed);
      res.json(failed);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
