import { sendTelegram } from './telegram.js';

const etb = (n) => Number(n ?? 0).toFixed(Number(n) % 1 ? 2 : 0);

/**
 * What a player is told when their cash-out is settled: both languages, since the server
 * does not know which one they chose in the bot.
 */
export function withdrawalMessage(tx) {
  const gross = etb(-tx.amount);
  const net = etb(tx.payout);
  const to = `${tx.method} ${tx.account}`;
  const reason = tx.reason ?? '';
  if (tx.status === 'paid') return `✅ ${net} ETB was sent to ${to}.\n✅ ${net} ብር ወደ ${to} ተልኳል።`;
  if (tx.status === 'failed') return `❌ Your cash-out of ${gross} ETB could not be sent (${reason}). The money is back in your wallet.\n❌ የ${gross} ብር ወጪዎ መላክ አልተቻለም (${reason})። ገንዘቡ ወደ ዋሌትዎ ተመልሷል።`;
  if (tx.status === 'rejected') return `⛔ Your cash-out of ${gross} ETB was declined: ${reason}. The money is back in your wallet.\n⛔ የ${gross} ብር ወጪዎ ውድቅ ሆኗል፦ ${reason}። ገንዘቡ ወደ ዋሌትዎ ተመልሷል።`;
  return null;
}

/** Live pushes to a player's open Mini App, and Telegram messages for things worth a notification. */
export function createPlayerNotifier({ io, store, botToken = '', webappUrl = '', fetchImpl = globalThis.fetch, log = console }) {
  const room = (userId) => io.to(`user:${userId}`);

  function balance(userId, value = store.balance(userId)) {
    room(userId).emit('wallet:balance', { balance: value });
  }

  /** A cash-out changed state (paid, failed, rejected…): refresh the wallet screen and message the player. */
  function withdrawal(tx) {
    balance(tx.userId);
    room(tx.userId).emit('wallet:update', { ref: tx.ref, type: 'withdraw', status: tx.status, reason: tx.reason ?? null, payout: tx.payout, amount: tx.amount, currency: tx.currency });
    const text = withdrawalMessage(tx);
    if (text && Number(tx.userId) > 0 && botToken) {
      sendTelegram({ botToken, chatId: tx.userId, text, fetchImpl }).then((ok) => {
        if (!ok) log.warn(`[notify] Telegram message about ${tx.ref} to ${tx.userId} was not delivered`);
      });
    }
  }

  /**
   * A table has enough players and its countdown started: tell the opted-in players who are not in
   * the app right now (at most one alert per player per half hour, see referral.ALERT_GAP_MS).
   */
  function tableStarting({ stake, seconds = 40 }) {
    if (!botToken) return 0;
    const ids = store.tableAlertTargets({ stake, isConnected: (id) => (io.sockets.adapter.rooms.get(`user:${id}`)?.size ?? 0) > 0 });
    const label = stake > 0 ? `${etb(stake)} ETB` : 'Free';
    const text = `🎯 A ${label} Bingo table is about to start (${seconds}s to pick a cartela).\n🎯 የ${label} ቢንጎ ጠረጴዛ ሊጀምር ነው (ካርቴላ ለመምረጥ ${seconds} ሰከንድ)።`;
    const replyMarkup = webappUrl.startsWith('https://') ? { inline_keyboard: [[{ text: '▶️ Play / ተጫወት', web_app: { url: webappUrl } }]] } : undefined;
    for (const chatId of ids) sendTelegram({ botToken, chatId, text, replyMarkup, fetchImpl });
    return ids.length;
  }

  return { balance, withdrawal, tableStarting };
}
