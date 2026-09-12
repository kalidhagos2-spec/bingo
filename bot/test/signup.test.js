import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEP, SKIP, begin, applyText, applyContact, isComplete, normalizePhone, normalizeEmail, suggestedName } from '../src/signup.js';

const fresh = { id: 42, firstName: 'Abebe', lastName: 'Kebede', username: 'abebe', name: null, phone: null, email: null, signup: null, signedUpAt: null };

test('sign-up walks name -> phone -> done and marks the profile complete', () => {
  let user = begin(fresh);
  assert.equal(user.signup.step, STEP.NAME);
  assert.equal(isComplete(user), false);

  let r = applyText(user, 'A');
  assert.match(r.reply, /between 2 and 32/);
  assert.equal(r.user.signup.step, STEP.NAME);

  r = applyText(user, '  Abebe K  ');
  assert.equal(r.user.name, 'Abebe K');
  assert.equal(r.user.signup.step, STEP.PHONE);
  assert.match(r.reply, /Step 2 of 3/);

  const bad = applyText(r.user, 'call me');
  assert.match(bad.reply, /does not look like a phone/);
  assert.equal(bad.done, false);

  const atEmail = applyText(r.user, '0900 000 000');
  assert.equal(atEmail.done, false);
  assert.equal(atEmail.user.phone, '+251900000000');
  assert.equal(atEmail.user.signup.step, STEP.EMAIL);
  assert.match(atEmail.reply, /Step 3 of 3/);

  const badMail = applyText(atEmail.user, 'abebe at example');
  assert.match(badMail.reply, /does not look like an email/);

  const done = applyText(atEmail.user, ' Abebe@Example.com ');
  assert.equal(done.done, true);
  assert.equal(done.user.email, 'abebe@example.com');
  assert.equal(done.user.signup, null);
  assert.ok(done.user.signedUpAt);
  assert.equal(isComplete(done.user), true);
  assert.match(done.reply, /Profile saved, \*Abebe K\*/);
  assert.match(done.reply, /abebe@example.com/);
});

test('a shared contact completes the phone step, but only the user\'s own contact', () => {
  const atPhone = applyText(begin(fresh), 'Abebe').user;
  const other = applyContact(atPhone, { phone_number: '+251900000000', user_id: 7 });
  assert.equal(other.done, false);
  assert.match(other.reply, /your own/);
  const mine = applyContact(atPhone, { phone_number: '251900000000', user_id: 42 });
  assert.equal(mine.done, false);
  assert.equal(mine.user.phone, '+251900000000');
  assert.equal(mine.user.signup.step, STEP.EMAIL);
});

test('skipping the phone still requires an email; the profile stays incomplete without a phone', () => {
  const atPhone = applyText(begin(fresh), 'Abebe').user;
  const r = applyText(atPhone, SKIP);
  assert.equal(r.done, false);
  assert.equal(r.user.phone, null);
  assert.equal(r.user.signup.step, STEP.EMAIL);
  const done = applyText(r.user, 'abebe@example.com');
  assert.equal(done.done, true);
  assert.equal(isComplete(done.user), false);
  assert.match(done.reply, /No phone yet/);
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
  assert.equal(normalizeEmail(' X@Y.com '), 'x@y.com');
  assert.equal(normalizeEmail('x@y'), null);
  assert.equal(suggestedName(fresh), 'Abebe Kebede');
  assert.equal(suggestedName({ id: 5, username: 'sara' }), 'sara');
  assert.equal(suggestedName({ id: 5 }), 'Player 5');
});
