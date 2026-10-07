import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setReferrer, referralDue, alertTargets, prefsOf, MIN_DEPOSIT, MAX_REWARDED, ALERT_GAP_MS } from '../src/referral.js';
import { createPlayerNotifier } from '../src/notify.js';

const signedUp = { name: 'A', phone: '+2519', signedUpAt: '2026-01-01T00:00:00Z' };

test('an inviter is recorded once, never yourself, and only when they are a signed-up player', () => {
  const me = {};
  assert.equal(setReferrer(me, 5, signedUp, 9), true);
  assert.equal(prefsOf(me).referredBy, 5);
  assert.equal(setReferrer(me, 6, signedUp, 9), false, 'only the first inviter counts');
  assert.equal(setReferrer({}, 9, signedUp, 9), false, 'not yourself');
  assert.equal(setReferrer({}, 5, { name: 'ghost' }, 9), false, 'inviter must have signed up');
});

test('the reward is paid once, after a big enough deposit, and a referrer has a cap', () => {
  const newbie = {};
  const inviter = { ...signedUp };
  setReferrer(newbie, 5, inviter, 9);
  assert.equal(referralDue(newbie, inviter, MIN_DEPOSIT - 1), null, 'too small');
  assert.equal(referralDue(newbie, inviter, MIN_DEPOSIT), 5);
  assert.equal(inviter.prefs.referralsPaid, 1);
  assert.equal(referralDue(newbie, inviter, 500), null, 'only once per invited player');

  const capped = { ...signedUp, prefs: { referralsPaid: MAX_REWARDED } };
  const another = {};
  setReferrer(another, 5, capped, 10);
  assert.equal(referralDue(another, capped, 500), null);
});

test('table alerts reach only opted-in players who are away, can afford it, and were not alerted recently', () => {
  const now = Date.UTC(2026, 5, 1);
  const on = (extra = {}) => ({ prefs: { tableAlerts: true, ...extra } });
  const profiles = { 1: on(), 2: on(), 3: on(), 4: on({ lastAlertAt: new Date(now - 60_000).toISOString() }), 5: {}, 6: on(), 7: on({ lastAlertAt: new Date(now - ALERT_GAP_MS - 1).toISOString() }) };
  const ids = alertTargets({
    profiles, stake: 20, now,
    isConnected: (id) => id === 2,
    balanceOf: (id) => (id === 3 ? 5 : 100),
    blocked: (id) => id === 6,
    adultOk: () => true,
  });
  assert.deepEqual(ids, [1, 7]);
});

test('the notifier messages the targets with a button to open the Mini App', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => (sent.push({ url, body: JSON.parse(init.body) }), { ok: true });
  const store = { tableAlertTargets: ({ stake }) => (stake === 10 ? [11, 12] : []) };
  const io = { sockets: { adapter: { rooms: new Map() } }, to: () => ({ emit() {} }) };
  const notifier = createPlayerNotifier({ io, store, botToken: 'T', webappUrl: 'https://bingo.example', fetchImpl });
  assert.equal(notifier.tableStarting({ stake: 10, seconds: 40 }), 2);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(sent.map((m) => m.body.chat_id), [11, 12]);
  assert.match(sent[0].body.text, /10 ETB/);
  assert.equal(sent[0].body.reply_markup.inline_keyboard[0][0].web_app.url, 'https://bingo.example');
  assert.equal(notifier.tableStarting({ stake: 50 }), 0);
});
