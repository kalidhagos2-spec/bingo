import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { PaymentStore } from '../src/store.js';
import { adminRouter } from '../src/routes/admin.js';
import { freshPool } from './helpers/pg.js';

async function serve(t) {
  const { pool } = await freshPool(t);
  const store = new PaymentStore(pool);
  await store.load();
  await store.setProfile(42, { name: 'Sara' });
  store.adjust(42, 100, 'seed');
  const pushed = [];
  const app = express();
  app.use('/api/admin', adminRouter({ config: { adminToken: 'op-secret', currency: 'ETB' }, store, notifyBalance: (id, balance) => pushed.push([id, balance]) }));
  const server = app.listen(0);
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/admin/players`;
  const post = (id, body, token = 'op-secret') =>
    fetch(`${url}/${id}/adjust`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': token }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
  return { store, pool, post, pushed };
}

test('the operator can credit and debit a wallet, with a reason, and it is all on the record', async (t) => {
  const { store, pool, post, pushed } = await serve(t);

  assert.equal((await post(42, { amount: 30, reason: 'Refund' }, 'wrong'))[0], 401);

  const [status, credit] = await post(42, { amount: '30', reason: 'Refund for room FC8S (server restart)' });
  assert.equal(status, 200);
  assert.equal(credit.balance, 130);
  assert.equal(store.balance(42), 130);
  assert.deepEqual(pushed.at(-1), [42, 130]); // the player's open app updates at once

  const [, debit] = await post(42, { amount: -10.5, reason: 'Credited twice by mistake' });
  assert.equal(debit.balance, 119.5);

  await store.flush();
  const { rows } = await pool.query(`SELECT type, method, amount, status, note FROM transactions WHERE user_id = 42 AND type = 'adjustment' ORDER BY created_at`);
  assert.deepEqual(rows.map((r) => [r.method, r.amount, r.status, r.note]), [
    ['admin', 30, 'paid', 'Operator adjustment: Refund for room FC8S (server restart)'],
    ['admin', -10.5, 'paid', 'Operator adjustment: Credited twice by mistake'],
  ]);
  const wallet = await pool.query('SELECT balance FROM wallets WHERE user_id = 42');
  assert.equal(wallet.rows[0].balance, 119.5);
  const audit = await pool.query(`SELECT user_id, amount, fee FROM house_ledger WHERE type = 'adjustment' ORDER BY id`);
  assert.deepEqual(audit.rows.map((r) => [r.user_id, r.amount, r.fee]), [[42, 30, 0], [42, -10.5, 0]]);
  const house = await pool.query('SELECT balance FROM house_balance');
  assert.equal(house.rows[0].balance, 0); // the fee balance is not touched
});

test('adjustments are refused when they make no sense', async (t) => {
  const { store, post } = await serve(t);
  const refused = async (id, body, pattern) => {
    const [status, data] = await post(id, body);
    assert.ok(status === 400 || status === 404, `${status}`);
    assert.match(data.error, pattern);
  };
  await refused(42, { amount: -500, reason: 'Clawback' }, /holds only 100/); // never below zero
  await refused(42, { amount: 0, reason: 'Nothing' }, /other than 0/);
  await refused(42, { amount: 'abc', reason: 'Typo' }, /other than 0/);
  await refused(42, { amount: 25 }, /reason is required/);
  await refused(42, { amount: 60000, reason: 'Slipped zero' }, /limited to 50000/);
  await refused(7, { amount: 25, reason: 'Unknown id' }, /No player with id 7/);
  await refused(-1001, { amount: 25, reason: 'Demo' }, /demo players/);
  assert.equal(store.balance(42), 100);
});
