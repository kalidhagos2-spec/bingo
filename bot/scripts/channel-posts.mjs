/**
 * Publishes the launch posts of marketing/telegram-channel-kit.md to the official channel,
 * each with the standard footer, and pins the welcome post.
 *
 *   node scripts/channel-posts.mjs                 # dry run: prints what would be posted
 *   node scripts/channel-posts.mjs --send          # posts all launch posts, pins the first
 *   node scripts/channel-posts.mjs --send --only 5 # posts just "Post 5"
 *
 * Needs BOT_TOKEN and CHANNEL_USERNAME (and SUPPORT_USERNAME for the footer) in bot/.env, and
 * the bot added to the channel as an administrator allowed to post and pin messages. Run it
 * from the bot folder on the host (the kit is not inside the Docker image).
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';

const KIT = new URL('../../marketing/telegram-channel-kit.md', import.meta.url);
const args = process.argv.slice(2);
const send = args.includes('--send');
const only = args.includes('--only') ? Number(args[args.indexOf('--only') + 1]) : null;
const handle = (name) => (process.env[name] || '').replace(/^@/, '');
const channel = handle('CHANNEL_USERNAME');
const support = handle('SUPPORT_USERNAME');

const kit = (await readFile(process.env.KIT_PATH || KIT, 'utf8')).replace(/\r\n/g, '\n');
const block = (text) => text.match(/```\n([\s\S]*?)\n```/)?.[1] ?? null;

// The footer block under "Footer under every post", with the real usernames filled in.
let footer = block(kit.slice(kit.indexOf('**Footer under every post**')));
if (!footer) throw new Error('Footer block not found in the kit');
footer = footer.replace(/@usabingo_official/g, channel ? `@${channel}` : '').replace(/@usabingo_support/g, support ? `@${support}` : '');
footer = footer
  .split('\n')
  .filter((line) => !/:\s*$/.test(line)) // a line whose username is not set yet is left out
  .join('\n');

// Until the support account exists, lines that name it are left out rather than posted with a placeholder.
const withSupport = (body) => (support ? body.replace(/@usabingo_support/g, `@${support}`) : body.split('\n').filter((line) => !line.includes('@usabingo_support')).join('\n'));

const posts = [...kit.matchAll(/^### Post (\d+) — ([^\n]+)\n\n```\n([\s\S]*?)\n```/gm)]
  .map(([, n, title, body]) => ({ n: Number(n), title: title.trim(), text: `${withSupport(body).trim()}\n\n${footer}` }))
  .filter((p) => only === null || p.n === only);
if (posts.length === 0) throw new Error('No launch posts found in the kit');

if (!send) {
  for (const p of posts) console.log(`\n──────── Post ${p.n} · ${p.title} (${p.text.length} chars) ────────\n${p.text}`);
  console.log(`\nDry run: ${posts.length} post(s). Channel: ${channel ? `@${channel}` : 'CHANNEL_USERNAME not set'}. Add --send to publish.`);
  process.exit(0);
}

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is missing');
if (!channel) throw new Error('Set CHANNEL_USERNAME in bot/.env first (the channel must exist and the bot must be its admin)');

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

for (const p of posts) {
  const message = await call('sendMessage', { chat_id: `@${channel}`, text: p.text, link_preview_options: { is_disabled: true } });
  console.log(`posted Post ${p.n} · ${p.title} (message ${message.message_id})`);
  if (p.n === 1) {
    await call('pinChatMessage', { chat_id: `@${channel}`, message_id: message.message_id, disable_notification: true });
    console.log('pinned the welcome post');
  }
  await new Promise((r) => setTimeout(r, 1500)); // stay well inside Telegram's rate limit
}
