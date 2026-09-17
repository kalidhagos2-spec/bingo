/**
 * Operator-editable settings. Env values are the defaults; overrides are persisted in the
 * store (`data.settings`) and applied in place to the live config, room rules, lobby
 * stakes and store fee rates, so a change takes effect without a restart.
 */

export const SCHEMA = Object.freeze([
  { key: 'houseCutPercent', group: 'Fees', label: 'House cut of every stake (%)', min: 0, max: 50, step: 0.5, scope: 'game' },
  { key: 'depositFeePercent', group: 'Fees', label: 'Deposit (top-up) fee (%)', min: 0, max: 20, step: 0.5, scope: 'root' },
  { key: 'withdrawFeePercent', group: 'Fees', label: 'Cash-out fee (%)', min: 0, max: 20, step: 0.5, scope: 'root' },
  { key: 'minTopup', group: 'Limits', label: 'Minimum top-up (ETB)', min: 1, max: 1_000_000, step: 1, scope: 'root' },
  { key: 'maxTopup', group: 'Limits', label: 'Maximum top-up (ETB)', min: 1, max: 1_000_000, step: 1, scope: 'root' },
  { key: 'minWithdraw', group: 'Limits', label: 'Minimum cash-out (ETB)', min: 1, max: 1_000_000, step: 1, scope: 'root' },
  { key: 'maxWithdraw', group: 'Limits', label: 'Maximum cash-out (ETB)', min: 1, max: 1_000_000, step: 1, scope: 'root' },
  { key: 'stakes', group: 'Tables', label: 'Public tables by stake (ETB, comma separated, 0 = free)', scope: 'stakes' },
  { key: 'freeBingoCoins', group: 'Tables', label: 'Coins paid to a Free Bingo winner', min: 0, max: 10_000, step: 1, scope: 'game' },
  { key: 'minPlayers', group: 'Tables', label: 'Players needed to start a round', min: 2, max: 50, step: 1, scope: 'game' },
  { key: 'maxPlayers', group: 'Tables', label: 'Seats per table', min: 2, max: 50, step: 1, scope: 'game' },
  { key: 'countdownMs', group: 'Pacing', label: 'Cartela pick time (ms)', min: 10_000, max: 300_000, step: 1000, scope: 'game' },
  { key: 'callIntervalMs', group: 'Pacing', label: 'Seconds between calls (ms)', min: 1000, max: 30_000, step: 500, scope: 'game' },
  { key: 'restartDelayMs', group: 'Pacing', label: 'Pause before registration re-opens (ms)', min: 3000, max: 60_000, step: 1000, scope: 'game' },
  // Each house-account slot edits one entry of the comma-separated HOUSE_*_ACCOUNT / _NAME lists.
  { key: 'telebirrAccount', group: 'House accounts', label: 'Telebirr account 1 — phone number players transfer to', scope: 'account', method: 'telebirr', field: 'account', index: 0 },
  { key: 'telebirrName', group: 'House accounts', label: 'Telebirr account 1 — account holder name', scope: 'account', method: 'telebirr', field: 'name', index: 0 },
  { key: 'telebirrAccount2', group: 'House accounts', label: 'Telebirr account 2 — phone number (empty = only one account)', scope: 'account', method: 'telebirr', field: 'account', index: 1 },
  { key: 'telebirrName2', group: 'House accounts', label: 'Telebirr account 2 — account holder name', scope: 'account', method: 'telebirr', field: 'name', index: 1 },
  { key: 'boaAccount', group: 'House accounts', label: 'Bank of Abyssinia account number (empty = not offered)', scope: 'account', method: 'boa', field: 'account', index: 0 },
  { key: 'boaName', group: 'House accounts', label: 'Bank of Abyssinia account holder name', scope: 'account', method: 'boa', field: 'name', index: 0 },
]);

const num = (v) => (typeof v === 'string' ? Number(v.trim()) : Number(v));
/** Splits a comma-separated house-account list into its slots. */
const slots = (text) => String(text ?? '').split(',').map((s) => s.trim());

/** Validates a partial patch against the schema; returns the normalised values or throws. */
export function validate(patch, current) {
  const next = {};
  for (const field of SCHEMA) {
    if (!(field.key in patch)) continue;
    const raw = patch[field.key];
    if (field.scope === 'account') {
      const text = String(raw ?? '').trim();
      if (text.length > 60) throw new Error(`${field.label} must be at most 60 characters`);
      // A number typed into a name field is the classic mix-up: the deposit card would then show the number twice.
      const short = field.label.split(' (')[0];
      if (field.field === 'name' && text && /^[\d\s,+.-]+$/.test(text)) throw new Error(`${short}: enter the account holder's name (e.g. Aman), not a number`);
      if (field.field === 'account' && text && !/^\+?\d{6,15}$/.test(text)) throw new Error(`${short}: enter one phone or account number, digits only`);
      next[field.key] = text;
      continue;
    }
    if (field.scope === 'stakes') {
      const list = Array.isArray(raw) ? raw : String(raw).split(',');
      const stakes = [...new Set(list.map((s) => num(s)).filter((n) => !Number.isNaN(n)))];
      if (stakes.length === 0 || stakes.length > 8 || stakes.some((n) => !Number.isInteger(n) || n < 0)) {
        throw new Error('Stakes must be 1–8 whole ETB amounts (0 = free), e.g. 0,10,20,50');
      }
      next.stakes = stakes.sort((a, b) => a - b);
      continue;
    }
    const value = num(raw);
    if (!Number.isFinite(value) || value < field.min || value > field.max) throw new Error(`${field.label} must be between ${field.min} and ${field.max}`);
    if (field.step >= 1 && !Number.isInteger(value)) throw new Error(`${field.label} must be a whole number`);
    next[field.key] = value;
  }
  const merged = { ...current, ...next };
  if (merged.maxTopup < merged.minTopup) throw new Error('Maximum top-up must be at least the minimum');
  if (merged.maxWithdraw < merged.minWithdraw) throw new Error('Maximum cash-out must be at least the minimum');
  if (merged.maxPlayers < merged.minPlayers) throw new Error('Seats per table must be at least the players needed to start');
  return next;
}

export function createSettings({ config, store, manager = null }) {
  const defaults = snapshot(config);

  function snapshot(c) {
    const out = {};
    for (const f of SCHEMA) {
      if (f.scope === 'game') out[f.key] = c.game[f.key];
      else if (f.scope === 'stakes') out[f.key] = [...c.stakes];
      else if (f.scope === 'account') out[f.key] = slots(c.houseAccounts?.[f.method]?.[f.field])[f.index ?? 0] ?? '';
      else out[f.key] = c[f.key];
    }
    return out;
  }

  /** Writes one slot of a comma-separated house-account list (trailing empty slots are dropped). */
  function setSlot(method, field, index, value) {
    const rail = ((config.houseAccounts ??= {})[method] ??= {});
    const list = slots(rail[field]);
    while (list.length <= index) list.push('');
    list[index] = value;
    while (list.length && !list[list.length - 1]) list.pop();
    rail[field] = list.join(',');
  }

  /** Pushes values into the live objects everyone reads from. */
  function apply(values) {
    for (const f of SCHEMA) {
      if (!(f.key in values)) continue;
      if (f.scope === 'game') config.game[f.key] = values[f.key];
      else if (f.scope === 'root') config[f.key] = values[f.key];
      else if (f.scope === 'account') setSlot(f.method, f.field, f.index ?? 0, values[f.key]);
    }
    if (values.stakes) config.stakes.splice(0, config.stakes.length, ...values.stakes);
    if (manager) {
      if (values.stakes) manager.stakes.splice(0, manager.stakes.length, ...values.stakes);
      for (const room of manager.rooms.values()) {
        for (const f of SCHEMA) if (f.scope === 'game' && f.key in values) room.rules[f.key] = values[f.key];
        room.rules.cartelaCount = Math.max(room.rules.cartelaCount, room.rules.maxPlayers);
      }
    }
    if ('depositFeePercent' in values) store.depositFeePercent = values.depositFeePercent;
    if ('withdrawFeePercent' in values) store.withdrawFeePercent = values.withdrawFeePercent;
  }

  // Overrides saved by the operator win over the env defaults at start-up.
  const saved = store.settingsOverrides();
  apply(saved);

  return {
    schema: SCHEMA,
    defaults,
    /** Effective values right now. */
    values: () => snapshot(config),
    overrides: () => store.settingsOverrides(),
    async update(patch) {
      const next = validate(patch, snapshot(config));
      // Only values that differ from the .env defaults are kept as overrides, so setting a
      // field back to its default forgets the override instead of pinning it.
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const kept = { ...store.settingsOverrides() };
      for (const [key, value] of Object.entries(next)) {
        if (same(value, defaults[key])) delete kept[key];
        else kept[key] = value;
      }
      await store.setSettings(kept);
      apply(next);
      return snapshot(config);
    },
    /** Drops every override and returns to the env defaults. */
    async reset() {
      await store.resetSettings();
      apply(defaults);
      return snapshot(config);
    },
  };
}
