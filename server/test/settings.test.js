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
  assert.throws(() => validate({ maxPlayers: 1 }, current), /between 2 and 120/);
  assert.throws(() => validate({ minPlayers: 9 }, current), /Seats per table/);
  assert.throws(() => validate({ stakes: 'a,b' }, current), /Stakes must be/);
  assert.throws(() => validate({ stakes: '0,-5' }, current), /Stakes must be/);
  assert.deepEqual(validate({ stakes: ' 50, 0,10,10 ', houseCutPercent: '2.5' }, current), { stakes: [0, 10, 50], houseCutPercent: 2.5 });
  assert.deepEqual(validate({ unknown: 1 }, current), {}); // unknown keys are ignored
  assert.equal(SCHEMA.length, 24); // + maxPrize and the three demo-player settings
  assert.deepEqual(validate({ boaAccount: ' 1000000000 ' }, current), { boaAccount: '1000000000' });
  assert.throws(() => validate({ boaName: 'x'.repeat(61) }, current), /at most 60/);
  // House accounts: one number per slot, names must be names, numbers must be numbers.
  assert.deepEqual(validate({ telebirrAccount2: ' 0960524040 ', telebirrName2: 'Kalid' }, current), { telebirrAccount2: '0960524040', telebirrName2: 'Kalid' });
  assert.throws(() => validate({ telebirrName: '0937766034' }, current), /account holder's name .* not a number/);
  assert.throws(() => validate({ telebirrAccount: 'Aman' }, current), /one phone or account number/);
  assert.throws(() => validate({ telebirrAccount: '0937766034,0960524040' }, current), /one phone or account number/);
  assert.deepEqual(validate({ telebirrAccount2: '', telebirrName2: '' }, current), { telebirrAccount2: '', telebirrName2: '' }); // clearing a slot is fine
});

test('the two Telebirr slots map onto the comma-separated house account lists', async (t) => {
  const { config, settings } = await setup(t);
  await settings.update({ telebirrAccount: '0937766034', telebirrName: 'Aman', telebirrAccount2: '0960524040', telebirrName2: 'Kalid' });
  assert.deepEqual(config.houseAccounts.telebirr, { account: '0937766034,0960524040', name: 'Aman,Kalid' });
  assert.deepEqual([settings.values().telebirrAccount2, settings.values().telebirrName2], ['0960524040', 'Kalid']);
  await settings.update({ telebirrAccount2: '', telebirrName2: '' }); // drop the second slot
  assert.deepEqual(config.houseAccounts.telebirr, { account: '0937766034', name: 'Aman' });
  await settings.update({ telebirrAccount: '', telebirrName: '', telebirrAccount2: '0960524040', telebirrName2: 'Kalid' }); // only slot 2 filled
  assert.deepEqual(config.houseAccounts.telebirr, { account: ',0960524040', name: ',Kalid' });
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

test('demo players and the prize are operator settings, applied live and kept across restarts', async (t) => {
  const { store, config, settings } = await setup(t);
  config.game.maxPrize = 3000;
  assert.equal(settings.values().demoCount, '0'); // off until the operator turns it on

  const saved = await settings.update({ demoCount: ' 150 - 200 ', demoPerRoom: '50, 50=30-40', demoShare: '10=0.5,50=0.9', maxPrize: '5000', houseCutPercent: 25, maxPlayers: 55 });
  assert.deepEqual([saved.demoCount, saved.demoPerRoom, saved.demoShare], ['150-200', '50,50=30-40', '10=0.5,50=0.9']);
  assert.deepEqual(config.demoBots, { count: '150-200', perRoom: '50,50=30-40', share: '10=0.5,50=0.9' }); // what demoBots.js reads on its next beat
  assert.equal(config.game.maxPrize, 5000);
  assert.equal(config.game.houseCutPercent, 25);

  // a fresh process picks the overrides up again
  const config2 = fakeConfig();
  createSettings({ config: config2, store, manager: null });
  assert.equal(config2.demoBots.perRoom, '50,50=30-40');

  for (const [patch, pattern] of [
    [{ demoCount: '10=50' }, /one number or a range/],
    [{ demoCount: '900' }, /at most 600/],
    [{ demoPerRoom: 'fifty' }, /whole number or a range/],
    [{ demoPerRoom: '10=500' }, /at most 100/],
    [{ demoShare: '1' }, /between 0 and 0.95/],
    [{ demoShare: 'x=0.5' }, /table stake before the =/],
    [{ maxPrize: 5 }, /between 10 and/],
  ]) await assert.rejects(() => settings.update(patch), pattern);
  assert.equal(config.demoBots.count, '150-200'); // a refused change leaves everything as it was

  assert.equal((await settings.update({ demoCount: '' })).demoCount, '0'); // emptied = off
});
