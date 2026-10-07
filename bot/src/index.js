import 'dotenv/config';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { UserStore } from './users.js';
import { createPool, migrate } from './db/pool.js';
import { STEP, begin, applyText, applyContact, hasSignedUp, isComplete, promptFor, nameChoices } from './signup.js';
import { t, md, langOf, LANGS, LANG_NAMES, BOT_PROFILE } from './i18n.js';
import { helpText, rulesText, balanceText, depositText, withdrawText, contactText } from './replies.js';

const { BOT_TOKEN, WEBAPP_URL, DATABASE_URL } = process.env;
const API_URL = (process.env.API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
// RENDER_EXTERNAL_URL is set automatically by Render for every web service (its own public
// https:// URL) -- explicit WEBHOOK_URL still wins, and still lets this work the same way on
// any other host that doesn't set that variable.
const WEBHOOK_URL = process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL;
// Shown by /contact (without the @). Empty = not announced yet.
const SUPPORT_USERNAME = (process.env.SUPPORT_USERNAME || '').replace(/^@/, '');
const CHANNEL_USERNAME = (process.env.CHANNEL_USERNAME || '').replace(/^@/, '');

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

/** Mini App link for a screen, opened in the player's language (the app reads ?lang=). */
const screenUrl = (screen, lang) => `${WEBAPP_URL}${WEBAPP_URL.includes('?') ? '&' : '?'}screen=${screen}&lang=${lang}`;

const mainKeyboard = (user) => {
  const lang = langOf(user);
  return Markup.inlineKeyboard([
    [Markup.button.webApp(t(lang, 'menu.play'), screenUrl('play', lang))],
    [Markup.button.webApp(t(lang, 'menu.wallet'), screenUrl('wallet', lang)), Markup.button.webApp(t(lang, 'menu.send'), screenUrl('transfer', lang))],
    [Markup.button.callback(t(lang, 'menu.deposit'), 'deposit'), Markup.button.callback(t(lang, 'menu.withdraw'), 'withdraw')],
    [Markup.button.webApp(t(lang, 'menu.profile'), screenUrl('profile', lang)), Markup.button.callback(t(lang, 'menu.howto'), 'help')],
    [Markup.button.callback(t(lang, 'menu.language'), 'language')],
  ]);
};

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

/** Tells the game server who invited this new player (the /start link carried `ref_<id>`). Non-fatal. */
async function syncReferral(userId, referrerId) {
  try {
    await fetch(`${API_URL}/api/profile/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bot-token': BOT_TOKEN },
      body: JSON.stringify({ id: userId, referredBy: referrerId }),
      signal: AbortSignal.timeout(4000),
    });
  } catch (err) {
    console.warn(`[referral] could not record inviter ${referrerId} for ${userId}: ${err.message}`);
  }
}

// ---------- sign-up flow ----------

/** Two steps: the player picks a username (one tap on their Telegram name, or typed), then shares (or skips) their phone. */
async function beginSignup(ctx, user) {
  const next = begin(user);
  await store.put(next);
  await ask(ctx, next, promptFor(next));
}

/** Sends `text` with the keyboard of the step the user is at. */
async function ask(ctx, user, text) {
  if (user.signup?.step === STEP.NAME) return askName(ctx, user, text);
  if (user.signup?.step === STEP.PHONE) return askPhone(ctx, user, text);
  return ctx.reply(text, { parse_mode: 'Markdown', ...Markup.removeKeyboard() });
}

/** Username step: the Telegram @username and name are offered as one-tap buttons. */
async function askName(ctx, user, text) {
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.keyboard(nameChoices(user).map((name) => [name])).oneTime().resize(),
  });
}

async function askPhone(ctx, user, text) {
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.keyboard([[Markup.button.contactRequest(t(langOf(user), 'signup.share'))], [t(langOf(user), 'signup.skip')]]).oneTime().resize(),
  });
}

async function finishSignup(ctx, user, reply) {
  await store.put(user);
  await syncProfile(user);
  await ctx.reply(reply, { parse_mode: 'Markdown', ...Markup.removeKeyboard() });
  await ctx.reply(t(langOf(user), 'menu.ready'), mainKeyboard(user));
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
  if (reply) await ask(ctx, next, reply);
  return true;
}

// ---------- commands ----------

bot.start(async (ctx) => {
  const { user, created } = await store.register(ctx.from);
  const inviter = /^ref_(\d+)$/.exec(ctx.startPayload ?? '')?.[1];
  if (created && inviter) await syncReferral(user.id, Number(inviter));
  if (!hasSignedUp(user)) {
    await beginSignup(ctx, user);
    return;
  }
  await ctx.reply(t(langOf(user), 'menu.welcomeBack', { name: md(displayName(user)) }), { parse_mode: 'Markdown', ...mainKeyboard(user) });
});

bot.command('play', async (ctx) => {
  const { user } = await store.register(ctx.from);
  if (!hasSignedUp(user)) return beginSignup(ctx, user);
  await ctx.reply(t(langOf(user), 'menu.open'), mainKeyboard(user));
});

async function showProfile(ctx) {
  const user = store.get(ctx.from.id);
  if (!user) {
    await ctx.reply(t(langOf(null), 'profile.none'));
    return;
  }
  const lang = langOf(user);
  await ctx.reply(
    [
      `👤 *${md(displayName(user))}*`,
      `ID: \`${user.id}\``,
      user.username ? t(lang, 'profile.telegram', { username: md(user.username) }) : null,
      t(lang, 'profile.phone', { phone: user.phone ?? t(lang, 'profile.noPhone') }),
      user.signedUpAt ? t(lang, 'profile.signedUp', { date: new Date(user.signedUpAt).toLocaleDateString() }) : t(lang, 'profile.unfinished'),
    ]
      .filter(Boolean)
      .join('\n'),
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp(t(lang, 'profile.open'), screenUrl('profile', lang))],
        [Markup.button.callback(isComplete(user) ? t(lang, 'profile.updatePhone') : t(lang, 'profile.finish'), 'signup')],
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

// ---------- help commands ----------
// Each one is both a /command and a menu button. The numbers they quote (house accounts,
// limits, fees, table rules, the player's balance) come from the game server, so an operator
// who changes a setting never has to touch the bot.

/** What the game server knows about this player and the current settings; null when it cannot be reached. */
async function serverInfo(userId) {
  try {
    const res = await fetch(`${API_URL}/api/profile/bot/${userId}`, { headers: { 'x-bot-token': BOT_TOKEN }, signal: AbortSignal.timeout(4000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Registers `name` as a /command and as an inline-button action answering with `build(lang, info, user)`. */
function helpCommand(name, build, { needsServer = false, keyboard = false } = {}) {
  const run = async (ctx) => {
    const { user } = await store.register(ctx.from);
    const lang = langOf(user);
    const info = await serverInfo(user.id);
    const text = needsServer && !info ? t(lang, 'server.down') : build(lang, info, user);
    await ctx.reply(text, { parse_mode: 'Markdown', ...(keyboard ? mainKeyboard(user) : {}) });
  };
  bot.command(name, run);
  bot.action(name, async (ctx) => {
    await ctx.answerCbQuery();
    await run(ctx);
  });
}

helpCommand('help', (lang, info) => `${rulesText(lang, info)}\n\n${helpText(lang)}`);
helpCommand('rules', (lang, info) => rulesText(lang, info));
helpCommand('balance', (lang, info) => balanceText(lang, info), { needsServer: true, keyboard: true });
helpCommand('deposit', (lang, info) => depositText(lang, info), { keyboard: true });
helpCommand('withdraw', (lang, info) => withdrawText(lang, info), { keyboard: true });
helpCommand('contact', (lang, _info, user) => contactText(lang, { id: user.id, support: SUPPORT_USERNAME, channel: CHANNEL_USERNAME }));

const askLanguage = async (ctx) => {
  const { user } = await store.register(ctx.from);
  await ctx.reply(t(langOf(user), 'language.ask'), Markup.inlineKeyboard([LANGS.map((code) => Markup.button.callback(LANG_NAMES[code], `lang:${code}`))]));
};
bot.command('language', askLanguage);
bot.action('language', async (ctx) => {
  await ctx.answerCbQuery();
  await askLanguage(ctx);
});
bot.action(/^lang:(\w+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const { user } = await store.register(ctx.from);
  const lang = LANGS.includes(ctx.match[1]) ? ctx.match[1] : langOf(user);
  const next = await store.put({ ...user, lang });
  // Mid sign-up the question is asked again in the new language; otherwise the menu is redrawn.
  if (next.signup) return ask(ctx, next, `${t(lang, 'language.set')}\n\n${promptFor(next)}`);
  await ctx.reply(t(lang, 'language.set'), { parse_mode: 'Markdown', ...mainKeyboard(next) });
});

// ---------- messages ----------

bot.on(message('contact'), async (ctx) => {
  const { user } = await store.register(ctx.from);
  if (await continueSignup(ctx, user, (u) => applyContact(u, ctx.message.contact))) return;
  await ctx.reply(t(langOf(user), 'menu.contactThanks'), { parse_mode: 'Markdown', ...mainKeyboard(user) });
});

bot.on(message('text'), async (ctx) => {
  const { user } = await store.register(ctx.from);
  if (await continueSignup(ctx, user, (u) => applyText(u, ctx.message.text))) return;
  await ctx.reply(t(langOf(user), 'menu.fallback'), mainKeyboard(user));
});

// Any other interaction keeps the user registered.
bot.on('message', async (ctx) => {
  const { user } = await store.register(ctx.from);
  await ctx.reply(t(langOf(user), 'menu.fallback'), mainKeyboard(user));
});

bot.catch((err, ctx) => {
  console.error(`Error handling update ${ctx.update.update_id}:`, err);
});

// The "/" command menu and the bot's public profile (what BotFather's /setcommands,
// /setdescription and /setabouttext set), in Amharic like the rest of the bot. Cosmetic: a DNS
// blip here must not crash the bot before it even starts polling. BOT_APPLY_PROFILE=false
// leaves whatever was typed into BotFather by hand.
const COMMANDS = ['start', 'play', 'balance', 'deposit', 'withdraw', 'rules', 'profile', 'language', 'contact', 'help'];
try {
  await bot.telegram.setMyCommands(COMMANDS.map((command) => ({ command, description: t('am', `cmd.${command}`) })));
  if (process.env.BOT_APPLY_PROFILE !== 'false') {
    await bot.telegram.setMyDescription(BOT_PROFILE.description);
    await bot.telegram.setMyShortDescription(BOT_PROFILE.about);
  }
} catch (err) {
  console.warn(`[bot] could not set the command menu / profile (${err.code ?? err.message}); continuing`);
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
