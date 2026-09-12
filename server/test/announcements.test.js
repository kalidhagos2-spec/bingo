import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentStore } from '../src/store.js';
import { createAnnouncements } from '../src/announcements.js';
import { freshPool } from './helpers/pg.js';

async function freshStore(t) {
  const { pool } = await freshPool(t);
  const store = new PaymentStore(pool);
  await store.load();
  return store;
}

const T0 = Date.UTC(2026, 8, 8, 12, 0, 0);

test('announcements are validated, pushed live, listed while active, and removable', async (t) => {
  const store = await freshStore(t);
  const emitted = [];
  let clock = T0;
  const io = { emit: (event, payload) => emitted.push({ event, payload }) };
  const ann = createAnnouncements({ store, io, now: () => clock });

  await assert.rejects(() => ann.post({ text: 'x' }), /2–500 characters/);
  await assert.rejects(() => ann.post({ text: 'hello', level: 'loud' }), /info, warning or promo/);
  await assert.rejects(() => ann.post({ text: 'hello', expiresInHours: 0 }), /1–720 hours/);

  const a = await ann.post({ text: '  Double coins tonight!  ', level: 'promo', expiresInHours: 2 });
  assert.equal(a.text, 'Double coins tonight!');
  assert.equal(a.expiresAt, '2026-09-08T14:00:00.000Z');
  assert.deepEqual(emitted.at(-1), { event: 'announcement', payload: { id: a.id, text: a.text, level: 'promo', createdAt: a.createdAt, expiresAt: a.expiresAt } });
  const b = await ann.post({ text: 'Maintenance at midnight', level: 'warning' });
  assert.deepEqual((await ann.active()).map((x) => x.id), [b.id, a.id]); // newest first

  clock = T0 + 3 * 3_600_000; // the promo has expired
  assert.deepEqual((await ann.active()).map((x) => x.id), [b.id]);
  assert.equal((await ann.all()).length, 2);

  await ann.remove(b.id);
  assert.deepEqual(await ann.active(), []);
  assert.deepEqual(emitted.at(-1), { event: 'announcement:removed', payload: { id: b.id } });
  await assert.rejects(() => ann.remove('nope'), /not found/);

  const onDisk = await ann.all();
  assert.equal(onDisk.length, 2);
  const removed = onDisk.find((x) => x.id === b.id);
  assert.equal(removed.active, false);
});

test('telegram broadcast goes to Telegram players only and records the outcome', async (t) => {
  const store = await freshStore(t);
  await store.setProfile(1, { name: 'A' });
  await store.setProfile(2, { name: 'B' });
  await store.setProfile(9_000_000_000_000, { email: 'x@example.com' }); // email-only: no chat
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url, body });
    return { ok: body.chat_id !== 2 }; // player 2 blocked the bot
  };
  const ann = createAnnouncements({ store, botToken: 'TOKEN', fetchImpl });
  assert.deepEqual(ann.telegramRecipients(), [1, 2]);
  const a = await ann.post({ text: 'Big prize weekend', level: 'promo', telegram: true });
  await new Promise((r) => setTimeout(r, 200));
  const saved = await store.getAnnouncement(a.id);
  assert.deepEqual(saved.telegram, { requested: true, sent: 1, failed: 1, done: true, recipients: 2 });
  assert.match(calls[0].url, /api\.telegram\.org\/botTOKEN\/sendMessage/);
  assert.equal(calls[0].body.text, '🎁 Big prize weekend');

  const noToken = createAnnouncements({ store, botToken: '' });
  const b = await noToken.post({ text: 'No bot here', telegram: true });
  await new Promise((r) => setTimeout(r, 50));
  const savedB = await store.getAnnouncement(b.id);
  assert.equal(savedB.telegram.error, 'BOT_TOKEN not set');
});
