import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// node-postgres returns NUMERIC as a string by default (it can't tell how much
// precision you need). This app treats money as plain JS numbers rounded to cents
// everywhere else, so parse NUMERIC (OID 1700) the same way — this is a storage
// migration, not a precision upgrade, and every call site already does its own
// `Math.round(n * 100) / 100`.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// BIGINT (OID 20) -> Number. Telegram ids and our own ids comfortably fit in a
// JS-safe integer, and the rest of the codebase treats every id as a plain number.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

/** Creates the connection pool. `connectionString` is `DATABASE_URL`. */
export function createPool(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is required (see server/.env.example)');
  // pg defaults to max: 10 silently. Made explicit and overridable via PGPOOL_MAX so it can
  // be tuned to the deployment's actual traffic and the database's own connection limit
  // (managed Postgres providers often cap total connections in the 20-100 range, shared
  // with the bot's own pool) instead of relying on an implicit default.
  const max = Number(process.env.PGPOOL_MAX) || 10;
  return new pg.Pool({ connectionString, max });
}

/** Applies schema.sql. Every statement is idempotent, so this runs on every boot. */
export async function migrate(pool) {
  const sql = await readFile(resolve(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

/** Runs `fn(client)` inside a transaction: commits on success, rolls back on throw. */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
