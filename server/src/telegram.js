/**
 * One Telegram message to one chat. Chat id = the player's Telegram user id. Never throws:
 * a message that cannot be delivered (blocked bot, network) just returns false.
 */
export async function sendTelegram({ botToken, chatId, text, fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  if (!botToken || !chatId || !text) return false;
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
