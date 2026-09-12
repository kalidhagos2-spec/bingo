import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentStore } from '../src/store.js';
import { RoomManager } from '../src/game/manager.js';
import { createSettings, validate, SCHEMA } from '../src/settings.js';
import { freshPool } from './helpers/pg.js';

function fakeConfig() {
  return {
    minTopup: 10,
    maxTopup: 5000,
    depositFeePercent: 2,
    minWithdraw: 50,
    maxWithdraw: 5000,
    withdrawFeePercent: 0,
    stakes: [0, 10, 20, 50],
    houseAccounts: { telebirr: { account: '0900000000', name: 'Telegram Bingo' }, cbebirr: { account: '', name: '' }, boa: { account: '', name: '' } },
    game: { minPlayers: 2, maxPlayers: 8, houseCutPercent: 2, freeBingoCoins: 50, countdownMs: 40000, callIntervalMs: 4000, restartDelayMs: 8000 },
  };
}

async function setup(t) {
  const { pool } = await freshPool(t);
  const store = new PaymentStore(pool, { depositFeePercent: 2, withdrawFeePercent: 0 });
  await store.load();
  const config = fakeConfig();
  const manager = new RoomManager({ emit() {}, emitTo() {}, rules: config.game, stakes: config.stakes });
  return { pool, store, config, manager, settings: createSettings({ config, store, manager }) };
}

test('validation rejects out-of-range, non-integer and inconsistent values', () => {
  const current = createSettings({ config: fakeConfig(), store: { settingsOverrides: () => ({}) } }).values();
  assert.throws(() => validate({ houseCutPercent: 80 }, current), /between 0 and 50/);
  assert.throws(() => validate({ minPlayers: 2.5 }, current), /whole number/);
  assert.throws(() => validate({ maxTopup: 5 }, current), /at least the minimum/);
  assert.throws(() => validate({ maxPlayers: 1 }, current), /between 2 and 50/);
  assert.throws(() => validate({ minPlayers: 9 }, current), /Seats per table/);
  assert.throws(() => validate({ stakes: 'a,b' }, current), /Stakes must be/);
  assert.throws(() => validate({ stakes: '0,-5' }, current), /Stakes must be/);
  assert.deepEqual(validate({ stakes: ' 50, 0,10,10 ', houseCutPercent: '2.5' }, current), { stakes: [0, 10, 50], houseCutPercent: 2.5 });
  assert.deepEqual(validate({ unknown: 1 }, current), {}); // unknown keys are ignored
  assert.equal(SCHEMA.length, 20);
  assert.deepEqual(validate({ boaAccount: ' 1000000000 ' }, current), { boaAccount: '1000000000' });
  assert.throws(() => validate({ boaName: 'x'.repeat(61) }, current), /at most 60/);
});

test('updates apply live to config, store fees, lobby stakes and existing rooms, and persist', async (t) => {
  const { pool, store, config, manager, settings } = await setup(t);
  const room = manager.joinStake({ id: 1, first_name: 'A' }, 10);
  assert.equal(room.rules.houseCutPercent, 2);

  const values = await settings.update({ houseCutPercent: 5, depositFeePercent: 3, withdrawFeePercent: 1, minTopup: 20, stakes: '0,25,100', callIntervalMs: 2000, maxPlayers: 12, boaAccount: '1000000000', boaName: 'TG Bingo PLC' });
  assert.equal(values.houseCutPercent, 5);
  assert.deepEqual(config.houseAccounts.boa, { account: '1000000000', name: 'TG Bingo PLC' });
  assert.equal(config.game.houseCutPercent, 5);
  assert.equal(config.minTopup, 20);
  assert.deepEqual(config.stakes, [0, 25, 100]);
  assert.deepEqual(manager.stakes, [0, 25, 100]);
  assert.equal(store.depositFeePercent, 3);
  assert.equal(store.withdrawFeePercent, 1);
  assert.equal(room.rules.houseCutPercent, 5); // live table picks the new fee up
  assert.equal(room.rules.callIntervalMs, 2000);
  assert.equal(room.rules.maxPlayers, 12);
  assert.equal(manager.list().map((l) => l.stake).join(','), '0,25,100');
  assert.deepEqual(settings.overrides(), { houseCutPercent: 5, depositFeePercent: 3, withdrawFeePercent: 1, minTopup: 20, stakes: [0, 25, 100], callIntervalMs: 2000, maxPlayers: 12, boaAccount: '1000000000', boaName: 'TG Bingo PLC' });

  // A second instance loading the same database starts with the overrides applied.
  const { rows } = await pool.query('SELECT overrides FROM settings WHERE id = 1');
  assert.equal(rows[0].overrides.houseCutPercent, 5);
  const store2 = new PaymentStore(pool, { depositFeePercent: 2 });
  await store2.load();
  const config2 = fakeConfig();
  createSettings({ config: config2, store: store2 });
  assert.equal(config2.game.houseCutPercent, 5);
  assert.equal(store2.depositFeePercent, 3);
  assert.deepEqual(config2.stakes, [0, 25, 100]);

  const back = await settings.reset();
  assert.equal(back.houseCutPercent, 2);
  assert.deepEqual(config.stakes, [0, 10, 20, 50]);
  assert.equal(store.depositFeePercent, 2);
  assert.deepEqual(settings.overrides(), {});
  await assert.rejects(() => settings.update({ maxWithdraw: 1 }), /at least the minimum/);
  for (const r of manager.rooms.values()) r.destroy();
});
