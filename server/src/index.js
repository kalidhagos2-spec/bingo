import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { config, paymentUrl } from './config.js';
import { telegramAuth } from './auth.js';
import { PaymentStore } from './store.js';
import { createPool, migrate } from './db/pool.js';
import { buildProviders } from './payments/registry.js';
import { paymentsRouter } from './routes/payments.js';
import { profileRouter } from './routes/profile.js';
import { economyRouter } from './routes/economy.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { createSettings } from './settings.js';
import { createAnnouncements } from './announcements.js';
import { createMailer } from './mailer.js';
import { sessionUser } from './emailAuth.js';
import { attachRealtime } from './realtime.js';

if (!config.publicUrl) {
  console.warn('[server] PUBLIC_URL is not set; payment return/webhook URLs will be relative and only work locally.');
}
if (config.devAllowAnon) {
  console.warn('[server] DEV mode: unauthenticated requests are served as a dev user. Set BOT_TOKEN in production.');
}

const pool = createPool(config.databaseUrl);
await migrate(pool);

const store = new PaymentStore(pool, {
  currency: config.currency,
  depositFeePercent: config.depositFeePercent,
  withdrawFeePercent: config.withdrawFeePercent,
});
await store.load();

const providers = buildProviders(config, { paymentUrl });
for (const p of providers.values()) {
  console.log(`[payments] ${p.id.padEnd(9)} -> ${p.sandbox ? 'SANDBOX (no gateway credentials configured)' : 'live'}`);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
// Only mounted when ALLOWED_ORIGINS is set (a webapp deployed on a different origin than
// this server, e.g. Vercel). Same-origin deployments (docker-compose + nginx) don't need
// this -- browsers don't apply CORS to same-origin requests -- so leaving it unset keeps
// today's behavior unchanged.
if (config.allowedOrigins.length) app.use('/api', cors({ origin: config.allowedOrigins }));

const httpServer = createServer(app);
const { io, manager, kick, closeRoom } = attachRealtime(httpServer, {
  botToken: config.botToken,
  devAllowAnon: config.devAllowAnon,
  rules: config.game,
  stakes: config.stakes,
  store,
  allowedOrigins: config.allowedOrigins,
});

app.get('/api/health', async (_req, res) => {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM transactions');
  res.json({ ok: true, transactions: rows[0].n, ...manager.stats() });
});
const mailer = createMailer({ smtpUrl: config.smtpUrl, from: config.mailFrom, devAllowAnon: config.devAllowAnon });
console.log(`[mail] login codes -> ${mailer.live ? 'SMTP' : 'server log (SMTP_URL not set)'}`);
const auth = telegramAuth({
  botToken: config.botToken,
  devAllowAnon: config.devAllowAnon,
  sessions: (token) => sessionUser(store, token),
  suspension: (userId) => store.suspension(userId),
});
app.use('/api/auth', authRouter({ store, mailer, auth }));
app.use('/api/payments', paymentsRouter({ config, store, providers, paymentUrl, auth }));
app.use('/api/profile', profileRouter({ config, store, auth }));
app.use('/api/economy', economyRouter({ store, auth }));
const announcements = createAnnouncements({ store, io, botToken: config.botToken });
app.get('/api/announcements', auth, async (_req, res) => res.json({ announcements: await announcements.active() }));

const settings = createSettings({ config, store, manager });
if (Object.keys(settings.overrides()).length) console.log('[settings] operator overrides active:', Object.keys(settings.overrides()).join(', '));
app.use('/api/admin', adminRouter({ config, store, manager, kick, closeRoom, settings, announcements }));

app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'Internal error' });
});

httpServer.listen(config.port, () => console.log(`[server] listening on :${config.port} (HTTP + Socket.io)`));

// A container stop/restart (rolling deploy, `docker compose down`, Ctrl-C) sends SIGTERM/
// SIGINT. Without this, the process dies immediately and can drop a wallet/profile write
// that's already queued in the store's background `_enqueue` chain but hasn't reached
// Postgres yet. Stop taking new work first, then let what's in flight finish before exiting.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received, shutting down...`);
  const forceExit = setTimeout(() => {
    console.error('[server] graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, 10_000);
  try {
    io.close(); // disconnects sockets and stops accepting new ones
    await new Promise((resolve) => httpServer.close(resolve)); // stop accepting new HTTP requests
    await store.flush(); // let any in-flight wallet/profile/settings writes reach Postgres
    await pool.end();
    console.log('[server] shutdown complete');
    process.exit(0);
  } finally {
    clearTimeout(forceExit);
  }
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
