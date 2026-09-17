-- Telegram Bingo — PostgreSQL schema.
--
-- Replaces the JSON-file stores (server/data/payments.json, bot/data/users.json).
-- Applied automatically on server start (see db/pool.js migrate()) and is safe to run
-- repeatedly: every statement is guarded with IF NOT EXISTS.
--
-- Design notes:
--   * Money columns are NUMERIC(14,2) — exact decimal, no float rounding surprises.
--   * `wallets` and `profiles` are the two tables the game server also keeps a
--     synchronous in-memory mirror of (see store.js) because room.js / realtime.js
--     charge, credit and track mission progress inline in the Socket.io hot path and
--     cannot await a query there. Everything else (transactions, rounds, the house
--     ledger, settings, announcements) is read and written straight against Postgres.
--   * `bot_users` is the Telegram bot's own sign-up store; it lives in the same
--     database (simplest single-service deployment) but is never joined against the
--     game server's tables — the two stay in sync only through POST /api/profile/sync.

CREATE TABLE IF NOT EXISTS wallets (
  user_id     BIGINT PRIMARY KEY,
  balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id       BIGINT PRIMARY KEY,
  name          TEXT,
  phone         TEXT,
  email         TEXT,
  username      TEXT,
  first_name    TEXT,
  last_name     TEXT,
  signed_up_at  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ,
  stats         JSONB NOT NULL DEFAULT '{"games":0,"wins":0,"winnings":0}'::jsonb,
  economy       JSONB,
  suspended     JSONB
);
CREATE INDEX IF NOT EXISTS profiles_email_idx ON profiles (lower(email));
CREATE INDEX IF NOT EXISTS profiles_phone_idx ON profiles (phone);

CREATE TABLE IF NOT EXISTS transactions (
  ref           TEXT PRIMARY KEY,
  user_id       BIGINT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'topup', -- topup | deposit | withdraw | game
  method        TEXT,
  account       TEXT,
  amount        NUMERIC(14,2) NOT NULL,
  currency      TEXT NOT NULL,
  status        TEXT NOT NULL,
  note          TEXT,
  checkout_url  TEXT,
  provider_ref  TEXT,
  fee           NUMERIC(14,2),
  credited      NUMERIC(14,2),
  payout        NUMERIC(14,2),
  verified      TEXT,
  reason        TEXT,
  auto_check    TEXT,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);
-- Optional details a player adds to a transfer+receipt deposit so the operator can match it.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payer_phone TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payer_name TEXT;
CREATE INDEX IF NOT EXISTS transactions_user_idx ON transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_type_status_idx ON transactions (type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS transactions_receipt_idx ON transactions (method, provider_ref) WHERE type = 'deposit';

CREATE TABLE IF NOT EXISTS rounds (
  id              BIGSERIAL PRIMARY KEY,
  at              TIMESTAMPTZ NOT NULL,
  room            TEXT,
  round           INT,
  stake           NUMERIC(14,2),
  players         JSONB NOT NULL DEFAULT '[]'::jsonb,
  winner          JSONB,
  prize           NUMERIC(14,2) NOT NULL DEFAULT 0,
  stakes          NUMERIC(14,2) NOT NULL DEFAULT 0,
  house_take      NUMERIC(14,2) NOT NULL DEFAULT 0,
  numbers_called  INT,
  duration_ms     BIGINT,
  free_coins      NUMERIC(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rounds_at_idx ON rounds (at DESC);
CREATE INDEX IF NOT EXISTS rounds_room_idx ON rounds (room);

CREATE TABLE IF NOT EXISTS house_ledger (
  id       BIGSERIAL PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL,
  type     TEXT NOT NULL, -- round | deposit | withdraw
  user_id  BIGINT,
  ref      TEXT,
  room     TEXT,
  round    INT,
  stake    NUMERIC(14,2),
  players  INT,
  stakes   NUMERIC(14,2),
  prize    NUMERIC(14,2),
  fee      NUMERIC(14,2) NOT NULL DEFAULT 0,
  method   TEXT,
  amount   NUMERIC(14,2)
);
CREATE INDEX IF NOT EXISTS house_ledger_at_idx ON house_ledger (at DESC);

-- Singleton row: the house's running balance, kept alongside house_ledger so reading
-- it is O(1) instead of SUM()-ing the whole ledger on every admin dashboard refresh.
CREATE TABLE IF NOT EXISTS house_balance (
  id       SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  balance  NUMERIC(14,2) NOT NULL DEFAULT 0
);
INSERT INTO house_balance (id, balance) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

-- Singleton row: operator overrides on top of the .env defaults (see settings.js).
CREATE TABLE IF NOT EXISTS settings (
  id         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  overrides  JSONB NOT NULL DEFAULT '{}'::jsonb
);
INSERT INTO settings (id, overrides) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS announcements (
  seq         BIGSERIAL,
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  level       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL,
  expires_at  TIMESTAMPTZ,
  active      BOOLEAN NOT NULL DEFAULT true,
  removed_at  TIMESTAMPTZ,
  by          TEXT,
  telegram    JSONB
);
-- Ordered by `seq` (insertion order), not `created_at`: two announcements posted within the
-- same clock tick (or a caller-supplied fixed clock, as in tests) still sort newest-first.
CREATE INDEX IF NOT EXISTS announcements_active_idx ON announcements (active, seq DESC);

-- ---------- removed feature: email login ----------
-- Players sign in only through Telegram now. Databases created while the email login
-- existed still carry these objects; drop them so nothing stale lingers.
DROP TABLE IF EXISTS login_codes;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS email_accounts;
DROP SEQUENCE IF EXISTS email_account_ids;

-- ---------- Telegram bot sign-up store (bot/src/users.js) ----------

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
