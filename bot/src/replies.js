import { t, md } from './i18n.js';

/**
 * The texts of the help commands (/help, /rules, /balance, /deposit, /withdraw, /contact):
 * pure functions of the language and what the game server reported, so they are unit-tested
 * without Telegram. `info` is the answer of `GET /api/profile/bot/:id`; every function also
 * works without it (server unreachable) by falling back to the shipped defaults.
 */

const DEFAULTS = Object.freeze({
  deposit: { min: 10, feePercent: 0, accounts: [] },
  withdraw: { min: 50, feePercent: 2 },
  game: { stakes: [10, 20, 50], maxCartelas: 4, cartelaCount: 400, maxPrize: 3000, countdownMs: 40000 },
});

const amount = (n) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

export const helpText = (lang) => `${t(lang, 'help.title')}\n\n${t(lang, 'help.list')}`;

export function rulesText(lang, info = null) {
  const game = { ...DEFAULTS.game, ...info?.game };
  const stakes = game.stakes.filter((s) => s > 0);
  return t(lang, 'rules.text', {
    stakes: stakes.join(' / '),
    maxCartelas: game.maxCartelas,
    cartelaCount: game.cartelaCount,
    countdown: Math.round(game.countdownMs / 1000),
    maxPrize: amount(game.maxPrize),
  });
}

export function balanceText(lang, info) {
  const lines = [t(lang, 'balance.text', { balance: amount(info.balance) })];
  const cheapest = Math.min(...(info.game?.stakes ?? DEFAULTS.game.stakes).filter((s) => s > 0));
  if (Number.isFinite(cheapest) && info.balance < cheapest) lines.push(t(lang, 'balance.low', { stake: cheapest }));
  return lines.join('\n');
}

export function depositText(lang, info = null) {
  const deposit = { ...DEFAULTS.deposit, ...info?.deposit };
  const accounts = deposit.accounts.length
    ? deposit.accounts.map((a) => t(lang, 'deposit.account', { account: a.account, name: md(a.name || a.label || '') })).join('\n')
    : t(lang, 'deposit.noAccounts');
  return [
    t(lang, 'deposit.title'),
    '',
    t(lang, 'deposit.steps', { accounts }),
    '',
    t(lang, 'deposit.limits', { min: amount(deposit.min), fee: deposit.feePercent }),
    '',
    t(lang, 'deposit.warning'),
  ].join('\n');
}

export function withdrawText(lang, info = null) {
  const withdraw = { ...DEFAULTS.withdraw, ...info?.withdraw };
  return [
    t(lang, 'withdraw.title'),
    '',
    t(lang, 'withdraw.steps'),
    '',
    t(lang, 'withdraw.limits', { min: amount(withdraw.min), fee: withdraw.feePercent }),
    '',
    t(lang, 'withdraw.send'),
  ].join('\n');
}

/** `support` and `channel` are Telegram usernames without the @ (SUPPORT_USERNAME, CHANNEL_USERNAME). */
export function contactText(lang, { id, support = '', channel = '' }) {
  const lines = [support && t(lang, 'contact.support', { support: md(support) }), channel && t(lang, 'contact.channel', { channel: md(channel) })].filter(Boolean);
  return t(lang, 'contact.text', { lines: lines.length ? lines.join('\n') : t(lang, 'contact.none'), id });
}
