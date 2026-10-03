# USA Bingo — Telegram Mini App

Brand: the **USA Bingo** logo (stars-and-stripes "USA", gold "BINGO", five lettered
balls). Drop the artwork at `webapp/public/logo.png` and the app uses it on the splash
screen, the lobby banner and the card-grid tile; without the file a CSS version of the
same lockup is rendered. Colours: flag navy surfaces, flag red alerts, gold highlights,
and the ball colours for the B I N G O columns (red, blue, yellow, green, purple).

A production-style project that brings classic Bingo to Telegram using
[Telegram Mini Apps](https://core.telegram.org/bots/webapps). Users register via a
Telegram bot, press **Play**, and are taken to an interactive Bingo game built with
React and Tailwind CSS.

## Roadmap

- ✅ Bot onboarding, sign-up (name · phone) & Mini App launch
- ✅ Backend (Node.js / Express) with wallet + Ethiopian payment gateways
- ✅ Live tables hosted by the house (Socket.io), cartelas, BINGO! claims, prize pools
- ✅ Missions and a coin shop with cartela skins
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
│   ├── src/routes/    payments, profile, economy, admin (house)
│   ├── src/economy.js missions · shop rules
│   ├── src/auth.js (Telegram initData), store.js, realtime.js
│   ├── src/db/        schema.sql + pool.js (PostgreSQL — shared with the bot)
│   ├── scripts/       one-off import of an old server/data/payments.json, if you have one
│   └── test/          node --test suites (run against a real Postgres test database)
└── webapp/     Mini App (React + Vite + Tailwind CSS v4)
    └── src/
        ├── App.jsx                 screen routing
        ├── components/             Game (lobby · pick · table), Wallet, Profile, Missions, Shop
        ├── hooks/useTelegram.js    Telegram WebApp SDK wrapper (ready/expand/haptics)
        └── lib/                    api, socket, sound, themes (cartela skins)
```

## Features

**Bot**
- `/start` registers the user by Telegram ID and, the first time, walks them through a
  two-step **sign-up**: first their **username** (their Telegram @username and name are
  offered as one-tap buttons, or they type their own; editable later on the Profile
  screen), then their **phone number** (Telegram *share contact* button, typed number,
  or *Skip for now*). The phone is what deposits,
  cash-outs and player-to-player transfers are matched on. The flow is a small state
  machine in `bot/src/signup.js` (unit-tested with `npm test`).
- The collected fields are pushed to the game server (`POST /api/profile/sync`, signed
  with the bot token) so the Mini App's **Profile** screen shows and edits the same
  data, and players appear in rooms under their chosen display name.
- **Play Bingo** button opens the Mini App via a `web_app` button (HTTPS required)
- `/play`, `/profile` (view · edit · finish sign-up) and **How to play** actions

**Mini App**
- **Lobby** (home screen): logo banner, coin / ETB / name pills, colourful game cards
  (10 / 20 / 50 ETB) with entry, "Prize up to `MAX_PRIZE`" and live status plus a
  **JOIN** button (**DEPOSIT** while the balance is below the stake), a leaderboard, and a Missions ·
  Shop · Profile bottom bar. Players who have not finished sign-up see a *Finish your
  sign-up* banner and a badge on **Profile**.
- **Missions and Shop** (coins, a soft currency that never converts to ETB): **Missions**
  are daily goals fed by real play (play 3 rounds, win a round, mark 50 numbers, play a
  paid table) with coin rewards; the **Shop** sells cartela skins (Emerald, Sunset, Neon,
  Gold — applied to your card in every game). API: `GET /api/economy`,
  `POST /api/economy/missions/:id/claim`, `POST /api/economy/shop/:id/buy`,
  `POST /api/economy/theme/:theme`. There is no daily bonus card any more.
- **Loading screen.** The Mini App opens on a branded splash (logo, bingo ball, spinner)
  for about a second while the game connects underneath it.
- **Demo players** (`DEMO_BOTS=6`, 0 = off; `server/src/demoBots.js`). House bots with random
  names and play-money wallets (`DEMO_BOTS_MIN_BALANCE`–`DEMO_BOTS_MAX_BALANCE` ETB, topped up
  when low) that sit at the public tables and play like people: they join real players who
  are waiting first, pick 1–3 cartelas a few seconds apart, mark called numbers after a
  human-like delay, call BINGO, and stay or wander off between rounds. At most
  `DEMO_BOTS_PER_ROOM` per table, and half of them stay free for real players. They have
  negative ids, so they can never log in, deposit or cash out, and they carry a **DEMO** tag in
  the operator dashboard. **A real player never loses money to one:** when a demo player wins a
  paid round, the real players' stakes for that round are refunded. A real player can win the
  pool demo players paid into; the house pays that difference (booked as a negative house
  take), so keep the number low, or 0, once real money is live.
  Table size: `DEMO_BOTS_PER_ROOM=30` fills every table to 30 players in all (real players count
  towards it; set `MAX_PLAYERS` a few above, e.g. 34, so real players always find a seat). There is
  one demo table per stake, and one table's worth of demo players stays free to fill a table a
  real player opens, so `DEMO_BOTS` should be about (stakes + 1) × table size, e.g. 120.
  **Operator settings (Admin → Settings, applied live, no restart):** *Demo players in all*
  (`0` = off, `200`, or a range `150-200`), *Players each game is filled to* (`50`, a range
  `40-50`, or per table stake `10=50,20=40,50=30`) and *Demo win rate* (`0`–`0.95`, also per
  table: `10=0.5,50=0.9`), which works only through how many cartelas demo players buy. The
  **Prize** group holds the house cut (%) and the largest prize of one round. The `.env` values
  (`DEMO_BOTS`, `DEMO_BOTS_PER_ROOM`, `DEMO_BOTS_SHARE`, `HOUSE_CUT_PERCENT`, `MAX_PRIZE`) are
  the defaults the dashboard starts from.
  Names are Ethiopian given names in Latin or Ge'ez script, many with an emoji (`randomName`).
  `DEMO_BOTS_SHARE=0.9` makes demo players hold about nine cartelas for each one a real player
  holds at the same table, so they win about nine rounds in ten there. It works only through
  how many cartelas they buy: the draw, the marks and the BINGO check are never touched.
  In **Admin → Games** every round shows *Stakes* (stake × every cartela in the pool, with the
  demo share underneath), *Prize* (stakes less the house cut) and *House* (real money only). A
  player who leaves mid-round forfeits the stake but stays in the round's record ("left
  mid-round"), and is refunded like everyone else if a demo player, or nobody, wins.
- **Every win is proven by the balls.** A BINGO claim is accepted only when every number of the
  winning line was called (checked against the balls themselves, not just the marks). Each round
  stores the balls in calling order (`rounds.called`) and the winning numbers (`winner.numbers`);
  **Admin → Games** shows them with the call each came out on, and the win screen shows players
  the winning numbers and the call the game ended on.
- **The game ends on the ball that won it.** When a ball completes a winning pattern on any cartela
  in play, the caller holds the next ball for `CLAIM_WINDOW_MS` (6 s) longer, as a hall caller
  does, so the BINGO is pressed before another ball comes out. A late BINGO is still paid; the
  round record names the true winning ball (`winner.ball`, `winner.ballCall`) and Admin → Games
  shows whether it was the last ball. `webapp/scripts/e2e-two-players.mjs` plays a paid round
  between two players against a dev server and prints the money and the winning ball.
- **A blank board between rounds.** The previous round's numbers are cleared when registration
  re-opens, so the board behind the countdown never looks like the draw to come. (The draw
  order exists only on the server and is never sent to phones.)
- **Call-outs in Amharic.** Every called number is spoken in Amharic, letter first
  ("ቢ፣ አስራ ሁለት" for B-12), from 75 recorded clips in `webapp/public/audio/am/` (about
  0.8 MB, fetched in the background when a player sits down, then cached for a month).
  Clips rather than the phone's speech engine, because most phones have no Amharic voice.
  The 🔊 button on the table cycles **አማ → EN → mute**; EN uses the phone's English
  speech, which is also the fallback if a clip cannot be played. To change the voice
  (female `am-ET-MekdesNeural` by default, male `am-ET-AmehaNeural`), speed or wording:
  `uv run --no-project --with edge-tts python webapp/scripts/make_amharic_audio.py --voice …`.
- **Sign-in.** Players are identified by Telegram `initData` (verified against
  `BOT_TOKEN` on every API call and socket handshake). There is no separate login: the
  game is played from inside Telegram. Outside Telegram only dev mode (`DEV_ALLOW_ANON`)
  serves guest players, for local testing.
- **Profile** screen: avatar, display name and phone (editable, `PUT /api/profile`),
  Telegram username and id, sign-up status, stats (games, wins, ETB won) that the
  server records at the end of every round (`GET /api/profile/leaderboard`), and a
  **Log out & close** button that forgets the device's preferences and closes the Mini
  App (the account itself is the Telegram account).
- **Send** screen (bottom bar): in-game wallet transfer to another player by the phone
  number they signed up with. The recipient's name is shown before sending
  (`GET /api/payments/recipient?phone=`), the money moves instantly and fee-free
  (`POST /api/payments/transfer {phone, amount}`, minimum `MIN_TRANSFER`, default 5 ETB),
  both wallets get a `transfer` ledger row and a live balance push over the socket.
- `AUTO_APPROVE_DEPOSITS=true` (test only) credits every transfer+receipt deposit at once
  without checking the receipt; the server logs a warning at startup while it is on.
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
- **Cartelas.** While registration is open every player picks up to `MAX_CARTELAS`
  (default **4**) numbered cartelas out of `CARTELA_COUNT` (default **400**). Each number
  is a fixed card, so cartela #17 is the same card everywhere. The 10-column grid shows
  taken numbers in red with the owner's name, yours in green; tapping one of yours gives
  it back. On a paid table every cartela is charged from the wallet when picked and
  refunded when released or if you leave before the round starts. During the round the
  layout depends on how many you hold: with one or two, the 75-number master board sits
  on the left and your cards on the right; with three or four, the board is dropped and
  the cards fill the screen in a 2×2 grid under a slim call strip. Tapping a called
  number marks it on every card of yours that has it, and the **AUTO** switch in the
  bottom bar (on by default, remembered per device) marks called numbers for you. BINGO!
  wins on whichever card is complete. Players without a cartela watch the round and can
  register for the next one.
- **Timer.** Once `MIN_PLAYERS` players hold a cartela a **40 s** countdown starts
  (`COUNTDOWN_MS`). The **house hosts every table**: the server starts the round when the
  timer ends and calls the numbers; no player can start or control a game. **Start Game** takes you to the
  board where an overlay counts down the remaining seconds and shows the growing prize.
- **Game screen.** Prize / call number / players tiles on top, the 75-number board on
  the left (called numbers red, latest green), your cartela with the **CALL** box on the
  right, and a LEAVE · REFRESH · **BINGO!** · sound bar at the bottom. The server calls
  a number every 4 s and validates each mark (called and on your card).
- **Winning.** Press **BINGO!** as soon as one of your cartelas has a complete row, column
  or diagonal (`LINES_TO_WIN`, default 1) or all **four corners** marked. `FULL_CARD=true`
  switches to the stricter rule of every number on the card. A premature claim is
  rejected with your progress; the winner modal shows the winning line or corners. The winner gets the pool: stakes minus
  `HOUSE_CUT_PERCENT`, capped at `MAX_PRIZE` (default **3000 ETB**) — the house keeps
  **20 %** of every player's stake by default (not shown to players) and the
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

- Telebirr falls back to Chapa when only Chapa is configured. A method with no gateway
  credentials is not offered for online checkout. Deposits by **transfer + receipt id**
  to the `HOUSE_*_ACCOUNT` numbers need no gateway at all, so that is the default way
  to fund a wallet; there is no sandbox or mock gateway.
- Requests from the Mini App are authenticated by verifying Telegram `initData`
  against `BOT_TOKEN`; a wallet can only be credited after the gateway confirms.
- Deposits are credited in full by default (`DEPOSIT_FEE_PERCENT=0`); the house fee is
  taken on cash-outs instead (`WITHDRAW_FEE_PERCENT`, default **2 %**). If a deposit fee
  is set, the house keeps that share of every confirmed top-up: a
  100 ETB payment credits 98 ETB, the wallet screen shows the fee before paying, the
  ledger entry records `fee` and `credited`, and the fee lands in the house ledger
  (`GET /api/admin/house` lists round fees and deposit fees separately).
- Provider callbacks hit `<PUBLIC_URL>/api/payments/webhook/<method>`, so `PUBLIC_URL`
  must be the public HTTPS origin (ngrok in dev). nginx proxies `/api/` to the server.

API: `GET /api/payments/methods`, `GET /api/payments/wallet`,
`POST /api/payments/topup {method, amount}` → `{ref, checkoutUrl}`,
`GET /api/payments/:ref`, `POST /api/payments/webhook/:method`.

### Deposit by transfer + pasted receipt id

This is the default way to fund a wallet and works the way most Ethiopian bingo apps do:
the wallet's **Deposit** tab shows a **Bank accounts** grid of the house's Telebirr
accounts (up to two, plus Bank of Abyssinia if configured), each card with the account
name, number and a **COPY** button (`HOUSE_*_ACCOUNT` / `HOUSE_*_NAME`, comma-separated
lists; the dashboard *Settings → House accounts* edits them as "Telebirr account 1 / 2"
number and holder-name fields). The player copies
a number, transfers the amount, then pastes the **transaction id** from the receipt (a
**PASTE** button reads the clipboard). `POST /api/payments/deposit {method, account,
amount, txId, payerPhone?, payerName?}` records it as a pending deposit; an id can confirm
one deposit only. The optional phone the player sent from and the name on the receipt are
stored with the deposit and shown under the player in the admin Deposits tab, so a
transfer with a mistyped id can still be matched by hand.
Telebirr receipts are checked against Ethio Telecom's public receipt page at submit time
and then re-checked every `RECEIPT_RECHECK_MS` (default 3 min) for `RECEIPT_RECHECK_HOURS`
(default 24 h), so a receipt that is published a little later still credits the wallet
without anyone touching it; the dashboard also has a **Verify** button per deposit
(`POST /api/admin/deposits/:ref/verify`). The Deposits tab shows the player's name and
which house account (with its name) the money went to.

Cash-outs are approved in the dashboard; see **Cash-out (withdrawals)** below for how
the money is sent. When
no house account is configured the tab says deposits open soon. Paid tables in the lobby
show **DEPOSIT** instead of **JOIN** while the balance is below the stake, and that
button opens this tab with the missing amount pre-filled. Online checkout (**Pay online**)
appears alongside only when a gateway is configured.

- **Telebirr** receipts are public (`transactioninfo.ethiotelecom.et/receipt/<id>`), so the
  server fetches the receipt and confirms automatically when it shows the id, the amount
  and the house number (`server/src/receipts.js`, best effort — anything unclear stays
  pending). Other banks are confirmed by the operator.
- The dashboard **Deposits** tab lists pending ids with a link to the Telebirr receipt and
  **Confirm** (credits the wallet minus the deposit fee, into the house ledger) or
  **Reject** with a reason (`GET /api/admin/deposits`, `POST /api/admin/deposits/:ref/approve|reject`).

### Cash-out (withdrawals)

- Players request a payout from the wallet screen: amount (`MIN_WITHDRAW`–`MAX_WITHDRAW`,
  default 50–5000 ETB) and the Telebirr phone number to pay out to (`PAYOUT_METHOD`
  limits the rail; Telebirr by default). The amount is **held** from the wallet at once so it cannot
  be staked twice; `WITHDRAW_FEE_PERCENT` (default 2 %) is kept by the house on payout.
- Requests wait in the operator queue (`GET /api/admin/withdrawals?status=pending`) until
  the operator presses **Approve** in the dashboard. Players can cancel a pending request
  themselves (`POST /api/payments/withdraw/:ref/cancel`), which refunds the hold.
- **Who sends the money** is `PAYOUT_PROVIDER` (`server/src/payouts/`):
  - `none` (default): the operator pays by hand from `PAYOUT_ACCOUNT` and enters the Telebirr
    transaction id; the server checks the public receipt (id, net amount, the player's number)
    before marking it paid, or the operator overrides with *force*.
  - `chapa`: **Chapa Transfers** send it to the player's Telebirr wallet or bank account
    (`CHAPA_SECRET_KEY`; bank ids from `GET /v1/banks`, or `CHAPA_BANK_CODE_*`). Transfers are
    asynchronous: Chapa queues them, and the result comes from its verify endpoint and from the
    payout webhook, which must point at `<PUBLIC_URL>/api/payments/payout-webhook/chapa`
    (`CHAPA_WEBHOOK_SECRET`). Chapa may refuse outside its transfer hours (Mon–Sat 08:30–16:30);
    such a cash-out goes back to pending with the message, and Approve later is the retry.
  - `sandbox`: a simulated gateway for rehearsals (no money moves; the dashboard says so). The
    last two digits of the account choose the outcome, see `server/.env.example`.
  - `telebirr`: the unverified Telebirr B2C stub (`TELEBIRR_B2C_URL` + merchant credentials).
- **What Approve does with a gateway.** The row is moved `pending → processing` under a row
  lock first, then the gateway is asked to send *once*: a second click, or two operators, get
  "Withdrawal already processing" instead of a second payment. A refusal that created nothing
  fails the cash-out (hold refunded) or, if it was only "try later", puts it back to pending; a
  timeout leaves it `processing` and nothing is ever re-sent. The **payout watcher** then asks
  the gateway every `PAYOUT_CHECK_MS` (default 60 s) until it answers paid (fee booked to the
  house) or failed (hold refunded); after `PAYOUT_GIVE_UP_HOURS` (48) a still-unanswered one is
  flagged *stale* for a person. A webhook only triggers that same status check, never settles
  by itself. Cash-outs above `MAX_AUTO_PAYOUT` (dashboard: Settings → Cash-outs) ask the
  operator to confirm before the gateway is used.
- The player is told at once: the open Mini App refreshes its wallet (`wallet:update`), and the
  bot sends a Telegram message in Amharic and English when a cash-out is paid, failed or rejected.
- Statuses: `pending` → `processing` (sending) → `paid` | `failed` (refunded); `rejected`
  (operator) and `cancelled` (player) also refund.
- API: `POST /api/payments/withdraw {method, amount, account}` → the pending transaction;
  admin `POST /api/admin/withdrawals/:ref/approve {providerRef?, force?}` (no `providerRef` =
  send through the gateway; 202 while processing, 409 `confirmRequired` above the limit, 409
  `retryable` when the gateway says try later), `…/reject {reason}`, `…/check` (ask the gateway
  now), `…/fail {reason}` (the operator, having checked with the gateway, declares it not paid:
  refund); public `POST /api/payments/payout-webhook/:provider`.

### Admin dashboard

Open `<server>/api/admin/dashboard` (through nginx: `https://<your-host>/api/admin/dashboard`)
and enter `ADMIN_TOKEN`. The page shows summary tiles (house balance, pending cash-outs,
player balances, players, rounds, round / deposit fees, live tables), the **withdrawal
queue** with **Send via <gateway>** (when one is configured; shown in the tab header),
**Paid by hand** / **Approve** (asks for the transaction id of a payout you made yourself),
**Reject** (asks for the reason shown to the player, refunds the hold), and on a cash-out that
is being sent **Check status** and **Mark failed**, filterable by status, and the
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
`POST /api/admin/players/:id/unsuspend`, `POST /api/admin/players/:id/adjust {amount, reason}` — all with
header `x-admin-token`. **Adjust balance** (Players tab) credits (+) or debits (−) a wallet by hand for
refunds, goodwill credits and clawbacks: a reason is required and shown in the player's wallet
history, a debit can never take the balance below zero, one adjustment is limited to 50,000, and
every one is written to the player's ledger (type `adjustment`) and to the house ledger as an audit
row (the house fee balance itself is not changed).

> Real-money games are regulated in Ethiopia (National Lottery Administration) and each
> gateway issues merchant credentials only under contract.

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
deposits, put the `HOUSE_*_ACCOUNT` numbers (and any gateway credentials) in `server/.env`
on the host. Backups: `scripts/backup.sh` / `scripts/restore.sh` dump the bundled Postgres.

## Deploy on Render

Two Render services, described by `render.yaml`:

- **usabingo**: the game server **and** the Mini App in one image (`Dockerfile.render`). One
  URL serves players, the API, the websocket and the admin dashboard, so there is no CORS,
  no `VITE_API_URL` and no separate web host to keep in step.
- **usabingo-bot**: the Telegram bot. On Render it switches from long polling to **webhook**
  mode by itself (a sleeping service cannot poll, but a webhook request wakes it).

**1. Database.** Create a project at [neon.tech](https://neon.tech) (free, no card) and copy
its connection string (`postgresql://…`): that is `DATABASE_URL`. Do not use Render's own
*free* Postgres for this: it is deleted after 30 days, and the wallets live in it. A paid
Render database is fine.

**2. Code on GitHub.** Render builds from a Git repository:

```bash
git push -u origin feature/telebirr-deposits-multi-cartela
```

The repository may be private: Render asks for access to it when you connect GitHub.

**3. Blueprint.** [dashboard.render.com/blueprints](https://dashboard.render.com/blueprints) →
**New Blueprint Instance** → pick the repository and the branch you pushed. Render reads
`render.yaml` and asks for:

| Value | Where | What to enter |
|---|---|---|
| `DATABASE_URL` | both services | the Neon connection string |
| `BOT_TOKEN` | both services | from @BotFather |
| `ADMIN_TOKEN` | usabingo | a long random secret: the password of the admin dashboard |
| `HOUSE_TELEBIRR_ACCOUNT`, `HOUSE_TELEBIRR_NAME` | usabingo | the Telebirr numbers players pay into and the names on them, comma separated |
| `PAYOUT_ACCOUNT`, `PAYOUT_NAME` | usabingo | the Telebirr account cash-outs are paid from |
| `WEBAPP_URL`, `API_URL` | usabingo-bot | leave empty for now (step 4) |
| `SUPPORT_USERNAME`, `CHANNEL_USERNAME` | usabingo-bot | optional, shown by `/contact` |

**4. Give the bot the game's URL.** When **usabingo** has deployed, copy its URL from its page
(`https://usabingo-xxxx.onrender.com`) into **both** `WEBAPP_URL` and `API_URL` of
**usabingo-bot** (Environment tab) and save: the bot redeploys. Send `/start` to the bot;
**Play Bingo** opens the game from Render. The admin dashboard is
`https://usabingo-xxxx.onrender.com/api/admin/dashboard`.

**Android install.** After deploying the latest web app, open its HTTPS URL in Chrome on an
Android phone and choose **Install app** (or **Add to Home screen**) from the browser menu.
The installed PWA is a home-screen shortcut to the game; sign in and play from the Telegram
bot's **Play Bingo** button, since the game uses Telegram Mini App authentication.

**5. Moving players over (optional).** Wallets and players live in the database. To carry the
local ones to Neon: `docker exec tg-bingo-postgres pg_dump -U postgres --no-owner tgbingo >
tgbingo.sql`, then `psql "<DATABASE_URL>" < tgbingo.sql` before the first deploy. Stop the
local bot afterwards (`docker compose stop bot`): one bot token cannot serve two bots.

**Plans.** On the `free` plan a service sleeps after 15 minutes without traffic and takes
about a minute to wake. Tables live in memory, so a sleeping server has no running games
(stakes of an unfinished round are refunded on shutdown) and demo players stop too. For real
play put **usabingo** on `starter`; the bot can stay free.

`Dockerfile.render` is tested locally the way Render runs it (its own `PORT`, no nginx in
front): the page, hashed assets, Amharic clips, SPA routes, `/api`, the websocket and the
dashboard are all served, and `webapp/scripts/e2e-two-players.mjs` plays a paid round
against it. `docker-compose.yml` is unchanged and still uses nginx + the separate images.
