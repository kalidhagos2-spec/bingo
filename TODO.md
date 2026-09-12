# TODO

Tracker for open/decided items on the Telegram Bingo Mini App. See
`claude/postgres-migration-and-smoke-test.md` (Claude Project "telegram")
for the full writeup behind any resolved item below.

## Resolved

- [x] **Design PostgreSQL schema + choose ORM (Prisma)**
  Schema is designed (`server/src/db/schema.sql`, applied idempotently via
  `CREATE TABLE IF NOT EXISTS` on every boot; the bot's smaller `bot_users`
  table lives inline in `bot/src/db/pool.js`).
  ORM decision: **no ORM** — raw SQL via the plain `pg` (node-postgres)
  driver, not Prisma. Deliberate choice: wallet/profile/settings reads need
  to stay synchronous (an in-memory mirror required by the real-time
  Socket.io game engine), and writes go through atomic relative SQL updates
  (`balance = wallets.balance + $2`) plus `SELECT ... FOR UPDATE` row
  locking for idempotent operations — both are easy to express as
  hand-written SQL and would fight a typical ORM's abstractions.

- [x] **Free-tier hosting groundwork (Render + Neon + Vercel).** The
  webapp and server didn't work split across two origins before this: the
  app assumed same-origin (docker-compose's nginx), the bot only supported
  Telegram long-polling (which can't survive a host sleeping the process),
  and there was no deploy config for any of the three platforms. Fixed and
  smoke-tested:
  - `server`: CORS wiring (`ALLOWED_ORIGINS`, both Express and Socket.io) —
    off by default (unchanged same-origin behavior), on when set. Verified
    allowed/disallowed origins get the right response headers.
  - `bot`: automatic webhook mode when `WEBHOOK_URL` (or Render's own
    `RENDER_EXTERNAL_URL`) is set — long-polling stays the default
    everywhere else. Verified end-to-end: health check, a forged webhook
    request correctly rejected (missing Telegram secret token), a real
    `/start` update correctly processed and the user registered in Postgres.
  - `webapp`: `VITE_API_URL` build-time variable so the app can call a
    server on a different origin than itself. Verified both build modes
    (unset → same-origin, set → the URL is baked into the bundle).
  - `render.yaml` at the repo root (a Render Blueprint defining both
    `tg-bingo-server` and `tg-bingo-bot` as free web services) and a new
    **"Deploy for free"** section in `README.md` walking through Neon →
    Render → Vercel end to end.

## Open (user decisions/actions, not code)

- [ ] **Rotate the bot token via @BotFather.** The real token was found
  hardcoded in `bot/.env.example` (fixed, now a placeholder) and was also
  pasted directly in chat at one point — treat it as burned regardless of
  the file fix. Do this *before* deploying (below), so the deployed bot
  starts on a clean token.
- [ ] **Actually deploy it** — create the Neon project, deploy the Render
  blueprint, deploy the webapp to Vercel, and fill in the handful of env
  vars each needs (the webapp's URL into the bot/server, the server's URL
  into the bot). Full steps in README.md's "Deploy for free" section.
- [ ] **Local docker-compose**, if you still want that for local dev/testing
  (separate from the free-hosting path above): run `docker compose up
  --build -d` on a machine that can reach Docker Hub (the cloud sandbox used
  for this work can't pull `node:22-alpine` / `postgres:16-alpine`). Fill in
  `bot/.env` / `server/.env` with the rotated bot token and a real
  `WEBAPP_URL` / `PUBLIC_URL` first.
