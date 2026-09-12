/**
 * Coin economy: daily bonus, missions and shop. Pure functions over `profile.economy`
 * so the rules are unit-testable; the store persists the mutated profile.
 * Coins are a soft currency (earned by playing) and never convert to the ETB wallet.
 */

export const BONUS_SCHEDULE = Object.freeze([50, 75, 100, 125, 150, 200, 300]); // by streak day, capped at the last
export const DAY_MS = 86_400_000;

export const MISSIONS = Object.freeze([
  { id: 'play3', title: 'Play 3 rounds', key: 'games', goal: 3, reward: 100, icon: '🎱' },
  { id: 'win1', title: 'Win a round', key: 'wins', goal: 1, reward: 150, icon: '🏆' },
  { id: 'mark50', title: 'Mark 50 numbers', key: 'marks', goal: 50, reward: 80, icon: '✅' },
  { id: 'paid1', title: 'Play a paid table', key: 'paid', goal: 1, reward: 120, icon: '💵' },
  { id: 'bonus', title: 'Claim the daily bonus', key: 'bonus', goal: 1, reward: 30, icon: '🎁' },
]);

export const THEMES = Object.freeze(['classic', 'emerald', 'sunset', 'neon', 'gold']);

export const SHOP = Object.freeze([
  { id: 'theme_emerald', kind: 'theme', theme: 'emerald', title: 'Emerald cartela', desc: 'Green & gold card skin', price: 500, icon: '💚' },
  { id: 'theme_sunset', kind: 'theme', theme: 'sunset', title: 'Sunset cartela', desc: 'Orange & pink card skin', price: 800, icon: '🌅' },
  { id: 'theme_neon', kind: 'theme', theme: 'neon', title: 'Neon cartela', desc: 'Cyan & magenta card skin', price: 1200, icon: '💜' },
  { id: 'theme_gold', kind: 'theme', theme: 'gold', title: 'Gold cartela', desc: 'The VIP look', price: 2500, icon: '👑' },
  { id: 'shield', kind: 'consumable', title: 'Streak shield', desc: 'Keeps your daily streak if you miss one day', price: 300, icon: '🛡️' },
  { id: 'doubler', kind: 'consumable', title: 'Bonus doubler', desc: 'Doubles your next daily bonus', price: 400, icon: '✨' },
]);

export const dayKey = (now) => new Date(now).toISOString().slice(0, 10);
const nextMidnight = (now) => new Date(Math.floor(now / DAY_MS) * DAY_MS + DAY_MS).toISOString();

export function defaultEconomy() {
  return {
    coins: 0,
    bonus: { lastClaimDay: null, streak: 0, claims: 0 },
    missions: { day: null, progress: {}, claimed: [] },
    items: { shield: 0, doubler: 0 },
    themes: { owned: ['classic'], selected: 'classic' },
    coinLog: [],
  };
}

/** Returns profile.economy, creating it and rolling missions over to today when needed. */
export function ensureEconomy(profile, now = Date.now()) {
  const eco = (profile.economy ??= defaultEconomy());
  const today = dayKey(now);
  if (eco.missions.day !== today) eco.missions = { day: today, progress: {}, claimed: [] };
  return eco;
}

export function addCoins(profile, delta, note, now = Date.now()) {
  const eco = ensureEconomy(profile, now);
  const next = eco.coins + delta;
  if (next < 0) throw new Error(`Not enough coins: you need ${-delta}, you have ${eco.coins}`);
  eco.coins = next;
  eco.coinLog.unshift({ at: new Date(now).toISOString(), delta, note });
  eco.coinLog.length = Math.min(eco.coinLog.length, 30);
  return eco.coins;
}

/** Advances a mission counter (games, wins, marks, paid, bonus). */
export function track(profile, key, n = 1, now = Date.now()) {
  const eco = ensureEconomy(profile, now);
  eco.missions.progress[key] = (eco.missions.progress[key] ?? 0) + n;
  return eco.missions.progress[key];
}

// ---------- daily bonus ----------

function projectedStreak(eco, now) {
  const last = eco.bonus.lastClaimDay;
  if (!last) return { streak: 1, usesShield: false };
  if (last === dayKey(now - DAY_MS)) return { streak: eco.bonus.streak + 1, usesShield: false };
  if (eco.items.shield > 0 && last === dayKey(now - 2 * DAY_MS)) return { streak: eco.bonus.streak + 1, usesShield: true };
  return { streak: 1, usesShield: false };
}

export function bonusStatus(profile, now = Date.now()) {
  const eco = ensureEconomy(profile, now);
  const claimedToday = eco.bonus.lastClaimDay === dayKey(now);
  const { streak, usesShield } = claimedToday ? { streak: eco.bonus.streak, usesShield: false } : projectedStreak(eco, now);
  const base = BONUS_SCHEDULE[Math.min(streak, BONUS_SCHEDULE.length) - 1];
  return {
    claimable: !claimedToday,
    streak,
    reward: claimedToday ? null : base * (eco.items.doubler > 0 ? 2 : 1),
    doubled: !claimedToday && eco.items.doubler > 0,
    usesShield,
    schedule: BONUS_SCHEDULE,
    nextAt: nextMidnight(now),
    lastClaimDay: eco.bonus.lastClaimDay,
  };
}

export function claimBonus(profile, now = Date.now()) {
  const eco = ensureEconomy(profile, now);
  const status = bonusStatus(profile, now);
  if (!status.claimable) throw new Error('Daily bonus already claimed. Come back tomorrow!');
  if (status.usesShield) eco.items.shield -= 1;
  if (status.doubled) eco.items.doubler -= 1;
  eco.bonus = { lastClaimDay: dayKey(now), streak: status.streak, claims: (eco.bonus.claims ?? 0) + 1 };
  addCoins(profile, status.reward, `Daily bonus · day ${status.streak}`, now);
  track(profile, 'bonus', 1, now);
  return { reward: status.reward, streak: status.streak, coins: eco.coins };
}

// ---------- missions ----------

export function missionsView(profile, now = Date.now()) {
  const eco = ensureEconomy(profile, now);
  return MISSIONS.map((m) => {
    const progress = Math.min(eco.missions.progress[m.key] ?? 0, m.goal);
    const claimed = eco.missions.claimed.includes(m.id);
    return { ...m, progress, done: progress >= m.goal, claimed, claimable: progress >= m.goal && !claimed };
  });
}

export function claimMission(profile, id, now = Date.now()) {
  const eco = ensureEconomy(profile, now);
  const mission = missionsView(profile, now).find((m) => m.id === id);
  if (!mission) throw new Error('Unknown mission');
  if (mission.claimed) throw new Error('Mission reward already claimed');
  if (!mission.done) throw new Error(`Not finished yet: ${mission.progress}/${mission.goal}`);
  eco.missions.claimed.push(id);
  addCoins(profile, mission.reward, `Mission · ${mission.title}`, now);
  return { reward: mission.reward, coins: eco.coins };
}

// ---------- shop ----------

export function shopView(profile, now = Date.now()) {
  const eco = ensureEconomy(profile, now);
  return {
    coins: eco.coins,
    selectedTheme: eco.themes.selected,
    items: SHOP.map((item) =>
      item.kind === 'theme'
        ? { ...item, owned: eco.themes.owned.includes(item.theme), selected: eco.themes.selected === item.theme }
        : { ...item, quantity: eco.items[item.id] ?? 0 },
    ),
  };
}

export function buy(profile, id, now = Date.now()) {
  const eco = ensureEconomy(profile, now);
  const item = SHOP.find((i) => i.id === id);
  if (!item) throw new Error('Unknown item');
  if (item.kind === 'theme' && eco.themes.owned.includes(item.theme)) throw new Error('You already own this skin');
  addCoins(profile, -item.price, `Shop · ${item.title}`, now);
  if (item.kind === 'theme') {
    eco.themes.owned.push(item.theme);
    eco.themes.selected = item.theme;
  } else {
    eco.items[item.id] = (eco.items[item.id] ?? 0) + 1;
  }
  return { item, coins: eco.coins };
}

export function selectTheme(profile, theme, now = Date.now()) {
  const eco = ensureEconomy(profile, now);
  if (!THEMES.includes(theme)) throw new Error('Unknown skin');
  if (!eco.themes.owned.includes(theme)) throw new Error('You do not own this skin');
  eco.themes.selected = theme;
  return theme;
}

/** Everything the lobby, missions and shop screens need in one call. */
export function economyView(profile, now = Date.now()) {
  const eco = ensureEconomy(profile, now);
  return {
    coins: eco.coins,
    theme: eco.themes.selected,
    bonus: bonusStatus(profile, now),
    missions: missionsView(profile, now),
    shop: shopView(profile, now),
    items: eco.items,
    coinLog: eco.coinLog,
  };
}
