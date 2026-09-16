import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEP, SKIP, begin, applyText, applyContact, hasSignedUp, isComplete, normalizePhone, suggestedName } from '../src/signup.js';

const fresh = { id: 42, firstName: 'Abebe', lastName: 'Kebede', username: 'abebe', name: null, phone: null, signup: null, signedUpAt: null };

test('sign-up walks name -> phone -> done and marks the profile complete', () => {
  let user = begin(fresh);
  assert.equal(user.signup.step, STEP.NAME);
  assert.equal(isComplete(user), false);
  assert.equal(hasSignedUp(user), false);

  let r = applyText(user, 'A');
  assert.match(r.reply, /between 2 and 32/);
  assert.equal(r.user.signup.step, STEP.NAME);

  r = applyText(user, '  Abebe K  ');
  assert.equal(r.user.name, 'Abebe K');
  assert.equal(r.user.signup.step, STEP.PHONE);
  assert.match(r.reply, /Step 2 of 2/);

  const bad = applyText(r.user, 'call me');
  assert.match(bad.reply, /does not look like a phone/);
  assert.equal(bad.done, false);

  const done = applyText(r.user, '0900 000 000');
  assert.equal(done.done, true);
  assert.equal(done.user.phone, '+251900000000');
  assert.equal(done.user.signup, null);
  assert.ok(done.user.signedUpAt);
  assert.equal(hasSignedUp(done.user), true);
  assert.equal(isComplete(done.user), true);
  assert.match(done.reply, /Profile saved, \*Abebe K\*/);
  assert.match(done.reply, /\+251900000000/);
  assert.doesNotMatch(done.reply, /email/i);
});

test("a shared contact finishes sign-up, but only the user's own contact", () => {
  const atPhone = applyText(begin(fresh), 'Abebe').user;
  const other = applyContact(atPhone, { phone_number: '+251900000000', user_id: 7 });
  assert.equal(other.done, false);
  assert.match(other.reply, /your own/);
  const mine = applyContact(atPhone, { phone_number: '251900000000', user_id: 42 });
  assert.equal(mine.done, true);
  assert.equal(mine.user.phone, '+251900000000');
  assert.equal(isComplete(mine.user), true);
});

test('skipping the phone finishes sign-up but leaves the profile incomplete', () => {
  const atPhone = applyText(begin(fresh), 'Abebe').user;
  const done = applyText(atPhone, SKIP);
  assert.equal(done.done, true);
  assert.equal(done.user.phone, null);
  assert.equal(done.user.signup, null);
  assert.equal(hasSignedUp(done.user), true);
  assert.equal(isComplete(done.user), false);
  assert.match(done.reply, /No phone yet/);
  // Adding the phone later (from the profile screen) completes the profile.
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
});
