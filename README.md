# Telegram Bingo Mini App

A production-style project that brings classic Bingo to Telegram using
[Telegram Mini Apps](https://core.telegram.org/bots/webapps). Users register via a
Telegram bot, press **Play**, and are taken to an interactive Bingo game built with
React and Tailwind CSS.

## Roadmap

- ✅ Bot onboarding, sign-up (name · phone · email) & Mini App launch
- ✅ Backend (Node.js / Express) with wallet + Ethiopian payment gateways
- ✅ Live tables hosted by the house (Socket.io), cartelas, BINGO! claims, prize pools
- ✅ Email login for players outside Telegram
- ✅ Daily bonus, missions, coin shop with cartela skins
- ✅ Persistent database (PostgreSQL, shared by every server instance)

## Project layout

```
tg-bingo/
├── bot/        Telegram bot (Node.js + Telegraf)
│   ├── src/index.js   /start sign-up flow, /play, /profile, Mini App buttons
│   ├── src/signup.js  sign-up state machine (unit-tested)
│   ├── src/users.js   PostgreSQL-backed user store keyed by Telegram ID (table `bot_users`)
│   ├── src/db/pool.js pool + migration for the one table the bot owns
│   └── scripts/       one-off import of an old bot/data/users.json, if you have one
├── server/     Game server (Express + Socket.io)
│   ├── src/game/      bingo.js (cards, cartelas), room.js (table), manager.js (lobby)
│   ├── src/routes/    payments, profile, economy, auth (email login), admin (house)
│   ├── src/economy.js daily bonus · missions · shop rules
│   ├── src/emailAuth.js, mailer.js, store.js, realtime.js
│   ├── src/db/        schema.sql + pool.js (PostgreSQL — shared with the bot)
│   ├── scripts/       one-off import of an old server/data/payments.json, if you have one
│   └── test/          node --test suites (run against a real Postgres test database)
└── webapp/     Mini App (React + Vite + Tailwind CSS v4)
    └── src/
        ├── App.jsx                 login gate + screen routing
        ├── components/             Game (lobby · pick · table), Wallet, Profile, Missions, Shop, Login
        ├── hooks/useTelegram.js    Telegram WebApp SDK wrapper (ready/expand/haptics)
        └── lib/                    api, socket, session, sound, themes (cartela skins)
```

## Features

**Bot**
- `/start` registers the user by Telegram ID and, the first time, walks them through a
  three-step **sign-up**: display name (one-tap suggestion from their Telegram name),
  phone number (Telegram *share contact* button, typed number, or *Skip for now*) and
  the email address used to log in outside Telegram. The
  flow is a small state machine in `bot/src/signup.js` (unit-tested with `npm test`).
- The collected fields are pushed to the game server (`POST /api/profile/sync`, signed
  with the bot token) so the Mini App's **Profile** screen shows and edits the same
  data, and players appear in rooms under their chosen display name.
- **Play Bingo** button opens the Mini App via a `web_app` button (HTTPS required)
- `/play`, `/profile` (view · edit · finish sign-up) and **How to play** actions

**Mini App**
- **Lobby** (home screen): logo banner, coin / ETB / name pills, colourful game cards
  (Free / 10 / 20 / 50 ETB) with entry, prize, house fee and live status plus a **JOIN**
  button, a **Private Tournament → Create Room** card, a leaderboard, and a Missions ·
  Shop · Profile bottom bar. Players who have not finished sign-up see a *Finish your
  sign-up* banner and a badge on **Profile**.
- **Daily Bonus, Missions and Shop** (coins, a soft currency that never converts to ETB):
  the lobby's Daily Bonus card pays 50 → 300 coins along a 7-day streak (once per UTC
  day); **Missions** are daily goals fed by real play (play 3 rounds, win a round, mark
  50 numbers, play a paid table, claim the bonus) with coin rewards; the **Shop** sells
  cartela skins (Emerald, Sunset, Neon, Gold — applied to your card in every game) and
  boosters (streak shield, bonus doubler). Winning **Free Bingo** pays `FREE_BINGO_COINS`
  (default 50). API: `GET /api/economy`, `POST /api/economy/bonus/claim`,
  `POST /api/economy/missions/:id/claim`, `POST /api/economy/shop/:id/buy`,
  `POST /api/economy/theme/:theme`.
- **Email login.** Inside Telegram players are signed in by `initData`. Everywhere else
  (a browser, a shared link) the app shows **Log in with email**: the address gets a
  6-digit one-time code (`POST /api/auth/email/request`), exchanged for a 30-day session
  token (`POST /api/auth/email/verify`, sent as `Authorization: Bearer …` and as the
  socket `auth.token`). An email already on a Telegram player's profile logs into that
  player, so Telegram and browser sessions share one wallet, profile and stats. Set
  `SMTP_URL` (nodemailer URL) and `MAIL_FROM` in `server/.env` to send real mail; without
  SMTP the code is printed to the server log and, in dev mode, shown in the app.
- **Profile** screen: avatar, display name, phone and email (editable, `PUT /api/profile`),
  Telegram username and id, sign-up status, and stats (games, wins, ETB won) that the
  server records at the end of every round (`GET /api/profile/leaderboard`).
- **Wallet** screen: ETB balance, top-up through the payment gateways, **cash-out**
  requests with pending / paid / rejected status and a cancel button, and the activity
  ledger (top-ups, stakes, refunds, prizes, cash-outs).
- Telegram haptics and theme colours when opened inside Telegram; works in a plain browser too

## Local development

### 1. Mini App

```bash
cd webapp
npm install
npm run dev          # http://localhost:5173
```

In another terminal expose it over HTTPS (Telegram will not open plain http):

```bash
ngrok http 5173
```

Copy the `https://….ngrok-free.app` URL.

### 2. Server

The bot and the game server share one PostgreSQL database. Start Postgres (Docker is the
quickest way, even if you run the bot/server themselves outside Docker):

```bash
docker run -d --name tg-bingo-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=tgbingo -p 5432:5432 postgres:16-alpine
```

```bash
cd server
npm install
cp .env.example .env   # DATABASE_URL defaults to the container above; set BOT_TOKEN + PUBLIC_URL too
npm run dev
```

The schema (`src/db/schema.sql`) is applied automatically on boot — nothing to run by hand.
Migrating an existing `data/payments.json` from before this was a database? `npm run migrate:json`.

### 3. Bot

```bash
cd bot
npm install
cp .env.example .env   # set BOT_TOKEN, WEBAPP_URL (the ngrok https URL), API_URL and DATABASE_URL
npm run dev
```

Same database, different table (`bot_users`) — see `npm run migrate:json` here too if you
have an old `data/users.json`.

Open your bot in Telegram, send `/start`, press **Play Bingo**.

> Tip: you can also register the URL with @BotFather (`/setmenubutton`) so the game
> opens from the chat menu button.

## Multiplayer rooms

The multiplayer flow follows the popular Ethiopian Telegram bingo apps (lobby by stake,
numbered cartelas, a called-number board, a BINGO! claim button):

- **Lobby.** One public table per stake (`STAKES`, default free / 10 / 20 / 50 ETB). Each
  row shows live status: *Registering*, *N s* until start, *In progress · call N*, the
  number of players, and the prize pool. Tap a row to sit down. Private rooms with a
  4-letter code are still available under *Play with friends*.
- **Cartelas.** While registration is open every player picks a numbered cartela (1–100
  by default). Each number is a fixed card, so cartela #17 is the same card everywhere.
  The 10-column grid shows taken numbers in red with the owner's name, yours in green.
  On a paid table the stake is charged from the wallet on the first pick (switching is
  free) and refunded if you leave before the round starts. Players without a cartela
  watch the round and can register for the next one.
- **Timer.** Once `MIN_PLAYERS` players hold a cartela a **40 s** countdown starts
  (`COUNTDOWN_MS`). The **house hosts every table**: the server starts the round when the
  timer ends and calls the numbers; no player can start or control a game. **Start Game** takes you to the
  board where an overlay counts down the remaining seconds and shows the growing prize.
- **Game screen.** Prize / call number / players tiles on top, the 75-number board on
  the left (called numbers red, latest green), your cartela with the **CALL** box on the
  right, and a LEAVE · REFRESH · **BINGO!** · sound bar at the bottom. The server calls
  a number every 4 s and validates each mark (called and on your card).
- **Winning.** Press **BINGO!** once every number on your card is marked (`FULL_CARD`,
  default) — or after `LINES_TO_WIN` lines with `FULL_CARD=false`. A premature claim is
  rejected with your progress. The winner gets the pool: stakes minus
  `HOUSE_CUT_PERCENT` — the house keeps **2 %** of every player's stake by default and the
  fee of each played round is written to a house ledger (`GET /api/admin/house`, header
  `x-admin-token: ADMIN_TOKEN`). If all 75 numbers run out, stakes are refunded in full
  and the house takes nothing.
  Everyone sees the winner's card and payout, then registration re-opens.
- Sockets authenticate with Telegram `initData`, so a player who reopens the Mini App
  mid-round gets their seat and card back. Room state is in memory (single server);
  wallet moves are written to the payment ledger (`method: "game"`).
- Tunables in `server/.env`: `STAKES`, `HOUSE_CUT_PERCENT`, `MIN_PLAYERS`, `MAX_PLAYERS`,
  `FULL_CARD`, `LINES_TO_WIN`, `CALL_INTERVAL_MS`, `COUNTDOWN_MS`, `RESTART_DELAY_MS`,
  `CARTELA_COUNT`.

Socket.io events: `room:list`, `room:join {stake}` or `{code}`, `room:create {stake}`,
`room:leave`, `game:choose {cartela}`, `game:mark {number}`,
`game:claim` → server pushes `session:me`, `lobby:rooms`, `room:state`, `game:card`,
`game:number`, `game:over`, `wallet:balance`. In a plain browser without Telegram each
tab is a separate guest, which is handy for local testing.

## Payments (wallet top-up)

`server/` is an Express backend that gives every Telegram user a wallet (ETB) and lets
them top it up through Ethiopian payment rails:

| Method in app       | Gateway                                                  | Credentials (`server/.env`) |
|---------------------|----------------------------------------------------------|-----------------------------|
| Telebirr            | Telebirr Web API (Ethio Telecom mobile money), direct    | `TELEBIRR_*`                |
| CBE Birr            | [Chapa](https://chapa.co) hosted checkout                | `CHAPA_SECRET_KEY`          |
| Bank of Abyssinia   | Chapa hosted checkout                                    | `CHAPA_SECRET_KEY`          |

- Telebirr falls back to Chapa when only Chapa is configured. Any method with no
  gateway configured uses a built-in **sandbox** checkout page (also forced by
  `PAYMENTS_MOCK=true`), so the whole flow runs locally and in Docker with zero keys.
- Requests from the Mini App are authenticated by verifying Telegram `initData`
  against `BOT_TOKEN`; a wallet can only be credited after the gateway confirms.
- The house keeps `DEPOSIT_FEE_PERCENT` (default **2 %**) of every confirmed top-up: a
  100 ETB payment credits 98 ETB, the wallet screen shows the fee before paying, the
  ledger entry records `fee` and `credited`, and the fee lands in the house ledger
  (`GET /api/admin/house` lists round fees and deposit fees separately).
- Provider callbacks hit `<PUBLIC_URL>/api/payments/webhook/<method>`, so `PUBLIC_URL`
  must be the public HTTPS origin (ngrok in dev). nginx proxies `/api/` to the server.

API: `GET /api/payments/methods`, `GET /api/payments/wallet`,
`POST /api/payments/topup {method, amount}` → `{ref, checkoutUrl}`,
`GET /api/payments/:ref`, `POST /api/payments/webhook/:method`.

### Deposit by transfer + pasted receipt id

Besides the hosted checkout, players can pay the way most Ethiopian bingo apps work: the
wallet screen's **Transfer + receipt id** option shows the house's Telebirr / CBE Birr /
Bank of Abyssinia numbers with **COPY** buttons (`HOUSE_*_ACCOUNT` / `HOUSE_*_NAME`, also
editable in the dashboard *Settings → House accounts*), the player transfers the amount,
then pastes the **transaction id** from the receipt (a **PASTE** button reads the
clipboard). `POST /api/payments/deposit {method, amount, txId}` records it as a pending
deposit; an id can confirm one deposit only.

- **Telebirr** receipts are public (`transactioninfo.ethiotelecom.et/receipt/<id>`), so the
  server fetches the receipt and confirms automatically when it shows the id, the amount
  and the house number (`server/src/receipts.js`, best effort — anything unclear stays
  pending). Other banks are confirmed by the operator.
- The dashboard **Deposits** tab lists pending ids with a link to the Telebirr receipt and
  **Confirm** (credits the wallet minus the deposit fee, into the house ledger) or
  **Reject** with a reason (`GET /api/admin/deposits`, `POST /api/admin/deposits/:ref/approve|reject`).

### Cash-out (withdrawals)

- Players request a payout from the wallet screen: amount (`MIN_WITHDRAW`–`MAX_WITHDRAW`,
  default 50–5000 ETB), payout method (Telebirr, CBE Birr, Bank of Abyssinia) and the
  phone or account number. The amount is **held** from the wallet at once so it cannot
  be staked twice; `WITHDRAW_FEE_PERCENT` (default 0) is kept by the house on payout.
- Requests wait in an operator queue: `GET /api/admin/withdrawals?status=pending`, then
  `POST /api/admin/withdrawals/:ref/approve {providerRef}` after paying the player through
  the gateway's merchant tools, or `POST /api/admin/withdrawals/:ref/reject {reason}` to
  refund the hold. Players can cancel a pending request themselves
  (`POST /api/payments/withdraw/:ref/cancel`), which also refunds it.
- API: `POST /api/payments/withdraw {method, amount, account}` → the pending transaction.

### Admin dashboard

Open `<server>/api/admin/dashboard` (through nginx: `https://<your-host>/api/admin/dashboard`)
and enter `ADMIN_TOKEN`. The page shows summary tiles (house balance, pending cash-outs,
player balances, players, rounds, round / deposit fees, live tables), the **withdrawal
queue** with Approve (asks for the gateway transaction reference) and Reject (asks for
the reason shown to the player, refunds the hold) buttons, filterable by status, and the
**house ledger** (round fees, deposit fees, withdrawal fees), and a **players** tab
(search by id, name, phone or email; wallet, coins, games, wins, winnings, sign-up state,
last activity; click a row for the player's wallet ledger; **Suspend** with a reason and
an optional number of days, or a permanent ban when left empty, and **Reinstate**). A
suspended player is dropped from their table (an open stake is refunded), their sockets
are closed, the API answers 403 and the app shows the reason; the wallet is kept. Data
refreshes every 15 s. The **games** tab is the round history (last 5000 rounds kept):
finished time, room, stake, players, winner and cartela, result (full card / line / no
winner), prize, house fee, numbers called and length; searchable by room code, player id
or name; click a round for every player's cartela and marks. The **live tables** tab
lists every room in memory (public / private, stake, phase with countdown, seated and
picked players, pool, calls, current number; click for who is seated) with a **Close**
action that refunds open stakes and sends the players back to the lobby with a reason
(`GET /api/admin/rooms`, `POST /api/admin/rooms/:code/close {reason}`). The **settings**
tab edits fees (house cut, deposit fee, cash-out fee), top-up and cash-out limits, the
public stake list, Free Bingo coins, players per table and pacing (pick time, call
interval, restart pause). Saved values live in the server data file, override the `.env`
defaults, apply immediately (open tables pick up new fees and pacing; a running round
finishes on its rules) and survive restarts; *Reset* returns to `.env`
(`GET/PUT /api/admin/settings`, `POST /api/admin/settings/reset`). The **announcements**
tab broadcasts a message to all players: level (info / warning / promo), optional expiry
in hours, and an optional Telegram send to every registered Telegram player through the
bot API (throttled, with sent / failed counts). Players see it at once as a banner in
the lobby and at the table (dismissable per device) and on every later visit until it
expires or is removed (`GET/POST /api/admin/announcements`,
`DELETE /api/admin/announcements/:id`; players read `GET /api/announcements`).
Endpoints: `GET /api/admin/summary`, `GET /api/admin/house`, `GET /api/admin/rounds?q=&limit=`, `GET /api/admin/withdrawals`,
`POST /api/admin/withdrawals/:ref/approve|reject`, `GET /api/admin/players?q=`,
`GET /api/admin/players/:id/transactions`, `POST /api/admin/players/:id/suspend {reason, days}`,
`POST /api/admin/players/:id/unsuspend` — all with header `x-admin-token`.
  Automatic payouts (Telebirr B2C / Chapa transfers) can be wired into the approve step
  once merchant credentials for disbursements are available.

> Real-money games are regulated in Ethiopia (National Lottery Administration) and each
> gateway issues merchant credentials only under contract. Keep the sandbox for demos.

## Run with Docker

```bash
cp bot/.env.example bot/.env   # set BOT_TOKEN and WEBAPP_URL
docker compose up --build -d
```

- The Mini App is served by nginx at http://localhost:8080 with `/api/` proxied to the
  server. Expose it with `ngrok http 8080` and put that https URL in `WEBAPP_URL`
  (bot) and `PUBLIC_URL` (server).
- The bot container reads `bot/.env`; the server reads `bot/.env` plus `server/.env`.
  Both connect to the `postgres` service (`postgres-data` volume) — everything (wallets,
  transactions, profiles, bot users, the lot) lives there now, not in a per-container volume.
- Logs: `docker compose logs -f`. Stop: `docker compose down`.

## Backups

The server and bot tables share one Postgres database, so backing it up is one dump.
`scripts/backup.sh` and `scripts/restore.sh` wrap `pg_dump`/`pg_restore` (custom format,
compressed):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tgbingo ./scripts/backup.sh
# writes ./backups/tgbingo-<UTC timestamp>.dump

# restoring: always into an empty/new database, never on top of a live one
createdb -h <host> -U postgres tgbingo_restored
DATABASE_URL=postgresql://postgres:postgres@<host>:5432/tgbingo_restored \
  ./scripts/restore.sh backups/tgbingo-20260909T120000Z.dump
```

Restore has been tested end-to-end (dump `tgbingo_dev` → restore into a fresh database →
row counts and actual balances matched exactly, and the app's own `migrate()` ran cleanly
against the restored database). What's not yet decided is the operational side: how often
to run `backup.sh` and where the `.dump` files land — a managed Postgres provider's own
automated backups may make this script redundant, or this can run as a scheduled job
(cron, a CI schedule, a Railway/Render cron job) writing to S3/R2/etc. Whichever route is
used, actually run a restore periodically, not just the backup — an untested backup is not
a backup.

## Deploy on your own server (VPS + HTTPS)

One Linux host with Docker (any 1 GB VPS is enough), a domain, and ports 80/443 open. The
production overlay adds [Caddy](https://caddyserver.com) in front of the stack for
automatic Let's Encrypt HTTPS, hides the plain-http port, and sets the production URLs:

```bash
# on your machine (needs ssh + rsync); DNS A record for the domain must already point at the host
./scripts/deploy-vps.sh user@your-server bingo.example.com
```

The script syncs the checkout to `/opt/tg-bingo`, asks once for `BOT_TOKEN` and an
`ADMIN_TOKEN`, generates a Postgres password into `/opt/tg-bingo/.env`, then runs
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` and waits
for `https://bingo.example.com/api/health`. Re-run it after every change. Afterwards set
the Mini App URL in @BotFather (`/setmenubutton` → `https://bingo.example.com`) and, for
real payments, put the gateway credentials and `PAYMENTS_MOCK=false` in `server/.env` on
the host. Backups: `scripts/backup.sh` / `scripts/restore.sh` dump the bundled Postgres.

## Deploy for free (Render + Neon + Vercel)

Three free services, no credit card required anywhere: [Neon](https://neon.tech) for
Postgres, [Render](https://render.com) for the server + bot, [Vercel](https://vercel.com)
for the Mini App. What this costs you in exchange for free: Render's free web services
sleep after 15 minutes with no inbound traffic and take about a minute to wake back up on
the next request — fine for a game people open occasionally, noticeable if a room sits
idle mid-game. There's nothing to pay to remove that; it's Render's paid tier that keeps a
service always on.

**1. Database — Neon.** Create a project at [neon.tech](https://neon.tech) (no card
needed). Copy the connection string it gives you (starts `postgresql://...`) — that's your
`DATABASE_URL`. Unlike Render's own free Postgres, a Neon project never expires; it just
suspends compute between queries and resumes in a few hundred milliseconds, so it's safe to
leave as the permanent database.

**2. Server + bot — Render.** Push this repo to GitHub, then in the Render dashboard:
**New → Blueprint**, pick the repo. Render reads `render.yaml` at the repo root and creates
both `tg-bingo-server` and `tg-bingo-bot` as free web services. Fill in the prompted env
vars (or add them afterward from each service's *Environment* tab):

- `DATABASE_URL` — the Neon connection string, same value on both services.
- `BOT_TOKEN` — from @BotFather, same value on both services. **Rotate it first** if it was
  ever shared or pasted anywhere outside this repo — see the security note this doc/TODO.md
  already flags.
- `WEBAPP_URL` (bot) and `ALLOWED_ORIGINS` (server) — the webapp's Vercel URL from step 3
  below (so deploy the webapp first, or come back and fill these in after).
- `API_URL` (bot only) — `tg-bingo-server`'s own Render URL, e.g.
  `https://tg-bingo-server-xxxx.onrender.com`. Render free services can't reach each other
  over its private network (only paid services can *receive* private traffic), so this has
  to be the public URL — copy it from the server service's page after its first deploy.
- `ADMIN_TOKEN` — optional, needed only if you want the admin dashboard.

Nothing else to set: `PORT` and `RENDER_EXTERNAL_URL` are injected by Render automatically,
`PUBLIC_URL` (server) and webhook mode (bot) both fall back to `RENDER_EXTERNAL_URL` on
their own (see `server/src/config.js` and `bot/src/index.js`). The bot switches from
long-polling to Telegram **webhook** mode automatically whenever it's running on Render —
long-polling can't work on a host that sleeps the process, since nothing would ever be able
to wake a sleeping poller back up, but an incoming webhook request both delivers the update
and wakes the service.

**3. Mini App — Vercel.** Import the repo in Vercel, set **Root Directory** to `webapp`
(framework preset "Vite" should be auto-detected). Add one build-time environment variable:
`VITE_API_URL` = the server's Render URL from step 2 (same value as the bot's `API_URL`).
This is what lets the webapp call a server on a different origin than itself — without it,
the app assumes it's served from the same origin as the API (which is what docker-compose's
nginx does), and that assumption doesn't hold once the two are on separate hosts. Deploy,
then take the resulting `https://your-app.vercel.app` URL back to step 2's `WEBAPP_URL` /
`ALLOWED_ORIGINS` if you hadn't filled those in yet.

**4. Point the bot at itself in Telegram.** In @BotFather, `/setmenubutton` (or just send
`/start` to your bot) with the Vercel URL from step 3. Send `/start` — the bot should
register you and the **Play Bingo** button should open the game.

Everything above has been smoke-tested piece by piece in isolation (CORS allow/deny
behavior, the bot's webhook HTTP path end-to-end including Telegram's secret-token check,
the webapp build with and without `VITE_API_URL`) — see `TODO.md` for what's still a
judgment call for you rather than something to automate: which Postgres/hosting provider,
the backup schedule, and rotating the bot token.
