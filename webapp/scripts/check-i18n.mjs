/**
 * i18n self-check: `node scripts/check-i18n.mjs` (from webapp/). Fails when
 *  - `en` and `am` do not carry exactly the same keys, or a value is empty,
 *  - a translation lost or gained a `{placeholder}` compared with the other language,
 *  - a key used in src/ (`t('…')`, `tSplit('…')`, `tServer(`prefix.${id}…`)`) is not in the dictionary,
 *  - an error/note rule points at a missing key, or a sample server message stays English in Amharic,
 *  - a mission or shop item of server/src/economy.js (when that file is around) has no Amharic title.
 * Keys nobody uses are listed as a warning only.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS, ERROR_RULES, NOTE_RULES, etb, getLang, setLang, t, tError, tNote, tServer } from '../src/lib/i18n.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const fail = (message) => problems.push(message);

// ---------- 1. same keys, no empty values, same placeholders ----------
const en = Object.keys(STRINGS.en);
const am = Object.keys(STRINGS.am);
for (const key of en) if (!(key in STRINGS.am)) fail(`missing in am: ${key}`);
for (const key of am) if (!(key in STRINGS.en)) fail(`missing in en: ${key}`);
const slots = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
for (const [lang, table] of Object.entries(STRINGS)) {
  for (const [key, value] of Object.entries(table)) {
    if (typeof value !== 'string' || !value.trim()) fail(`empty value: ${lang}.${key}`);
    else if (key in STRINGS.en && slots(value) !== slots(STRINGS.en[key])) fail(`placeholders differ: ${lang}.${key} has {${slots(value)}}, en has {${slots(STRINGS.en[key])}}`);
  }
}

// ---------- 2. every key used in src/ exists ----------
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const sources = walk(join(root, 'src')).filter((file) => /\.(jsx?|mjs)$/.test(file));
const used = new Set();
const usedPatterns = [];
const CALL = /\b(?:t|tSplit|tServer)\(\s*([^)]*?\))/gs; // the call up to its first ")": enough for the key argument
for (const file of sources) {
  const where = relative(root, file);
  for (const [, args] of readFileSync(file, 'utf8').matchAll(CALL)) {
    const keyPart = args.split(/,(?![^{]*\})/)[0]; // first argument (a ternary of literals at most)
    for (const [, key] of keyPart.matchAll(/['"]([a-z][\w.]*)['"]/gi)) {
      used.add(key);
      if (!(key in STRINGS.en)) fail(`${where}: unknown key '${key}'`);
    }
    for (const [, template] of keyPart.matchAll(/`([^`]*\$\{[^`]*)`/g)) {
      const pattern = new RegExp(`^${template.replace(/[.*+?^()|[\]\\]/g, '\\$&').replace(/\$\{[^}]*\}/g, '[^.]+')}$`);
      usedPatterns.push(pattern);
      if (!en.some((key) => pattern.test(key))) fail(`${where}: no key matches \`${template}\``);
    }
  }
}

// ---------- 3. server text rules ----------
for (const [pattern, key] of [...ERROR_RULES, ...NOTE_RULES]) {
  used.add(key);
  if (!(key in STRINGS.en)) fail(`rule ${pattern} points at unknown key '${key}'`);
}

const ERROR_SAMPLES = [
  'Insufficient balance: this room costs 10 per cartela',
  'Insufficient balance: you have 4.00 ETB',
  'Cartela 17 is already taken by Abebe K',
  'You can hold up to 4 cartelas',
  'Wait for the next round to pick a cartela',
  'Wait for the next round to change cartelas',
  'Game already in progress',
  'Room is full',
  'You are not in a room',
  'You are not in this room',
  'That number has not been called',
  'That number is not on your cards',
  'Not yet: 7/24 marked',
  'Not yet: complete a row, column, diagonal or all four corners (3/24 marked)',
  'Request failed',
  'Request failed (502)',
  'Open this game from Telegram to play online.',
  'Account suspended',
  'Account suspended: cheating',
  'Account suspended permanently: Suspended by operator',
  'Account suspended until 25/12/2026: Suspended by operator',
  'This table was closed by the operator',
  'Amount must be between 10 and 5000 ETB',
  'Minimum transfer is 5 ETB',
  'Enter a valid phone number, e.g. 0900000000',
  'No player with that phone number has signed up yet',
  'You cannot send money to yourself',
  'Enter the Telebirr phone number to pay out to, e.g. 0900000000',
  'Cash-outs are paid by Telebirr only',
  'Enter the transaction / receipt id exactly as shown on the receipt (6–32 letters and digits)',
  'This transaction id has already been submitted',
  'Withdrawal already paid',
  'Withdrawal already processing',
  'Name must be 2–32 characters',
  'Phone must be 7–15 digits, e.g. +251900000000',
  'Not enough coins: you need 500, you have 120',
  'Not finished yet: 1/3',
  'Failed to fetch',
];
const NOTE_SAMPLES = [
  'Stake for cartela 12 in room AB12',
  'Refund for cartela 12 in room AB12',
  'Prize for room AB12',
  'Operator adjustment: Refund for room FC8S',
  'Transfer Abebe → Sara (+251911000000)',
  'Transfer via telebirr, receipt CK12AB34',
  'Cash out to telebirr 0911000000',
  'Cancelled by player',
  'Transfer could not be confirmed',
  'Daily bonus · day 3',
  'Mission · Play 3 rounds',
  'Shop · Gold cartela',
  'Won Free Bingo',
];
const ETHIOPIC = /[ሀ-፿]/;

setLang('en');
if (getLang() !== 'en') fail('setLang("en") did not switch the language');
for (const message of ERROR_SAMPLES) if (tError(message) !== message) fail(`en: tError changed "${message}"`);
if (etb(50) !== '50 ETB' || etb(12.5) !== '12.50 ETB') fail(`en: etb() gives "${etb(50)}" / "${etb(12.5)}"`);
if (t('no.such.key') !== 'no.such.key') fail('t() must fall back to the key itself');

setLang('am');
for (const [samples, translate] of [[ERROR_SAMPLES, tError], [NOTE_SAMPLES, tNote]]) {
  for (const message of samples) {
    const out = translate(message);
    if (out === message || !ETHIOPIC.test(out)) fail(`am: not translated: "${message}"`);
    else if (/\{\w+\}/.test(out)) fail(`am: unfilled placeholder in "${out}" (from "${message}")`);
  }
}
if (tError('Some brand new server message') !== 'Some brand new server message') fail('am: an unknown message must pass through unchanged');
if (tError('Cartela 17 is already taken by Abebe K') !== 'ካርቴላ 17 በAbebe K ተይዟል') fail(`am: unexpected "${tError('Cartela 17 is already taken by Abebe K')}"`);
if (etb(50) !== '50 ብር') fail(`am: etb(50) gives "${etb(50)}"`);
if (t('game.bingo') !== 'ቢንጎ!' || t('game.cartela', { n: 7 }) !== 'ካርቴላ 7') fail('am: BINGO! / Cartela wording changed');
if (tServer('mission.nope.title', 'Server text') !== 'Server text') fail('tServer must fall back to the server text');

// ---------- 4. mission and shop ids of the server ----------
const economy = join(root, '..', 'server', 'src', 'economy.js');
if (existsSync(economy)) {
  const source = readFileSync(economy, 'utf8');
  const idsOf = (name) => [...(source.match(new RegExp(`export const ${name} = Object\\.freeze\\(\\[(.*?)\\]\\)`, 's'))?.[1] ?? '').matchAll(/\bid: '(\w+)'/g)].map((m) => m[1]);
  for (const id of idsOf('MISSIONS')) if (!STRINGS.am[`mission.${id}.title`]) fail(`server mission '${id}' has no mission.${id}.title`);
  for (const id of idsOf('SHOP')) if (!STRINGS.am[`shop.${id}.title`]) fail(`server shop item '${id}' has no shop.${id}.title`);
}

// ---------- report ----------
const unused = en.filter((key) => !used.has(key) && !usedPatterns.some((pattern) => pattern.test(key)));
if (unused.length) console.warn(`warning: ${unused.length} key(s) not referenced from src/: ${unused.join(', ')}`);
if (problems.length) {
  console.error(`i18n check FAILED (${problems.length}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`i18n check passed: ${en.length} keys x ${Object.keys(STRINGS).length} languages, ${used.size} literal keys used in ${sources.length} files, ${ERROR_RULES.length} error rules, ${NOTE_RULES.length} note rules.`);
