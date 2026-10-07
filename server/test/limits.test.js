import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setDepositLimit, selfExclude, exclusionUntil, assertDepositAllowed, limitsView, COOLING_MS, DAY_MS } from '../src/limits.js';

const T0 = Date.UTC(2026, 0, 1);

test('a stricter deposit limit applies at once; raising or removing it waits out a 24 h cooling-off', () => {
  const p = {};
  assert.deepEqual(setDepositLimit(p, 500, T0), { applied: true, effectiveAt: null });
  assert.equal(limitsView(p, T0).depositLimit, 500);
  assert.equal(setDepositLimit(p, 200, T0).applied, true);
  const raise = setDepositLimit(p, 1000, T0);
  assert.equal(raise.applied, false);
  assert.equal(limitsView(p, T0 + COOLING_MS - 1).depositLimit, 200);
  assert.equal(limitsView(p, T0 + COOLING_MS).depositLimit, 1000);
  const remove = setDepositLimit(p, null, T0 + COOLING_MS);
  assert.equal(remove.applied, false);
  assert.equal(limitsView(p, T0 + 2 * COOLING_MS).depositLimit, null);
  assert.throws(() => setDepositLimit(p, 0, T0), /above zero/);
});

test('deposits are refused over the daily limit and during self-exclusion', () => {
  const p = {};
  setDepositLimit(p, 300, T0);
  assert.doesNotThrow(() => assertDepositAllowed(p, 100, 200, T0));
  assert.throws(() => assertDepositAllowed(p, 101, 200, T0), /daily deposit limit of 300 \(100 left/);
  selfExclude(p, 7, T0);
  assert.throws(() => assertDepositAllowed(p, 1, 0, T0), /excluded yourself/);
  assert.doesNotThrow(() => assertDepositAllowed(p, 1, 0, T0 + 7 * DAY_MS));
});

test('self-exclusion can be extended but never shortened, and only for the offered periods', () => {
  const p = {};
  selfExclude(p, 7, T0);
  const week = exclusionUntil(p, T0);
  selfExclude(p, 1, T0);
  assert.equal(exclusionUntil(p, T0), week);
  selfExclude(p, 30, T0);
  assert.ok(new Date(exclusionUntil(p, T0)) > new Date(week));
  assert.throws(() => selfExclude(p, 3, T0), /Choose/);
  assert.equal(exclusionUntil(p, T0 + 31 * DAY_MS), null);
});
