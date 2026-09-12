import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { migrate } from '../../src/db/pool.js';

// Same NUMERIC/BIGINT parsing as the real pool (src/db/pool.js); importing that module
// above already registers it process-wide, so nothing to duplicate here.

const BASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tgbingo_test';

/**
 * A fresh, isolated Postgres schema for one test — the Postgres analogue of the old
 * JSON store's fresh temp file. Every table (wallets, transactions, ...) is created
 * inside a private `search_path` schema so tests never see each other's rows, even when
 * node's test runner executes files (or `test()` blocks) concurrently.
 *
 * `max: 1` keeps the whole pool pinned to one physical connection, which is what makes
 * `SET search_path` reliable — a bigger pool could hand a later query to a different
 * connection that never had the search_path set.
 *
 * Pass the test's `t` (TestContext) and cleanup (drop the schema, close the pool) is
 * registered automatically via `t.after`.
 */
export async function freshPool(t) {
  const schema = `test_${randomBytes(8).toString('hex')}`;
  const pool = new pg.Pool({ connectionString: BASE_URL, max: 1 });
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await pool.query(`SET search_path TO "${schema}"`);
  await migrate(pool);
  const close = async () => {
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => {});
    await pool.end();
  };
  if (t?.after) t.after(close);
  return { pool, schema, close };
}
