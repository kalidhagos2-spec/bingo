import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PaymentStore } from '../src/store.js';
import { bonusStatus, claimBonus, missionsView, claimMission, track, buy, selectTheme, shopView, economyView, addCoins, BONUS_SCHEDULE, DAY_MS } from '../src/economy.js';
import { freshPool } from './helpers/pg.js';

const T0 = Date.UTC(2026, 8, 8, 10, 0, 0); // 2026-09-08 10:00Z

test('daily bonus: once per UTC day, streak grows day by day and resets after a gap', () => {
  const profile = {};
  let s = bonusStatus(profile, T0);
  assert.equal(s.claimable, true);
  assert.equal(s.streak, 1);
  assert.equal(s.reward, BONUS_SCHEDULE[0]);
  assert.equal(s.nextAt, '2026-09-09T00:00:00.000Z');

  assert.deepEqual(claimBonus(profile, T0), { reward: 50, streak: 1, coins: 50 });
  assert.throws(() => claimBonus(profile, T0 + 3600_000), /already claimed/);
  s = bonusStatus(profile, T0 + 3600_000);
  assert.equal(s.claimable, false);
  assert.equal(s.reward, null);

  assert.equal(claimBonus(profile, T0 + DAY_MS).reward, 75); // day 2
  assert.equal(claimBonus(profile, T0 + 2 * DAY_MS).streak, 3);
  assert.equal(claimBonus(profile, T0 + 4 * DAY_MS).streak, 1); // missed day 4 -> reset
  for (let d = 5; d <= 12; d++) claimBonus(profile, T0 + d * DAY_MS);
  assert.equal(profile.economy.missions.progress.bonus, 1); // tracked on the day of the claim
  assert.equal(bonusStatus(profile, T0 + 13 * DAY_MS).reward, BONUS_SCHEDULE.at(-1)); // capped
});

test('the shop no longer sells daily-bonus boosters', () => {
  const profile = {};
  addCoins(profile, 1000, 'test', T0);
  assert.throws(() => buy(profile, 'shield', T0), /Unknown item/);
  assert.throws(() => buy(profile, 'doubler', T0), /Unknown item/);
  assert.equal(shopView(profile, T0).items.some((i) => i.kind === 'consumable'), false);
});

test('missions track game events, reset daily and pay out once', () => {
  const profile = {};
  track(profile, 'games', 1, T0);
  track(profile, 'games', 1, T0);
  let view = missionsView(profile, T0);
  const play3 = view.find((m) => m.id === 'play3');
  assert.equal(play3.progress, 2);
  assert.equal(play3.claimable, false);
  assert.throws(() => claimMission(profile, 'play3', T0), /Not finished yet: 2\/3/);
  track(profile, 'games', 5, T0);
  view = missionsView(profile, T0);
  assert.equal(view.find((m) => m.id === 'play3').progress, 3); // capped at the goal
  assert.equal(claimMission(profile, 'play3', T0).reward, 100);
  assert.throws(() => claimMission(profile, 'play3', T0), /already claimed/);
  assert.throws(() => claimMission(profile, 'nope', T0), /Unknown mission/);
  assert.equal(missionsView(profile, T0 + DAY_MS).find((m) => m.id === 'play3').progress, 0); // new day
  assert.equal(profile.economy.coins, 100);
});

test('shop: skins are bought once and selectable, no overdraft', () => {
  const profile = {};
  assert.throws(() => buy(profile, 'theme_emerald', T0), /Not enough coins/);
  addCoins(profile, 1500, 'test', T0);
  const { item, coins } = buy(profile, 'theme_emerald', T0);
  assert.equal(item.theme, 'emerald');
  assert.equal(coins, 1000);
  assert.equal(profile.economy.themes.selected, 'emerald');
  assert.throws(() => buy(profile, 'theme_emerald', T0), /already own/);
  assert.throws(() => selectTheme(profile, 'gold', T0), /do not own/);
  assert.throws(() => selectTheme(profile, 'plaid', T0), /Unknown skin/);
  selectTheme(profile, 'classic', T0);
  const shop = shopView(profile, T0);
  assert.equal(shop.selectedTheme, 'classic');
  assert.equal(shop.items.find((i) => i.id === 'theme_emerald').owned, true);
  assert.equal(economyView(profile, T0).coinLog[0].note, 'Shop · Emerald cartela');
});

test('store: free bingo wins pay coins and rounds feed the missions', async (t) => {
  const { pool } = await freshPool(t);
  const store = new PaymentStore(pool);
  await store.load();
  store.recordRound({ participants: [1, 2], winnerId: 1, prize: 0, stake: 0, freeCoins: 50, now: T0 });
  store.recordRound({ participants: [1, 2], winnerId: 2, prize: 19.6, stake: 10, stakes: 20, houseTake: 0.4, room: 'R1', round: 1, freeCoins: 50, now: T0 });
  assert.equal(store.coins(1), 50);
  await store.flush(); // rounds + house ledger are written in the background
  assert.equal((await store.house()).balance, 0.4);
  assert.equal((await store.house()).entries[0].fee, 0.4);
  const history = await store.gameHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].room, 'R1'); // newest first
  assert.equal(history[0].houseTake, 0.4);
  assert.equal(history[1].freeCoins, 50);
  assert.deepEqual(history[1].players.map((p) => p.id), [1, 2]);
  assert.equal((await store.gameHistory('r1')).length, 1);
  assert.equal((await store.gameHistory('2')).length, 2); // player id 2 played both
  assert.equal((await store.gameHistory('zzz')).length, 0);
  assert.equal(store.coins(2), 0); // paid tables pay ETB, not coins
  const m1 = Object.fromEntries(missionsView(store.profile(1), T0).map((m) => [m.id, m.progress]));
  assert.deepEqual(m1, { play3: 2, win1: 1, mark50: 0, paid1: 1 });
  store.trackMission(1, 'marks', 7, T0);
  assert.equal(missionsView(store.profile(1), T0).find((m) => m.id === 'mark50').progress, 7);
  const r = await store.updateProfile(1, (p) => claimMission(p, 'win1', T0));
  assert.equal(r.coins, 200);
  assert.equal(store.coins(1), 200);
});
