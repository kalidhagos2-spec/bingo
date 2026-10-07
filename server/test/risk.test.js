import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depositRisk } from '../src/risk.js';

const NOW = Date.UTC(2026, 5, 1);
const none = { paidCount: 0, paidTotal: 0, pendingCount: 0, last24hCount: 0 };
const regular = { name: 'A', phone: '+251900000001', signedUpAt: new Date(NOW - 30 * 86_400_000).toISOString(), stats: { games: 40 } };

test('a regular player depositing their usual amount scores low', () => {
  const r = depositRisk({ tx: { amount: 100 }, profile: regular, history: { ...none, paidCount: 10, paidTotal: 1000 }, now: NOW });
  assert.equal(r.level, 'low');
  assert.deepEqual(r.reasons, []);
});

test('a new account making a large first deposit with a failed receipt check is high risk, with reasons', () => {
  const profile = { name: 'B', phone: '+251900000002', signedUpAt: new Date(NOW - 3_600_000).toISOString(), stats: { games: 0 } };
  const r = depositRisk({ tx: { amount: 5000, autoCheck: 'receipt not found', payerPhone: '+251911111111' }, profile, history: { ...none, pendingCount: 3 }, now: NOW });
  assert.equal(r.level, 'high');
  assert.ok(r.score <= 100);
  for (const why of ['account under a day old', 'large first deposit', 'receipt did not match automatically', '3 deposits waiting', 'paid from a different phone than their profile']) {
    assert.ok(r.reasons.includes(why), why);
  }
});

test('a deposit far above the player\'s own average is flagged', () => {
  const r = depositRisk({ tx: { amount: 900 }, profile: regular, history: { ...none, paidCount: 4, paidTotal: 400 }, now: NOW });
  assert.ok(r.reasons.includes('much larger than their usual deposit'));
  assert.notEqual(r.level, 'high');
});
