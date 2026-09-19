import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { profileRouter } from '../src/routes/profile.js';

/** The endpoint behind the bot's /balance, /deposit, /withdraw and /rules. */
async function serve(t, config) {
  const store = { balance: (id) => (id === 42 ? 135.5 : 0), leaderboard: () => [] };
  const app = express();
  app.use('/api/profile', profileRouter({ config, store, auth: (_req, res) => res.status(401).json({ error: 'unauthorized' }) }));
  const server = app.listen(0);
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}/api/profile/bot`;
}

const config = {
  botToken: 'secret-token',
  devAllowAnon: false,
  currency: 'ETB',
  minTopup: 10,
  maxTopup: 5000,
  depositFeePercent: 0,
  minWithdraw: 50,
  maxWithdraw: 5000,
  withdrawFeePercent: 2,
  stakes: [10, 20, 50],
  game: { maxCartelas: 4, cartelaCount: 400, maxPrize: 3000, countdownMs: 40000 },
  transfer: { telebirr: { account: '0937766034,0960524040', name: 'Aman,Amanuel' } },
};

test('the bot reads a player balance and the live deposit/cash-out settings with its token only', async (t) => {
  const url = await serve(t, config);
  assert.equal((await fetch(`${url}/42`)).status, 401);
  assert.equal((await fetch(`${url}/42`, { headers: { 'x-bot-token': 'wrong' } })).status, 401);
  assert.equal((await fetch(`${url}/abc`, { headers: { 'x-bot-token': 'secret-token' } })).status, 400);

  const info = await (await fetch(`${url}/42`, { headers: { 'x-bot-token': 'secret-token' } })).json();
  assert.equal(info.balance, 135.5);
  assert.deepEqual(info.withdraw, { min: 50, max: 5000, feePercent: 2 });
  assert.equal(info.deposit.feePercent, 0);
  assert.ok(Array.isArray(info.deposit.accounts));
  assert.deepEqual(info.game, { stakes: [10, 20, 50], maxCartelas: 4, cartelaCount: 400, maxPrize: 3000, countdownMs: 40000 });
});
