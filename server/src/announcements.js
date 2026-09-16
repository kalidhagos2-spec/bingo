import { randomBytes } from 'node:crypto';

export const LEVELS = Object.freeze(['info', 'warning', 'promo']);
const MAX_TEXT = 500;

/**
 * Operator announcements: stored in Postgres, pushed to connected players over the
 * socket, shown in the lobby until they expire or are removed, and optionally sent to
 * every Telegram player as a bot message.
 */
export function createAnnouncements({ store, io = null, botToken = '', fetchImpl = globalThis.fetch, now = Date.now }) {
  /** What players see: active announcements, newest first. */
  async function active() {
    return (await store.activeAnnouncements(now())).map(publicView);
  }

  async function all() {
    return store.allAnnouncements();
  }

  async function post({ text, level = 'info', expiresInHours = null, telegram = false, by = 'operator' }) {
    const body = String(text ?? '').trim();
    if (body.length < 2 || body.length > MAX_TEXT) throw new Error(`Message must be 2–${MAX_TEXT} characters`);
    if (!LEVELS.includes(level)) throw new Error('Level must be info, warning or promo');
    const hours = expiresInHours == null || expiresInHours === '' ? null : Number(expiresInHours);
    if (hours !== null && !(hours > 0 && hours <= 24 * 30)) throw new Error('Expiry must be 1–720 hours, or empty for no expiry');
    const at = now();
    const announcement = {
      id: randomBytes(6).toString('hex'),
      text: body,
      level,
      createdAt: new Date(at).toISOString(),
      expiresAt: hours ? new Date(at + hours * 3_600_000).toISOString() : null,
      active: true,
      by,
      telegram: telegram ? { requested: true, sent: 0, failed: 0, done: false } : null,
    };
    await store.addAnnouncement(announcement);
    io?.emit('announcement', publicView(announcement));
    if (telegram) broadcastTelegram(announcement).catch((err) => console.error('[announce] telegram broadcast failed:', err));
    return announcement;
  }

  async function remove(id) {
    const existing = await store.getAnnouncement(id);
    if (!existing) throw new Error('Announcement not found');
    if (!existing.active) return existing;
    const a = await store.deactivateAnnouncement(id);
    io?.emit('announcement:removed', { id });
    return a;
  }

  /** Telegram ids of every known player. */
  function telegramRecipients() {
    return store.telegramRecipientIds();
  }

  /** Sends the text to each Telegram player at ~25 messages/s; progress is saved on the announcement. */
  async function broadcastTelegram(announcement) {
    const ids = telegramRecipients();
    if (!botToken) {
      announcement.telegram = { ...announcement.telegram, done: true, error: 'BOT_TOKEN not set', recipients: ids.length };
      await store.setAnnouncementTelegram(announcement.id, announcement.telegram);
      return announcement.telegram;
    }
    announcement.telegram.recipients = ids.length;
    const prefix = announcement.level === 'warning' ? '⚠️ ' : announcement.level === 'promo' ? '🎁 ' : '📢 ';
    for (const id of ids) {
      try {
        const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: id, text: prefix + announcement.text }),
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) announcement.telegram.sent += 1;
        else announcement.telegram.failed += 1;
      } catch {
        announcement.telegram.failed += 1;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    announcement.telegram.done = true;
    await store.setAnnouncementTelegram(announcement.id, announcement.telegram);
    return announcement.telegram;
  }

  return { active, all, post, remove, telegramRecipients, broadcastTelegram, LEVELS };
}

function publicView(a) {
  return { id: a.id, text: a.text, level: a.level, createdAt: a.createdAt, expiresAt: a.expiresAt };
}
