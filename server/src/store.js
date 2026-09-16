import { randomBytes } from 'node:crypto';
import { ensureEconomy, addCoins, track } from './economy.js';
import { withTransaction } from './db/pool.js';

export const STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
});

const money = (n) => Math.round(n * 100) / 100;
const iso = (d = Date.now()) => new Date(d).toISOString();

/**
 * PostgreSQL-backed store.
 *
 * Two pieces of state — `wallets` and `profiles` (which carries stats, the coin
 * economy and suspensions) — are kept as a synchronous in-memory mirror, loaded from
 * Postgres on `load()` and written back through a serialised background queue. That
 * mirror exists for one reason: `server/src/game/room.js` charges stakes, credits
 * prizes and tracks mission progress inline in the Socket.io event loop, and cannot
 * await a query there without a much larger rewrite of the game engine. A third
 * piece, the operator settings overrides, gets the same treatment because they are
 * read on every request that builds a room.
 *
 * Everything else — transactions, rounds, the house ledger and announcements — has
 * no in-memory mirror and is read and written straight against Postgres;
 * every route that touches them is already (or is now) an `async` handler.
 */
export class PaymentStore {
  constructor(pool, { currency = 'ETB', depositFeePercent = 0, withdrawFeePercent = 0, now = Date.now } = {}) {
    this.pool = pool;
    // Clock used wherever "is this still in force?" is decided (suspension expiry). Injectable so
    // tests can pin it; every read that omits `now` (adminPlayers, the auth hooks) goes through it.
    this.now = now;
    this.currency = currency;
    this.depositFeePercent = depositFeePercent;
    this.withdrawFeePercent = withdrawFeePercent;
    this.data = { wallets: {}, profiles: {}, settings: {} };
    // Serialises the fire-and-forget background writes for wallets/profiles/settings
    // so two queued jobs for the same row always land in the order they were made.
    this._queue = Promise.resolve();
  }

  /** Loads the wallet, profile and settings mirrors from Postgres. Call once at boot. */
  async load() {
    const [wallets, profiles, settings] = await Promise.all([
      this.pool.query('SELECT user_id, balance FROM wallets'),
      this.pool.query('SELECT * FROM profiles'),
      this.pool.query('SELECT overrides FROM settings WHERE id = 1'),
    ]);
    this.data.wallets = {};
    for (const row of wallets.rows) this.data.wallets[row.user_id] = { balance: row.balance };
    this.data.profiles = {};
    for (const row of profiles.rows) this.data.profiles[row.user_id] = profileFromRow(row);
    this.data.settings = settings.rows[0]?.overrides ?? {};
  }

  /** Chains a background write onto the serial queue; a throwing job never blocks later ones. */
  _enqueue(jobFn) {
    const run = this._queue.then(jobFn);
    this._queue = run.catch((err) => console.error('[store] background write failed:', err));
    return run;
  }

  /** Waits for every background write queued so far to finish (or fail). Mainly for tests. */
  async flush() {
    await this._queue.catch(() => {});
  }

  /**
   * Synchronous wallet change used by the game (stakes, refunds, prizes) so room logic
   * never races the ledger. Returns the new balance, or null if funds are insufficient.
   * The Postgres write (balance + a matching `method: 'game'` transaction row, in one
   * DB transaction) happens in the background.
   */
  adjust(userId, delta, note = '') {
    const wallet = (this.data.wallets[userId] ??= { balance: 0 });
    const next = money(wallet.balance + delta);
    if (next < 0) return null;
    wallet.balance = next;
    const now = new Date();
    const tx = {
      ref: PaymentStore.newRef(),
      userId,
      method: 'game',
      amount: money(delta),
      currency: this.currency,
      status: STATUS.PAID,
      note,
      createdAt: now,
    };
    this._enqueue(() =>
      withTransaction(this.pool, async (client) => {
        await client.query(
          `INSERT INTO wallets (user_id, balance, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (user_id) DO UPDATE SET balance = wallets.balance + $2, updated_at = now()`,
          [userId, tx.amount],
        );
        await client.query(
          `INSERT INTO transactions (ref, user_id, type, method, amount, currency, status, note, created_at, updated_at)
           VALUES ($1, $2, 'game', 'game', $3, $4, $5, $6, $7, $7)`,
          [tx.ref, userId, tx.amount, tx.currency, tx.status, tx.note, tx.createdAt],
        );
      }),
    );
    return next;
  }

  /**
   * Moves `amount` from one wallet to another (player-to-player transfer). The in-memory
   * mirror changes at once so the sender cannot spend the money twice; both ledger rows and
   * both wallet updates land in Postgres in one transaction. Returns the new balances.
   */
  transfer({ fromId, toId, amount, note = '' }) {
    const value = money(amount);
    if (!(value > 0)) throw new Error('Amount must be positive');
    if (fromId === toId) throw new Error('You cannot send money to yourself');
    const from = (this.data.wallets[fromId] ??= { balance: 0 });
    const to = (this.data.wallets[toId] ??= { balance: 0 });
    if (from.balance < value) throw new Error(`Insufficient balance: you have ${from.balance.toFixed(2)} ${this.currency}`);
    from.balance = money(from.balance - value);
    to.balance = money(to.balance + value);
    const now = new Date();
    const ref = PaymentStore.newRef();
    const rows = [
      { ref, userId: fromId, amount: -value, note: note || `Sent to ${toId}` },
      { ref: PaymentStore.newRef(), userId: toId, amount: value, note: note || `Received from ${fromId}` },
    ];
    this._enqueue(() =>
      withTransaction(this.pool, async (client) => {
        for (const r of rows) {
          await client.query(
            `INSERT INTO wallets (user_id, balance, updated_at) VALUES ($1, $2, now())
             ON CONFLICT (user_id) DO UPDATE SET balance = wallets.balance + $2, updated_at = now()`,
            [r.userId, r.amount],
          );
          await client.query(
            `INSERT INTO transactions (ref, user_id, type, method, amount, currency, status, note, provider_ref, created_at, updated_at)
             VALUES ($1, $2, 'transfer', 'transfer', $3, $4, $5, $6, $7, $8, $8)`,
            [r.ref, r.userId, r.amount, this.currency, STATUS.PAID, r.note, ref, now],
          );
        }
      }),
    );
    return { ref, senderBalance: from.balance, recipientBalance: to.balance };
  }

  /** The player whose profile carries this (normalised) phone number, or null. */
  playerByPhone(phone) {
    for (const [id, p] of Object.entries(this.data.profiles)) if (p.phone && p.phone === phone) return { id: Number(id), ...p };
    return null;
  }

  // ---------- profiles (collected by the bot at sign-up, editable in the Mini App) ----------

  static emptyProfile() {
    return { name: null, phone: null, email: null, username: null, firstName: null, lastName: null, signedUpAt: null, updatedAt: null, stats: { games: 0, wins: 0, winnings: 0 } };
  }

  profile(userId) {
    return this.data.profiles[userId] ?? null;
  }

  /** Read-only view that never writes: a blank profile for users we have not seen yet. */
  profileOrEmpty(userId) {
    return this.profile(userId) ?? PaymentStore.emptyProfile();
  }

  /** In-memory only — creates the profile if missing, never writes. */
  ensureProfile(userId) {
    return (this.data.profiles[userId] ??= PaymentStore.emptyProfile());
  }

  /** Queues a Postgres upsert of the current in-memory state of this profile. */
  _persistProfile(userId) {
    return this._enqueue(() => {
      const profile = this.data.profiles[userId];
      if (!profile) return null;
      return this.pool.query(
        `INSERT INTO profiles (user_id, name, phone, email, username, first_name, last_name, signed_up_at, updated_at, stats, economy, suspended)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (user_id) DO UPDATE SET
           name = $2, phone = $3, email = $4, username = $5, first_name = $6, last_name = $7,
           signed_up_at = $8, updated_at = $9, stats = $10, economy = $11, suspended = $12`,
        [
          userId,
          profile.name ?? null,
          profile.phone ?? null,
          profile.email ?? null,
          profile.username ?? null,
          profile.firstName ?? null,
          profile.lastName ?? null,
          profile.signedUpAt ?? null,
          profile.updatedAt ?? null,
          JSON.stringify(profile.stats ?? { games: 0, wins: 0, winnings: 0 }),
          profile.economy ? JSON.stringify(profile.economy) : null,
          profile.suspended ? JSON.stringify(profile.suspended) : null,
        ],
      );
    });
  }

  coins(userId) {
    return this.profile(userId)?.economy?.coins ?? 0;
  }

  /** Synchronous mission progress (e.g. one per marked number); persisted in the background. */
  trackMission(userId, key, n = 1, now = Date.now()) {
    const profile = this.ensureProfile(userId);
    track(profile, key, n, now);
    this._persistProfile(userId);
  }

  /** Runs `fn(profile)` exclusively (creating the profile if needed), then persists. */
  async updateProfile(userId, fn) {
    const result = fn(this.ensureProfile(userId));
    await this._persistProfile(userId);
    return result;
  }

  async setProfile(userId, patch) {
    const profile = this.ensureProfile(userId);
    Object.assign(profile, patch, { updatedAt: iso() });
    await this._persistProfile(userId);
    return profile;
  }

  /**
   * Synchronous end-of-round bookkeeping: statistics, mission progress and coins for a
   * Free Bingo win, updated in memory at once; the round record, house ledger and the
   * touched profiles are written to Postgres in the background, in one transaction.
   */
  recordRound({ participants, players = null, winnerId = null, winner = null, prize = 0, stake = 0, stakes = 0, houseTake = 0, room = null, round = null, numbersCalled = null, startedAt = null, freeCoins = 0, now = Date.now() }) {
    const roundRow = {
      at: new Date(now),
      room,
      round,
      stake,
      players: players ?? participants.map((id) => ({ id, name: this.data.profiles[id]?.name ?? `Player ${id}`, cartela: null, marked: null })),
      winner,
      prize,
      stakes,
      houseTake,
      numbersCalled,
      durationMs: startedAt ? Math.max(0, now - startedAt) : null,
      freeCoins: stake === 0 && winnerId ? freeCoins : 0,
    };
    for (const id of participants) {
      const profile = this.ensureProfile(id);
      profile.stats.games += 1;
      ensureEconomy(profile, now);
      track(profile, 'games', 1, now);
      if (stake > 0) track(profile, 'paid', 1, now);
      if (id === winnerId) {
        profile.stats.wins += 1;
        profile.stats.winnings = money(profile.stats.winnings + prize);
        track(profile, 'wins', 1, now);
        if (stake === 0 && freeCoins > 0) addCoins(profile, freeCoins, 'Won Free Bingo', now);
      }
    }
    this._enqueue(() =>
      withTransaction(this.pool, async (client) => {
        await client.query(
          `INSERT INTO rounds (at, room, round, stake, players, winner, prize, stakes, house_take, numbers_called, duration_ms, free_coins)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [roundRow.at, roundRow.room, roundRow.round, roundRow.stake, JSON.stringify(roundRow.players), roundRow.winner ? JSON.stringify(roundRow.winner) : null, roundRow.prize, roundRow.stakes, roundRow.houseTake, roundRow.numbersCalled, roundRow.durationMs, roundRow.freeCoins],
        );
        if (houseTake > 0) {
          await client.query(`UPDATE house_balance SET balance = balance + $1 WHERE id = 1`, [houseTake]);
          await client.query(
            `INSERT INTO house_ledger (at, type, room, round, stake, players, stakes, prize, fee)
             VALUES ($1,'round',$2,$3,$4,$5,$6,$7,$8)`,
            [roundRow.at, room, round, stake, participants.length, stakes, prize, houseTake],
          );
        }
        for (const id of participants) {
          const profile = this.data.profiles[id];
          if (!profile) continue;
          await client.query(
            `INSERT INTO profiles (user_id, name, phone, email, username, first_name, last_name, signed_up_at, updated_at, stats, economy, suspended)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (user_id) DO UPDATE SET stats = $10, economy = $11, updated_at = profiles.updated_at`,
            [
              id, profile.name ?? null, profile.phone ?? null, profile.email ?? null, profile.username ?? null,
              profile.firstName ?? null, profile.lastName ?? null, profile.signedUpAt ?? null, profile.updatedAt ?? null,
              JSON.stringify(profile.stats), profile.economy ? JSON.stringify(profile.economy) : null, profile.suspended ? JSON.stringify(profile.suspended) : null,
            ],
          );
        }
      }),
    );
  }

  /** The house's running balance and its most recent ledger entries. */
  async house(limit = 100) {
    const [bal, entries] = await Promise.all([
      this.pool.query('SELECT balance FROM house_balance WHERE id = 1'),
      this.pool.query('SELECT * FROM house_ledger ORDER BY id DESC LIMIT $1', [limit]),
    ]);
    return { balance: bal.rows[0]?.balance ?? 0, entries: entries.rows.map(houseEntryFromRow).reverse() };
  }

  /**
   * Aggregate totals over the *entire* house ledger (rounds and deposits), computed in
   * SQL rather than by summing every row in JS — the admin dashboard's summary tiles.
   */
  async houseTotals() {
    const [bal, roundAgg, depositAgg] = await Promise.all([
      this.pool.query('SELECT balance FROM house_balance WHERE id = 1'),
      this.pool.query(
        `SELECT count(*)::int AS n, COALESCE(SUM(stakes),0) AS stakes, COALESCE(SUM(prize),0) AS prize, COALESCE(SUM(fee),0) AS fee
         FROM house_ledger WHERE type = 'round'`,
      ),
      this.pool.query(
        `SELECT count(*)::int AS n, COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(fee),0) AS fee
         FROM house_ledger WHERE type = 'deposit'`,
      ),
    ]);
    return {
      balance: bal.rows[0]?.balance ?? 0,
      rounds: roundAgg.rows[0].n,
      stakesCollected: money(roundAgg.rows[0].stakes),
      prizesPaid: money(roundAgg.rows[0].prize),
      roundFees: money(roundAgg.rows[0].fee),
      deposits: depositAgg.rows[0].n,
      depositsReceived: money(depositAgg.rows[0].amount),
      depositFees: money(depositAgg.rows[0].fee),
    };
  }

  // ---------- suspensions ----------

  /** Blocks a player: `days` null = permanent ban. Persisted; returns the suspension record. */
  suspend(userId, { reason = 'Suspended by operator', days = null, by = 'operator' } = {}, now = this.now()) {
    const profile = this.ensureProfile(userId);
    const until = days ? new Date(now + Number(days) * 86_400_000).toISOString() : null;
    profile.suspended = { at: iso(now), reason, until, by };
    this._persistProfile(userId);
    return profile.suspended;
  }

  unsuspend(userId) {
    const profile = this.data.profiles[userId];
    if (!profile?.suspended) return false;
    profile.suspended = null;
    this._persistProfile(userId);
    return true;
  }

  /** The active suspension for a player, or null (expired ones count as lifted). */
  suspension(userId, now = this.now()) {
    const s = this.data.profiles[userId]?.suspended;
    if (!s) return null;
    if (s.until && new Date(s.until).getTime() <= now) return null;
    return s;
  }

  /** One row per known player (profile or wallet), newest activity first. */
  async adminPlayers(query = '') {
    const ids = [...new Set([...Object.keys(this.data.profiles), ...Object.keys(this.data.wallets)].map(Number))];
    const lastTx = new Map();
    if (ids.length) {
      const { rows } = await this.pool.query(
        `SELECT user_id, MAX(created_at) AS last FROM transactions WHERE user_id = ANY($1) GROUP BY user_id`,
        [ids],
      );
      for (const r of rows) lastTx.set(r.user_id, r.last);
    }
    const q = query.trim().toLowerCase();
    const rows = ids.map((id) => {
      const p = this.data.profiles[id] ?? {};
      return {
        id,
        name: p.name ?? p.firstName ?? null,
        username: p.username ?? null,
        phone: p.phone ?? null,
        email: p.email ?? null,
        signedUpAt: p.signedUpAt ?? null,
        balance: this.data.wallets[id]?.balance ?? 0,
        coins: p.economy?.coins ?? 0,
        stats: p.stats ?? { games: 0, wins: 0, winnings: 0 },
        suspended: this.suspension(id),
        lastActivity: (lastTx.get(id) ?? p.updatedAt) ? new Date(lastTx.get(id) ?? p.updatedAt).toISOString() : null,
      };
    });
    const hit = (r) => !q || [r.id, r.name, r.username, r.phone, r.email].some((v) => v != null && String(v).toLowerCase().includes(q));
    return rows.filter(hit).sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '') || a.id - b.id);
  }

  /** Finished rounds, newest first; `query` matches room code, player id or player name. */
  async gameHistory(query = '', limit = 100) {
    const q = query.trim();
    let sql = 'SELECT * FROM rounds';
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      sql += ` WHERE room ILIKE $1 OR players::text ILIKE $1`;
    }
    params.push(Math.min(limit, 500));
    // Ordered by `id` (insertion order), not `at`: rounds recorded within the same clock
    // tick still come back newest-first, matching the old in-memory array's semantics.
    sql += ` ORDER BY id DESC LIMIT $${params.length}`;
    const { rows } = await this.pool.query(sql, params);
    return rows.map(roundFromRow);
  }

  async roundCount() {
    const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM rounds');
    return rows[0].n;
  }

  /** Numbers for the operator dashboard tiles. */
  async adminSummary() {
    const wallets = Object.values(this.data.wallets);
    const [pendingW, pendingD, txCount, house] = await Promise.all([
      this.pendingWithdrawals(),
      this.pendingDeposits(),
      this.pool.query('SELECT count(*)::int AS n FROM transactions'),
      this.house(0),
    ]);
    return {
      players: Object.keys(this.data.profiles).length,
      walletLiabilities: money(wallets.reduce((s, w) => s + w.balance, 0)),
      pendingWithdrawals: { count: pendingW.length, amount: money(pendingW.reduce((s, t) => s - t.amount, 0)) },
      pendingDeposits: { count: pendingD.length, amount: money(pendingD.reduce((s, t) => s + t.amount, 0)) },
      houseBalance: house.balance,
      transactions: txCount.rows[0].n,
    };
  }

  leaderboard(limit = 10) {
    return Object.entries(this.data.profiles)
      .map(([id, p]) => ({ id: Number(id), name: p.name || p.firstName || p.username || `Player ${id}`, ...p.stats }))
      .filter((p) => p.games > 0)
      .sort((a, b) => b.wins - a.wins || b.winnings - a.winnings || a.games - b.games)
      .slice(0, limit);
  }

  balance(userId) {
    return this.data.wallets[userId]?.balance ?? 0;
  }

  async transactionsFor(userId, limit = 20) {
    const { rows } = await this.pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, limit]);
    return rows.map(txFromRow);
  }

  async findByRef(ref) {
    const { rows } = await this.pool.query('SELECT * FROM transactions WHERE ref = $1', [ref]);
    return rows[0] ? txFromRow(rows[0]) : null;
  }

  static newRef() {
    return `TGB${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  async createTransaction({ userId, method, amount, currency }) {
    const now = new Date();
    const tx = { ref: PaymentStore.newRef(), userId, method, amount, currency, status: STATUS.PENDING, checkoutUrl: null, providerRef: null, createdAt: now, updatedAt: now };
    await this.pool.query(
      `INSERT INTO transactions (ref, user_id, type, method, amount, currency, status, created_at, updated_at)
       VALUES ($1,$2,'topup',$3,$4,$5,$6,$7,$7)`,
      [tx.ref, userId, method, amount, currency, tx.status, now],
    );
    return txFromRow({ ...tx, user_id: userId, created_at: now, updated_at: now, checkout_url: null, provider_ref: null, type: 'topup' });
  }

  async update(ref, patch) {
    const cur = await this.findByRef(ref);
    if (!cur) return null;
    const next = { ...cur, ...patch, updatedAt: iso() };
    await this._writeTx(next);
    return next;
  }

  /** Writes every known field of `tx` back to Postgres (used by update/markPaid/markFailed/resolve*). */
  async _writeTx(tx, client = this.pool) {
    await client.query(
      `UPDATE transactions SET
         type=$2, method=$3, account=$4, amount=$5, currency=$6, status=$7, note=$8, checkout_url=$9,
         provider_ref=$10, fee=$11, credited=$12, payout=$13, verified=$14, reason=$15, auto_check=$16, updated_at=$17
       WHERE ref = $1`,
      [
        tx.ref, tx.type ?? 'topup', tx.method ?? null, tx.account ?? null, tx.amount, tx.currency, tx.status,
        tx.note ?? null, tx.checkoutUrl ?? null, tx.providerRef ?? null, tx.fee ?? null, tx.credited ?? null,
        tx.payout ?? null, tx.verified ?? null, tx.reason ?? null, tx.autoCheck ?? null, tx.updatedAt,
      ],
    );
  }

  /**
   * Idempotent: credits the wallet only on the first transition to PAID. The deposit fee
   * (`depositFeePercent` of the amount) stays with the house; `tx.credited` is what the
   * player received. Row-locked so two concurrent webhook deliveries can't both credit.
   */
  async markPaid(ref, providerRef = null) {
    return withTransaction(this.pool, async (client) => {
      const { rows } = await client.query('SELECT * FROM transactions WHERE ref = $1 FOR UPDATE', [ref]);
      if (!rows[0]) return null;
      const tx = txFromRow(rows[0]);
      if (tx.status === STATUS.PAID) return tx;
      const now = iso();
      const fee = money((tx.amount * this.depositFeePercent) / 100);
      tx.status = STATUS.PAID;
      tx.providerRef = providerRef ?? tx.providerRef;
      tx.fee = fee;
      tx.credited = money(tx.amount - fee);
      tx.updatedAt = now;
      await this._writeTx(tx, client);
      this._creditWallet(tx.userId, tx.credited);
      await client.query(
        `INSERT INTO wallets (user_id, balance, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET balance = wallets.balance + $2, updated_at = now()`,
        [tx.userId, tx.credited],
      );
      if (fee > 0) {
        await client.query(`UPDATE house_balance SET balance = balance + $1 WHERE id = 1`, [fee]);
        await client.query(
          `INSERT INTO house_ledger (at, type, user_id, ref, method, amount, fee) VALUES ($1,'deposit',$2,$3,$4,$5,$6)`,
          [now, tx.userId, tx.ref, tx.method, tx.amount, fee],
        );
      }
      return tx;
    });
  }

  /** Mirrors a wallet credit into the in-memory cache (webhooks/admin approvals don't go through `adjust`). */
  _creditWallet(userId, amount) {
    const wallet = (this.data.wallets[userId] ??= { balance: 0 });
    wallet.balance = money(wallet.balance + amount);
  }

  _debitWalletHold(userId, amount) {
    const wallet = (this.data.wallets[userId] ??= { balance: 0 });
    wallet.balance = money(wallet.balance - amount);
  }

  // ---------- manual deposits (bank transfer + pasted transaction id) ----------

  /** A receipt id can confirm one deposit only. */
  async receiptUsed(method, txId) {
    const id = String(txId).trim().toUpperCase();
    const { rows } = await this.pool.query(
      `SELECT 1 FROM transactions WHERE type = 'deposit' AND method = $1 AND provider_ref = $2 AND status NOT IN ('rejected','cancelled') LIMIT 1`,
      [method, id],
    );
    return rows.length > 0;
  }

  /** Records a transfer the player says they made; credited by `markPaid` once confirmed. */
  async submitDeposit({ userId, method, amount, txId, account = null }) {
    const id = String(txId ?? '').trim().toUpperCase();
    const value = money(amount);
    if (!(value > 0)) throw new Error('Amount must be positive');
    if (!/^[A-Z0-9-]{6,32}$/.test(id)) throw new Error('Enter the transaction / receipt id exactly as shown on the receipt (6–32 letters and digits)');
    if (await this.receiptUsed(method, id)) throw new Error('This transaction id has already been submitted');
    const now = iso();
    const tx = {
      ref: PaymentStore.newRef(), type: 'deposit', userId, method, amount: value, currency: this.currency,
      status: STATUS.PENDING, providerRef: id, account, note: `Transfer via ${method}, receipt ${id}`,
      verified: null, checkoutUrl: null, createdAt: now, updatedAt: now,
    };
    await this.pool.query(
      `INSERT INTO transactions (ref, user_id, type, method, account, amount, currency, status, provider_ref, note, created_at, updated_at)
       VALUES ($1,$2,'deposit',$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
      [tx.ref, userId, method, account, value, tx.currency, tx.status, id, tx.note, now],
    );
    return tx;
  }

  async pendingDeposits() {
    const { rows } = await this.pool.query(`SELECT * FROM transactions WHERE type = 'deposit' AND status = 'pending'`);
    return rows.map(txFromRow);
  }

  async depositsByStatus(status = 'pending', limit = 100) {
    const { rows } =
      status === 'all'
        ? await this.pool.query(`SELECT * FROM transactions WHERE type = 'deposit' ORDER BY created_at DESC LIMIT $1`, [limit])
        : await this.pool.query(`SELECT * FROM transactions WHERE type = 'deposit' AND status = $1 ORDER BY created_at DESC LIMIT $2`, [status, limit]);
    return rows.map(txFromRow);
  }

  /** Confirms (credits with the deposit fee) or rejects a pasted-receipt deposit. */
  async resolveDeposit(ref, { approved, verified = 'operator', reason = null }) {
    const tx = await this.findByRef(ref);
    if (!tx || tx.type !== 'deposit') throw new Error('Deposit not found');
    if (tx.status !== STATUS.PENDING) throw new Error(`Deposit already ${tx.status}`);
    if (approved) {
      const paid = await this.markPaid(ref);
      await this.update(ref, { verified });
      return paid;
    }
    return this.update(ref, { status: STATUS.REJECTED, reason: reason ?? 'Transfer could not be confirmed' });
  }

  // ---------- withdrawals (cash-outs) ----------

  /**
   * Moves `amount` out of the wallet at once (in memory) into a pending withdrawal so it
   * cannot be staked twice, then records the transaction in Postgres. An operator later
   * approves (paid out) or rejects (refunded) it.
   */
  async requestWithdrawal({ userId, method, amount, account }) {
    const value = money(amount);
    const wallet = (this.data.wallets[userId] ??= { balance: 0 });
    if (!(value > 0)) throw new Error('Amount must be positive');
    if (wallet.balance < value) throw new Error(`Insufficient balance: you have ${wallet.balance.toFixed(2)} ${this.currency}`);
    const fee = money((value * this.withdrawFeePercent) / 100);
    const now = iso();
    const tx = {
      ref: PaymentStore.newRef(), type: 'withdraw', userId, method, account, amount: -value, fee, payout: money(value - fee),
      currency: this.currency, status: STATUS.PENDING, note: `Cash out to ${method} ${account}`, checkoutUrl: null, providerRef: null,
      createdAt: now, updatedAt: now,
    };
    this._debitWalletHold(userId, value); // held immediately, synchronously — no double-spend window
    try {
      await withTransaction(this.pool, async (client) => {
        // Relative update (mirrors `adjust`): commutative, so it can never race a concurrent
        // game-side wallet write and land the balance in the wrong order.
        await client.query(
          `INSERT INTO wallets (user_id, balance, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (user_id) DO UPDATE SET balance = wallets.balance - $2, updated_at = now()`,
          [userId, value],
        );
        await client.query(
          `INSERT INTO transactions (ref, user_id, type, method, account, amount, fee, payout, currency, status, note, created_at, updated_at)
           VALUES ($1,$2,'withdraw',$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
          [tx.ref, userId, method, account, tx.amount, fee, tx.payout, tx.currency, tx.status, tx.note, now],
        );
      });
    } catch (err) {
      this._creditWallet(userId, value); // roll back the in-memory hold if the write failed
      throw err;
    }
    return tx;
  }

  async pendingWithdrawals() {
    const { rows } = await this.pool.query(`SELECT * FROM transactions WHERE type = 'withdraw' AND status = 'pending'`);
    return rows.map(txFromRow);
  }

  async withdrawalsByStatus(status = 'pending', limit = 100) {
    const { rows } =
      status === 'all'
        ? await this.pool.query(`SELECT * FROM transactions WHERE type = 'withdraw' ORDER BY created_at DESC LIMIT $1`, [limit])
        : await this.pool.query(`SELECT * FROM transactions WHERE type = 'withdraw' AND status = $1 ORDER BY created_at DESC LIMIT $2`, [status, limit]);
    return rows.map(txFromRow);
  }

  /**
   * Settles a pending withdrawal: `approved` marks it paid (fee to the house), otherwise the
   * hold goes back to the wallet with `status` rejected (operator) or cancelled (player).
   */
  async resolveWithdrawal(ref, { approved, providerRef = null, reason = null, status = STATUS.REJECTED } = {}) {
    return withTransaction(this.pool, async (client) => {
      const { rows } = await client.query('SELECT * FROM transactions WHERE ref = $1 FOR UPDATE', [ref]);
      if (!rows[0] || rows[0].type !== 'withdraw') throw new Error('Withdrawal not found');
      const tx = txFromRow(rows[0]);
      if (tx.status !== STATUS.PENDING) throw new Error(`Withdrawal already ${tx.status}`);
      const now = iso();
      tx.updatedAt = now;
      if (approved) {
        tx.status = STATUS.PAID;
        tx.providerRef = providerRef;
        if (tx.fee > 0) {
          await client.query(`UPDATE house_balance SET balance = balance + $1 WHERE id = 1`, [tx.fee]);
          await client.query(
            `INSERT INTO house_ledger (at, type, user_id, ref, method, amount, fee) VALUES ($1,'withdraw',$2,$3,$4,$5,$6)`,
            [now, tx.userId, tx.ref, tx.method, -tx.amount, tx.fee],
          );
        }
      } else {
        tx.status = status;
        tx.reason = reason;
        this._creditWallet(tx.userId, -tx.amount); // amount is negative: refund the hold
        await client.query(
          `INSERT INTO wallets (user_id, balance, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (user_id) DO UPDATE SET balance = wallets.balance + $2, updated_at = now()`,
          [tx.userId, -tx.amount],
        );
      }
      await this._writeTx(tx, client);
      return tx;
    });
  }

  async markFailed(ref, status = STATUS.FAILED, providerRef = null) {
    const tx = await this.findByRef(ref);
    if (!tx || tx.status === STATUS.PAID) return tx ?? null;
    tx.status = status;
    tx.providerRef = providerRef ?? tx.providerRef;
    tx.updatedAt = iso();
    await this._writeTx(tx);
    return tx;
  }

  // ---------- operator settings overrides (server/src/settings.js) ----------

  settingsOverrides() {
    return { ...this.data.settings };
  }

  async updateSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    await this.pool.query('UPDATE settings SET overrides = $1 WHERE id = 1', [JSON.stringify(this.data.settings)]);
  }

  async resetSettings() {
    this.data.settings = {};
    await this.pool.query(`UPDATE settings SET overrides = '{}'::jsonb WHERE id = 1`);
  }

  // ---------- announcements (server/src/announcements.js) ----------

  /** `now` is injectable (tests pass a fixed clock) — deliberately NOT SQL `now()`. */
  async activeAnnouncements(now = Date.now()) {
    const { rows } = await this.pool.query(
      `SELECT * FROM announcements WHERE active AND (expires_at IS NULL OR expires_at > $1) ORDER BY seq DESC`,
      [new Date(now)],
    );
    return rows.map(announcementFromRow);
  }

  async allAnnouncements() {
    const { rows } = await this.pool.query(`SELECT * FROM announcements ORDER BY seq DESC`);
    return rows.map(announcementFromRow);
  }

  async getAnnouncement(id) {
    const { rows } = await this.pool.query('SELECT * FROM announcements WHERE id = $1', [id]);
    return rows[0] ? announcementFromRow(rows[0]) : null;
  }

  async addAnnouncement(a) {
    await this.pool.query(
      `INSERT INTO announcements (id, text, level, created_at, expires_at, active, by, telegram) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [a.id, a.text, a.level, a.createdAt, a.expiresAt, a.active, a.by, a.telegram ? JSON.stringify(a.telegram) : null],
    );
  }

  async deactivateAnnouncement(id) {
    const { rows } = await this.pool.query(
      `UPDATE announcements SET active = false, removed_at = now() WHERE id = $1 AND active RETURNING *`,
      [id],
    );
    return rows[0] ? announcementFromRow(rows[0]) : null;
  }

  async setAnnouncementTelegram(id, telegram) {
    await this.pool.query('UPDATE announcements SET telegram = $1 WHERE id = $2', [JSON.stringify(telegram), id]);
  }

  /** Telegram ids of every known player. */
  telegramRecipientIds() {
    return Object.keys(this.data.profiles)
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0);
  }
}

// ---------- row <-> app-shape mappers ----------

function profileFromRow(row) {
  return {
    name: row.name, phone: row.phone, email: row.email, username: row.username,
    firstName: row.first_name, lastName: row.last_name,
    signedUpAt: row.signed_up_at ? row.signed_up_at.toISOString() : null,
    updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    stats: row.stats ?? { games: 0, wins: 0, winnings: 0 },
    economy: row.economy ?? undefined,
    suspended: row.suspended ?? undefined,
  };
}

function txFromRow(row) {
  return {
    ref: row.ref, userId: row.user_id, type: row.type, method: row.method, account: row.account,
    amount: row.amount, currency: row.currency, status: row.status, note: row.note,
    checkoutUrl: row.checkout_url, providerRef: row.provider_ref, fee: row.fee, credited: row.credited,
    payout: row.payout, verified: row.verified, reason: row.reason, autoCheck: row.auto_check,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
  };
}

function roundFromRow(row) {
  return {
    at: row.at.toISOString(), room: row.room, round: row.round, stake: row.stake,
    players: row.players ?? [], winner: row.winner ?? null, prize: row.prize, stakes: row.stakes,
    houseTake: row.house_take, numbersCalled: row.numbers_called, durationMs: row.duration_ms, freeCoins: row.free_coins,
  };
}

function houseEntryFromRow(row) {
  return {
    at: row.at.toISOString(), type: row.type, userId: row.user_id, ref: row.ref, room: row.room,
    round: row.round, stake: row.stake, players: row.players, stakes: row.stakes, prize: row.prize,
    fee: row.fee, method: row.method, amount: row.amount,
  };
}

function announcementFromRow(row) {
  return {
    id: row.id, text: row.text, level: row.level, createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null, active: row.active,
    removedAt: row.removed_at ? row.removed_at.toISOString() : null, by: row.by, telegram: row.telegram ?? null,
  };
}
