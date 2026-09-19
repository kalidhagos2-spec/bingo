import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEP, SKIP, begin, applyText, applyContact, hasSignedUp, isComplete, normalizePhone, suggestedName, nameChoices, cleanName, promptFor, md } from '../src/signup.js';

// The flow is asserted on its English texts; Amharic, the default, is covered at the end.
const fresh = { id: 42, firstName: 'Abebe', lastName: 'Kebede', username: 'abebe', name: null, phone: null, lang: 'en', signup: null, signedUpAt: null };

/** A fresh player who has already answered the username step. */
const named = (name = 'Abebe Kebede') => applyText(begin(fresh), name).user;

test('sign-up asks for a username first, then the phone number', () => {
  const user = begin(fresh);
  assert.equal(user.signup.step, STEP.NAME);
  assert.equal(user.name, null); // nothing is assumed: the player is asked
  assert.match(promptFor(user), /Step 1 of 2 · your username/);
  assert.deepEqual(nameChoices(user), ['abebe', 'Abebe Kebede']); // one-tap suggestions from Telegram

  const bad = applyText(user, '7');
  assert.match(bad.reply, /will not work/);
  assert.equal(bad.user.signup.step, STEP.NAME);

  const picked = applyText(user, '  @abebe  ');
  assert.equal(picked.done, false);
  assert.equal(picked.user.name, 'abebe');
  assert.equal(picked.user.signup.step, STEP.PHONE);
  assert.match(picked.reply, /Nice to meet you, \*abebe\*/);
  assert.match(picked.reply, /Step 2 of 2 · your phone number/);
  assert.equal(hasSignedUp(picked.user), false);

  const wrong = applyText(picked.user, 'call me');
  assert.match(wrong.reply, /does not look like a phone/);
  assert.equal(wrong.done, false);

  const done = applyText(picked.user, '0900 000 000');
  assert.equal(done.done, true);
  assert.equal(done.user.phone, '+251900000000');
  assert.equal(done.user.signup, null);
  assert.ok(done.user.signedUpAt);
  assert.equal(hasSignedUp(done.user), true);
  assert.equal(isComplete(done.user), true);
  assert.match(done.reply, /registered, \*abebe\*/);
  assert.match(done.reply, /\+251900000000/);
});

test('a player who already has a username goes straight to the phone step', () => {
  const user = begin({ ...fresh, name: 'Abe' });
  assert.equal(user.name, 'Abe');
  assert.equal(user.signup.step, STEP.PHONE);
  assert.match(promptFor(user), /Nice to meet you, \*Abe\*/);
});

test('usernames: cleaned, limited, and safe inside Markdown', () => {
  assert.equal(cleanName('  Sara   T  '), 'Sara T');
  assert.equal(cleanName('@sara_t'), 'sara_t');
  assert.equal(cleanName('አበበ'), 'አበበ'); // any script counts as letters
  assert.equal(cleanName('a'), null);
  assert.equal(cleanName('x'.repeat(33)), null);
  assert.equal(cleanName('0911223344'), null); // a phone number is not a username
  assert.equal(cleanName('/start'), null);
  assert.equal(md('sara_t*[x]`'), String.raw`sara\_t\*\[x]` + '\\`');
  assert.match(applyText(begin(fresh), 'sara_t').reply, /\*sara\\_t\*/);
  assert.deepEqual(nameChoices({ id: 5 }), ['Player 5']);
  assert.deepEqual(nameChoices({ id: 5, username: 'sara', firstName: 'sara' }), ['sara']);
});

test('a contact shared during the username step asks for the username first', () => {
  const r = applyContact(begin(fresh), { phone_number: '+251900000000', user_id: 42 });
  assert.equal(r.done, false);
  assert.equal(r.user.phone, null);
  assert.match(r.reply, /First choose your username/);
});

test("a shared contact finishes sign-up, but only the user's own contact", () => {
  const user = named();
  const other = applyContact(user, { phone_number: '+251900000000', user_id: 7 });
  assert.equal(other.done, false);
  assert.match(other.reply, /your own/);
  const mine = applyContact(user, { phone_number: '251900000000', user_id: 42 });
  assert.equal(mine.done, true);
  assert.equal(mine.user.phone, '+251900000000');
  assert.equal(isComplete(mine.user), true);
});

test('skipping the phone finishes sign-up but leaves the profile incomplete', () => {
  const done = applyText(named(), SKIP);
  assert.equal(done.done, true);
  assert.equal(done.user.phone, null);
  assert.equal(done.user.signup, null);
  assert.equal(hasSignedUp(done.user), true);
  assert.equal(isComplete(done.user), false);
  assert.match(done.reply, /No phone yet/);
  assert.equal(isComplete({ ...done.user, phone: '+251900000000' }), true);
});

test('isComplete mirrors the server rule: name and phone are required, nothing else', () => {
  const base = { ...fresh, name: 'Abebe', phone: '+251900000000', signedUpAt: '2024-01-01T00:00:00.000Z' };
  assert.equal(isComplete(base), true);
  assert.equal(isComplete({ ...base, name: null }), false);
  assert.equal(isComplete({ ...base, phone: null }), false);
  assert.equal(isComplete(null), false);
  assert.equal(hasSignedUp({ ...base, signedUpAt: null }), false);
  assert.equal(hasSignedUp(null), false);
});

test('text outside a sign-up is not consumed', () => {
  const r = applyText({ ...fresh, signup: null }, 'hello');
  assert.equal(r.reply, null);
  assert.equal(r.done, false);
});

test('phone normalisation and suggested names', () => {
  assert.equal(normalizePhone('+251 90 000 0000'), '+251900000000');
  assert.equal(normalizePhone('0900000000'), '+251900000000');
  assert.equal(normalizePhone('251900000000'), '+251900000000');
  assert.equal(normalizePhone('12'), null);
  assert.equal(normalizePhone('abc'), null);
  assert.equal(suggestedName(fresh), 'Abebe Kebede');
  assert.equal(suggestedName({ id: 5, username: 'sara' }), 'sara');
  assert.equal(suggestedName({ id: 5 }), 'Player 5');
  assert.equal(suggestedName({ id: 5, firstName: 'x'.repeat(40) }).length, 32);
});

test('sign-up speaks Amharic by default and understands the Amharic skip button', () => {
  const user = begin({ ...fresh, lang: null });
  assert.match(promptFor(user), /ደረጃ 1\/2/);
  const picked = applyText(user, 'abebe');
  assert.match(picked.reply, /ደረጃ 2\/2/);
  assert.match(applyText(picked.user, 'ሰላም').reply, /ስልክ ቁጥር አይመስልም/);
  const done = applyText(picked.user, 'ለአሁን ዝለል');
  assert.equal(done.done, true);
  assert.equal(done.user.phone, null);
  assert.match(done.reply, /ተመዝግበዋል/);
  // the English label still works for someone who switched language mid-way
  assert.equal(applyText(picked.user, SKIP).done, true);
});
