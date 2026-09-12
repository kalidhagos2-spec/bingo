#!/usr/bin/env node
// One-off import: copies an existing bot/data/users.json (the old JSON-file UserStore)
// into PostgreSQL. Safe to re-run — the insert is an upsert.
//
// Usage:
//   DATABASE_URL=postgresql://... node scripts/migrate-json-to-postgres.js [path/to/users.json]

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPool, migrate } from '../src/db/pool.js';

const file = resolve(process.cwd(), process.argv[2] ?? 'data/users.json');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required (see bot/.env.example)');
  process.exit(1);
}

const raw = await readFile(file, 'utf8').catch((err) => {
  if (err.code === 'ENOENT') {
    console.log(`Nothing to migrate: ${file} does not exist.`);
    process.exit(0);
  }
  throw err;
});
const users = JSON.parse(raw);

const pool = createPool(databaseUrl);
await migrate(pool);

let n = 0;
for (const u of users) {
  await pool.query(
    `INSERT INTO bot_users (id, username, first_name, last_name, language_code, name, phone, email, signup, signed_up_at, registered_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       username=$2, first_name=$3, last_name=$4, language_code=$5, name=$6, phone=$7,
       email=$8, signup=$9, signed_up_at=$10, registered_at=$11, last_seen_at=$12`,
    [
      u.id,
      u.username ?? null,
      u.firstName ?? null,
      u.lastName ?? null,
      u.languageCode ?? null,
      u.name ?? null,
      u.phone ?? null,
      u.email ?? null,
      u.signup ? JSON.stringify(u.signup) : null,
      u.signedUpAt ?? null,
      u.registeredAt,
      u.lastSeenAt,
    ],
  );
  n++;
}

console.log(`Migrated ${n} user(s) from ${file} -> ${databaseUrl.replace(/:[^:@]*@/, ':***@')}`);
await pool.end();
