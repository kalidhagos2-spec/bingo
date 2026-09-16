#!/usr/bin/env node
// One-off import: copies an existing server/data/payments.json (the old JSON-file
// PaymentStore) into PostgreSQL. Safe to re-run — every insert is ON CONFLICT DO NOTHING
// / DO UPDATE, so migrating twice just overwrites rows with the same data.
//
// Usage:
//   DATABASE_URL=postgresql://... node scripts/migrate-json-to-postgres.js [path/to/payments.json]

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool, migrate } from '../src/db/pool.js';

const file = resolve(process.cwd(), process.argv[2] ?? 'data/payments.json');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required (see server/.env.example)');
  process.exit(1);
}

const raw = await readFile(file, 'utf8').catch((err) => {
  if (err.code === 'ENOENT') {
    console.log(`Nothing to migrate: ${file} does not exist.`);
    process.exit(0);
  }
  throw err;
});
const data = JSON.parse(raw);

const pool = createPool(databaseUrl);
await migrate(pool);

let counts = { wallets: 0, profiles: 0, transactions: 0, rounds: 0, houseLedger: 0, announcements: 0 };

// ---------- wallets ----------
for (const [userId, w] of Object.entries(data.wallets ?? {})) {
  await pool.query(
    `INSERT INTO wallets (user_id, balance) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET balance = $2`,
    [Number(userId), w.balance ?? 0],
  );
  counts.wallets++;
}

// ---------- profiles ----------
for (const [userId, p] of Object.entries(data.profiles ?? {})) {
  await pool.query(
    `INSERT INTO profiles (user_id, name, phone, email, username, first_name, last_name, signed_up_at, updated_at, stats, economy, suspended)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (user_id) DO UPDATE SET
       name=$2, phone=$3, email=$4, username=$5, first_name=$6, last_name=$7,
       signed_up_at=$8, updated_at=$9, stats=$10, economy=$11, suspended=$12`,
    [
      Number(userId),
      p.name ?? null,
      p.phone ?? null,
      p.email ?? null,
      p.username ?? null,
      p.firstName ?? null,
      p.lastName ?? null,
      p.signedUpAt ?? null,
      p.updatedAt ?? null,
      JSON.stringify(p.stats ?? { games: 0, wins: 0, winnings: 0 }),
      p.economy ? JSON.stringify(p.economy) : null,
      p.suspended ? JSON.stringify(p.suspended) : null,
    ],
  );
  counts.profiles++;
}

// ---------- transactions ----------
for (const tx of data.transactions ?? []) {
  await pool.query(
    `INSERT INTO transactions (ref, user_id, type, method, account, amount, currency, status, note, checkout_url, provider_ref, fee, credited, payout, verified, reason, auto_check, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (ref) DO NOTHING`,
    [
      tx.ref,
      tx.userId,
      tx.type ?? 'topup',
      tx.method ?? null,
      tx.account ?? null,
      tx.amount,
      tx.currency,
      tx.status,
      tx.note ?? null,
      tx.checkoutUrl ?? null,
      tx.providerRef ?? null,
      tx.fee ?? null,
      tx.credited ?? null,
      tx.payout ?? null,
      tx.verified ?? null,
      tx.reason ?? null,
      tx.autoCheck ?? null,
      tx.createdAt,
      tx.updatedAt,
    ],
  );
  counts.transactions++;
}

// ---------- rounds ----------
for (const r of data.rounds ?? []) {
  await pool.query(
    `INSERT INTO rounds (at, room, round, stake, players, winner, prize, stakes, house_take, numbers_called, duration_ms, free_coins)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      r.at,
      r.room ?? null,
      r.round ?? null,
      r.stake ?? 0,
      JSON.stringify(r.players ?? []),
      r.winner ? JSON.stringify(r.winner) : null,
      r.prize ?? 0,
      r.stakes ?? 0,
      r.houseTake ?? 0,
      r.numbersCalled ?? null,
      r.durationMs ?? null,
      r.freeCoins ?? 0,
    ],
  );
  counts.rounds++;
}

// ---------- house ledger + running balance ----------
const house = data.house ?? { balance: 0, entries: [] };
for (const e of house.entries ?? []) {
  await pool.query(
    `INSERT INTO house_ledger (at, type, user_id, ref, room, round, stake, players, stakes, prize, fee, method, amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      e.at,
      e.type,
      e.userId ?? null,
      e.ref ?? null,
      e.room ?? null,
      e.round ?? null,
      e.stake ?? null,
      e.players ?? null,
      e.stakes ?? null,
      e.prize ?? null,
      e.fee ?? 0,
      e.method ?? null,
      e.amount ?? null,
    ],
  );
  counts.houseLedger++;
}
await pool.query('UPDATE house_balance SET balance = $1 WHERE id = 1', [house.balance ?? 0]);

// ---------- settings overrides ----------
if (data.settings && Object.keys(data.settings).length) {
  await pool.query('UPDATE settings SET overrides = $1 WHERE id = 1', [JSON.stringify(data.settings)]);
}

// ---------- announcements ----------
for (const a of data.announcements ?? []) {
  await pool.query(
    `INSERT INTO announcements (id, text, level, created_at, expires_at, active, removed_at, by, telegram)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO NOTHING`,
    [a.id, a.text, a.level, a.createdAt, a.expiresAt ?? null, a.active ?? true, a.removedAt ?? null, a.by ?? null, a.telegram ? JSON.stringify(a.telegram) : null],
  );
  counts.announcements++;
}

// Old JSON files may still hold email-login data (loginCodes, emailAccounts, sessions);
// that feature is gone, so those keys are intentionally not migrated.

console.log(`Migrated ${file} -> ${databaseUrl.replace(/:[^:@]*@/, ':***@')}`);
console.table(counts);
await pool.end();
