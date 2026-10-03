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
export function createPlayerNotifier({ io, store, botToken = '', fetchImpl = globalThis.fetch, log = console }) {
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

  return { balance, withdrawal };
}
