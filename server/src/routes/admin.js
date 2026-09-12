import { Router, json } from 'express';
import { dashboardPage } from './adminDashboard.js';

/**
 * /api/admin — operator view of the house: fees kept from stakes and totals.
 * Protected by ADMIN_TOKEN (header `x-admin-token`); in dev mode without a token it is open.
 */
export function adminRouter({ config, store, manager = null, kick = () => {}, closeRoom = null, settings = null, announcements = null }) {
  const router = Router();

  // The page itself is public; every data call from it carries the admin token.
  router.get('/dashboard', (_req, res) => {
    res.type('html').send(dashboardPage({ currency: config.currency }));
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
    res.json({ deposits: await store.depositsByStatus(status, 100) });
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
    res.json({ withdrawals: await store.withdrawalsByStatus(status, 100) });
  });

  router.post('/withdrawals/:ref/approve', json(), async (req, res) => {
    try {
      res.json(await store.resolveWithdrawal(req.params.ref, { approved: true, providerRef: req.body?.providerRef ?? null }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/withdrawals/:ref/reject', json(), async (req, res) => {
    try {
      res.json(await store.resolveWithdrawal(req.params.ref, { approved: false, reason: req.body?.reason ?? 'Rejected by operator' }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
