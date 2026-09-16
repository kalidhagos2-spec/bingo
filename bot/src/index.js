import 'dotenv/config';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { UserStore } from './users.js';
import { createPool, migrate } from './db/pool.js';
import { STEP, SKIP, begin, applyText, applyContact, hasSignedUp, isComplete, suggestedName, prompts } from './signup.js';

const { BOT_TOKEN, WEBAPP_URL, DATABASE_URL } = process.env;
const API_URL = (process.env.API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
// RENDER_EXTERNAL_URL is set automatically by Render for every web service (its own public
// https:// URL) -- explicit WEBHOOK_URL still wins, and still lets this work the same way on
// any other host that doesn't set that variable.
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is missing. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!WEBAPP_URL || !WEBAPP_URL.startsWith('https://')) {
  console.error('WEBAPP_URL must be an https:// URL (Telegram Mini Apps require HTTPS).');
  process.exit(1);
}

const pool = createPool(DATABASE_URL);
await migrate(pool);
const store = new UserStore(pool);
await store.load();

const bot = new Telegraf(BOT_TOKEN);

const screenUrl = (screen) => `${WEBAPP_URL}${WEBAPP_URL.includes('?') ? '&' : '?'}screen=${screen}`;

const mainKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.webApp('🎮 Play Bingo', screenUrl('play'))],
    [Markup.button.webApp('💵 Wallet', screenUrl('wallet')), Markup.button.webApp('👤 Profile', screenUrl('profile'))],
    [Markup.button.callback('❓ How to play', 'help')],
  ]);

const displayName = (u) => u.name || u.firstName || u.username || 'player';

/** Pushes the profile to the game server so the Mini App shows the same fields. Non-fatal. */
async function syncProfile(user) {
  try {
    const res = await fetch(`${API_URL}/api/profile/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bot-token': BOT_TOKEN },
      body: JSON.stringify({
        id: user.id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        signedUpAt: user.signedUpAt,
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) console.warn(`[profile] sync for ${user.id} failed: HTTP ${res.status}`);
  } catch (err) {
    console.warn(`[profile] sync for ${user.id} failed: ${err.message}`);
  }
}

// ---------- sign-up flow ----------

async function beginSignup(ctx, user) {
  const next = begin(user);
  await store.put(next);
  await ctx.reply(prompts.name(next), {
    parse_mode: 'Markdown',
    ...Markup.keyboard([[suggestedName(next)]]).oneTime().resize(),
  });
}

async function askPhone(ctx, text) {
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.keyboard([[Markup.button.contactRequest('📱 Share my number')], [SKIP]]).oneTime().resize(),
  });
}

async function finishSignup(ctx, user, reply) {
  await store.put(user);
  await syncProfile(user);
  await ctx.reply(reply, { parse_mode: 'Markdown', ...Markup.removeKeyboard() });
  await ctx.reply('Ready when you are 👇', mainKeyboard());
}

/** Handles a text or contact reply while a sign-up is in progress. Returns true if consumed. */
async function continueSignup(ctx, user, apply) {
  if (!user?.signup) return false;
  const { user: next, reply, done } = apply(user);
  if (done) {
    await finishSignup(ctx, next, reply);
    return true;
  }
  await store.put(next);
  if (reply) {
    if (next.signup?.step === STEP.PHONE) await askPhone(ctx, reply);
    else await ctx.reply(reply, { parse_mode: 'Markdown', ...Markup.removeKeyboard() });
  }
  return true;
}

// ---------- commands ----------

bot.start(async (ctx) => {
  const { user } = await store.register(ctx.from);
  if (!hasSignedUp(user)) {
    await beginSignup(ctx, user);
    return;
  }
  await ctx.reply(`👋 Welcome back, *${displayName(user)}*!\n\nPress *Play Bingo* to open the game.`, {
    parse_mode: 'Markdown',
    ...mainKeyboard(),
  });
});

bot.command('play', async (ctx) => {
  const { user } = await store.register(ctx.from);
  if (!hasSignedUp(user)) return beginSignup(ctx, user);
  await ctx.reply('Tap below to open the Bingo Mini App 👇', mainKeyboard());
});

async function showProfile(ctx) {
  const user = store.get(ctx.from.id);
  if (!user) {
    await ctx.reply('You are not registered yet. Send /start to sign up.');
    return;
  }
  await ctx.reply(
    [
      `👤 *${displayName(user)}*`,
      `ID: \`${user.id}\``,
      user.username ? `Username: @${user.username}` : null,
      `Phone: ${user.phone ?? '— not added'}`,
      user.signedUpAt ? `Signed up: ${new Date(user.signedUpAt).toLocaleDateString()}` : '⚠️ Sign-up not finished',
    ]
      .filter(Boolean)
      .join('\n'),
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('👤 Open profile', screenUrl('profile'))],
        [Markup.button.callback(isComplete(user) ? '✏️ Edit profile' : '📝 Finish sign-up', 'signup')],
      ]),
    },
  );
}

bot.command('profile', showProfile);
bot.action('profile', async (ctx) => {
  await ctx.answerCbQuery();
  await showProfile(ctx);
});

bot.action('signup', async (ctx) => {
  await ctx.answerCbQuery();
  const { user } = await store.register(ctx.from);
  await beginSignup(ctx, user);
});

bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    [
      '🎱 *How to play*',
      '1. Press *Play Bingo* and pick a table (10, 20 or 50 ETB entry from your wallet).',
      '2. Pick up to 4 cartelas (1–400) before the 40 s timer runs out; each one pays the entry.',
      '3. Numbers are called automatically — tap them on your card.',
      '4. Press *BINGO!* when every number on your card is marked to win the prize. 🏆',
    ].join('\n'),
    { parse_mode: 'Markdown' },
  );
});

// ---------- messages ----------

bot.on(message('contact'), async (ctx) => {
  const { user } = await store.register(ctx.from);
  if (await continueSignup(ctx, user, (u) => applyContact(u, ctx.message.contact))) return;
  await ctx.reply('Thanks! Use *My profile* to update your number.', { parse_mode: 'Markdown', ...mainKeyboard() });
});

bot.on(message('text'), async (ctx) => {
  const { user } = await store.register(ctx.from);
  if (await continueSignup(ctx, user, (u) => applyText(u, ctx.message.text))) return;
  await ctx.reply('Send /start to get the Play button.', mainKeyboard());
});

// Any other interaction keeps the user registered.
bot.on('message', async (ctx) => {
  await store.register(ctx.from);
  await ctx.reply('Send /start to get the Play button.', mainKeyboard());
});

bot.catch((err, ctx) => {
  console.error(`Error handling update ${ctx.update.update_id}:`, err);
});

// Cosmetic: a DNS blip here must not crash the bot before it even starts polling.
try {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Sign up and get the Play button' },
    { command: 'play', description: 'Open the Bingo Mini App' },
    { command: 'profile', description: 'View or edit your profile' },
  ]);
} catch (err) {
  console.warn(`[bot] could not register command menu (${err.code ?? err.message}); continuing`);
}

// Long polling (bot.launch()) keeps its own connection open to Telegram and can't be woken
// back up by anything -- fine for local dev / docker-compose, but wrong for a free hosting
// tier that sleeps the process after inactivity (nothing would ever wake it). Set WEBHOOK_URL
// (the bot service's own public https URL) to switch to webhook mode instead: Telegram POSTs
// updates to us, which both delivers the message and wakes a sleeping instance. The path
// includes a secret derived from BOT_TOKEN (never the token itself) so Telegram's own
// x-telegram-bot-api-secret-token check rejects forged requests to the endpoint.
if (WEBHOOK_URL) {
  const port = Number(process.env.PORT) || 3001;
  const webhookPath = '/telegraf/webhook';
  const secretToken = createHash('sha256').update(BOT_TOKEN).digest('hex').slice(0, 32);
  const callback = bot.webhookCallback(webhookPath, { secretToken });

  const server = http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === 'POST') return callback(req, res);
    // Anything else (in particular Render's own health-check GET /) just needs a 200.
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });

  server.listen(port, async () => {
    const url = `${WEBHOOK_URL.replace(/\/+$/, '')}${webhookPath}`;
    try {
      await bot.telegram.setWebhook(url, { secret_token: secretToken });
      console.log(`Bot started (webhook). ${store.size} registered user(s). Mini App: ${WEBAPP_URL}. API: ${API_URL}. Webhook: ${url}`);
    } catch (err) {
      console.error(`Failed to register webhook with Telegram (${url}):`, err.message);
    }
  });

  process.once('SIGINT', () => server.close(() => process.exit(0)));
  process.once('SIGTERM', () => server.close(() => process.exit(0)));
} else {
  // Telegram can be slow to reach from here; a timed-out getMe must not kill the process.
  const launch = (attempt = 1) =>
    bot
      .launch(() => {
        console.log(`Bot started (polling). ${store.size} registered user(s). Mini App: ${WEBAPP_URL}. API: ${API_URL}`);
      })
      .catch((err) => {
        const wait = Math.min(60, 5 * attempt);
        console.warn(`[bot] launch attempt ${attempt} failed (${err.code ?? err.message}); retrying in ${wait}s`);
        setTimeout(() => launch(attempt + 1), wait * 1000);
      });
  launch();

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
