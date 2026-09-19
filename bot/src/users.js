/**
 * PostgreSQL-backed user store keyed by Telegram ID (table `bot_users`, shared schema
 * with the game server — see server/src/db/schema.sql).
 *
 * `has`/`get` stay synchronous, backed by an in-memory Map loaded once at `load()`: the
 * sign-up flow (bot/src/signup.js) reads the current user mid-conversation without
 * awaiting a query. Every write goes to Postgres immediately and updates the cache.
 */
export class UserStore {
  constructor(pool) {
    this.pool = pool;
    this.users = new Map();
  }

  async load() {
    const { rows } = await this.pool.query('SELECT * FROM bot_users');
    this.users = new Map(rows.map((row) => [row.id, userFromRow(row)]));
  }

  has(id) {
    return this.users.has(id);
  }

  get(id) {
    return this.users.get(id);
  }

  /**
   * Registers the user if new, refreshes Telegram fields if existing. Profile fields
   * collected by the sign-up flow (name, phone, signup, signedUpAt) are preserved.
   * Returns { user, created }.
   */
  async register(from) {
    const existing = this.users.get(from.id);
    const now = new Date().toISOString();
    const user = {
      id: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
      lastName: from.last_name ?? null,
      languageCode: from.language_code ?? null,
      name: existing?.name ?? null,
      phone: existing?.phone ?? null,
      email: existing?.email ?? null,
      lang: existing?.lang ?? null, // 'am' | 'en'; null = the default (Amharic), see i18n.js
      signup: existing?.signup ?? null,
      signedUpAt: existing?.signedUpAt ?? null,
      registeredAt: existing?.registeredAt ?? now,
      lastSeenAt: now,
    };
    await this._write(user);
    return { user, created: !existing };
  }

  /** Replaces the stored record for `user.id`. */
  async put(user) {
    await this._write(user);
    return user;
  }

  async _write(user) {
    this.users.set(user.id, user);
    await this.pool.query(
      `INSERT INTO bot_users (id, username, first_name, last_name, language_code, name, phone, email, signup, signed_up_at, registered_at, last_seen_at, lang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         username = $2, first_name = $3, last_name = $4, language_code = $5, name = $6, phone = $7,
         email = $8, signup = $9, signed_up_at = $10, registered_at = $11, last_seen_at = $12, lang = $13`,
      [
        user.id,
        user.username ?? null,
        user.firstName ?? null,
        user.lastName ?? null,
        user.languageCode ?? null,
        user.name ?? null,
        user.phone ?? null,
        user.email ?? null,
        user.signup ? JSON.stringify(user.signup) : null,
        user.signedUpAt ?? null,
        user.registeredAt,
        user.lastSeenAt,
        user.lang ?? null,
      ],
    );
  }

  get size() {
    return this.users.size;
  }
}

function userFromRow(row) {
  return {
    id: row.id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    languageCode: row.language_code,
    name: row.name,
    phone: row.phone,
    email: row.email,
    lang: row.lang ?? null,
    signup: row.signup ?? null,
    signedUpAt: row.signed_up_at ? row.signed_up_at.toISOString() : null,
    registeredAt: row.registered_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
  };
}
