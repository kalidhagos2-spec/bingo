import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEP, SKIP, begin, applyText, applyContact, hasSignedUp, isComplete, normalizePhone, suggestedName, prompts } from '../src/signup.js';

const fresh = { id: 42, firstName: 'Abebe', lastName: 'Kebede', username: 'abebe', name: null, phone: null, signup: null, signedUpAt: null };

test('sign-up is one step: the Telegram name is used and the phone finishes it', () => {
  const user = begin(fresh);
  assert.equal(user.signup.step, STEP.PHONE);
  assert.equal(user.name, 'Abebe Kebede'); // filled in from Telegram, no question asked
  assert.equal(isComplete(user), false);
  assert.equal(hasSignedUp(user), false);
  assert.match(prompts.phone(user), /Welcome, \*Abebe Kebede\*/);

  const bad = applyText(user, 'call me');
  assert.match(bad.reply, /does not look like a phone/);
  assert.equal(bad.done, false);

  const done = applyText(user, '0900 000 000');
  assert.equal(done.done, true);
  assert.equal(done.user.phone, '+251900000000');
  assert.equal(done.user.signup, null);
  assert.ok(done.user.signedUpAt);
  assert.equal(hasSignedUp(done.user), true);
  assert.equal(isComplete(done.user), true);
  assert.match(done.reply, /registered, \*Abebe Kebede\*/);
  assert.match(done.reply, /\+251900000000/);
});

test('a name the player already chose is kept when sign-up restarts', () => {
  const user = begin({ ...fresh, name: 'Abe' });
  assert.equal(user.name, 'Abe');
});

test("a shared contact finishes sign-up, but only the user's own contact", () => {
  const user = begin(fresh);
  const other = applyContact(user, { phone_number: '+251900000000', user_id: 7 });
  assert.equal(other.done, false);
  assert.match(other.reply, /your own/);
  const mine = applyContact(user, { phone_number: '251900000000', user_id: 42 });
  assert.equal(mine.done, true);
  assert.equal(mine.user.phone, '+251900000000');
  assert.equal(isComplete(mine.user), true);
});

test('skipping the phone finishes sign-up but leaves the profile incomplete', () => {
  const done = applyText(begin(fresh), SKIP);
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
