import pg from 'pg';

/**
 * The bot shares a PostgreSQL database with the game server (see server/src/db/schema.sql)
 * but the two are separate npm packages with no shared code, so the bot keeps its own tiny
 * pool + migration for the one table it owns: `bot_users`. Both services' migrations are
 * `CREATE TABLE IF NOT EXISTS`, so it does not matter which of the two starts first.
 */

// node-postgres returns BIGINT (OID 20) as a string by default, to avoid silent precision
// loss. Telegram ids comfortably fit in a JS-safe integer and UserStore keys its in-memory
// Map by the numeric id, so this must be parsed to a Number — matching server/src/db/pool.js.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

/** Creates the connection pool. `connectionString` is `DATABASE_URL`. */
export function createPool(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL is required (see bot/.env.example)');
  // pg defaults to max: 10 silently. Made explicit and overridable via PGPOOL_MAX so it can
  // be tuned independently of the server's own pool -- the bot is much lighter-weight (one
  // table, one write per interaction), so a smaller default than the server's leaves more
  // of the database's total connection budget for the game server.
  const max = Number(process.env.PGPOOL_MAX) || 5;
  return new pg.Pool({ connectionString, max });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bot_users (
  id             BIGINT PRIMARY KEY,
  username       TEXT,
  first_name     TEXT,
  last_name      TEXT,
  language_code  TEXT,
  name           TEXT,
  phone          TEXT,
  email          TEXT,
  signup         JSONB,
  signed_up_at   TIMESTAMPTZ,
  registered_at  TIMESTAMPTZ NOT NULL,
  last_seen_at   TIMESTAMPTZ NOT NULL
);
`;

/** Applies the bot's one table. Idempotent, so this runs on every boot. */
export async function migrate(pool) {
  await pool.query(SCHEMA);
}
