import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, keysOf, langOf, LANGS, DEFAULT_LANG, BOT_PROFILE, md } from '../src/i18n.js';
import { helpText, rulesText, balanceText, depositText, withdrawText, contactText } from '../src/replies.js';

const info = {
  balance: 5,
  currency: 'ETB',
  deposit: { min: 10, max: 5000, feePercent: 0, accounts: [{ method: 'telebirr', account: '0937766034', name: 'Aman' }, { method: 'telebirr', account: '0960524040', name: 'Amanuel_H' }] },
  withdraw: { min: 50, max: 5000, feePercent: 2 },
  game: { stakes: [10, 20, 50], maxCartelas: 4, cartelaCount: 400, maxPrize: 3000, countdownMs: 40000 },
};

test('both languages have exactly the same texts, none of them empty', () => {
  assert.deepEqual(keysOf('am'), keysOf('en'));
  for (const lang of LANGS) for (const key of keysOf(lang)) assert.ok(t(lang, key).trim().length > 0, `${lang}:${key}`);
  // the same placeholders on both sides, or a value would silently go missing
  const slots = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of keysOf('en')) assert.deepEqual(slots(t('am', key)), slots(t('en', key)), key);
});

test('Amharic is the default; an unknown language or key never throws', () => {
  assert.equal(DEFAULT_LANG, 'am');
  assert.equal(langOf(null), 'am');
  assert.equal(langOf({ lang: 'en' }), 'en');
  assert.equal(langOf({ lang: 'fr' }), 'am');
  assert.equal(t('fr', 'menu.wallet'), t('am', 'menu.wallet'));
  assert.equal(t('am', 'no.such.key'), 'no.such.key');
  assert.equal(t('en', 'balance.text', { balance: 12 }), '💵 *Your wallet:* 12 ETB');
});

test('help commands quote the live settings in either language', () => {
  assert.match(rulesText('en', info), /10 \/ 20 \/ 50 ETB/);
  assert.match(rulesText('en', info), /up to 4 cartelas \(1–400\) before the 40 s/);
  assert.match(rulesText('am', info), /እስከ 4 ካርቴላ/);
  assert.match(rulesText('am', info), /3,000 ብር/);
  assert.match(rulesText('en', { game: { stakes: [0, 5], maxCartelas: 2, cartelaCount: 100, maxPrize: 500, countdownMs: 20000 } }), /\(5 ETB entry/);

  const dep = depositText('en', info);
  assert.match(dep, /`0937766034` — Aman/);
  assert.ok(dep.includes(String.raw`— Amanuel\_H`)); // names are escaped for Markdown
  assert.match(dep, /Minimum 10 ETB · deposit fee 0%/);
  assert.match(depositText('am', info), /Transaction No/);
  assert.match(depositText('en', null), /open \*Wallet → Deposit\*/); // server unreachable: still useful

  assert.match(withdrawText('en', info), /Minimum 50 ETB · service fee 2%/);
  assert.match(withdrawText('am', null), /ዝቅተኛ 50 ብር · የአገልግሎት ክፍያ 2%/);

  assert.match(balanceText('en', info), /5 ETB[\s\S]*below the cheapest table \(10 ETB\)/);
  assert.doesNotMatch(balanceText('en', { ...info, balance: 80 }), /cheapest/);
  assert.match(balanceText('am', { ...info, balance: 1250.5 }), /1,250\.5 ብር/);

  const contact = contactText('en', { id: 42, support: 'usabingo_support', channel: 'usabingo_official' });
  for (const part of [String.raw`@usabingo\_support`, String.raw`@usabingo\_official`, '`42`']) assert.ok(contact.includes(part), part);
  assert.match(contactText('am', { id: 42 }), /በቅርቡ/);
  assert.match(helpText('am'), /\/deposit/);
  assert.equal(md('a_b'), String.raw`a\_b`);
});

test('the public bot profile fits Telegram limits and makes no claim we cannot back', () => {
  assert.ok(BOT_PROFILE.about.length <= 120, `about is ${BOT_PROFILE.about.length}`);
  assert.ok(BOT_PROFILE.description.length <= 512, `description is ${BOT_PROFILE.description.length}`);
  for (const text of Object.values(BOT_PROFILE)) assert.doesNotMatch(text, /licen[sc]ed|#1|guarantee|ፈቃድ ያለው/i);
});
