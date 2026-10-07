# Action plan: trust, retention, reliability, responsible play

Status of the six priorities from the competitor review. "Done" means implemented and covered by
unit tests that run without a database; DB-backed paths have tests in `server/test/responsible.test.js`
that need Postgres (`TEST_DATABASE_URL`) and have **not been run yet**.

| # | Priority | Status | Where |
|---|----------|--------|-------|
| 1 | **Provable fairness + round history** | Done | `server/src/game/bingo.js` (`newSeed`, `commitOf`, `drawOrderFromSeed`), `room.js` (seed per round, hash public from the start, revealed at the end), `store.publicRounds`, `GET /api/rounds[/:id]`, `webapp/src/components/History.jsx`, `webapp/src/lib/fair.js` (verifies in the player's browser) |
| 2 | **Demo players are visible** | Done (labelling) | `publicState().players[].demo`, bot tag in pick list and win popup, history. **Decision for the owner:** also restrict demo players to free tables, or remove them from paid tables. Labelling alone does not remove the legal risk. |
| 3 | **Retention** | Done | Daily bonus, missions, shop and leaderboard already existed (`economy.js`). Added: opt-in Telegram alert when a table starts (`notify.tableStarting`, at most one per player per 30 min, only for players who are away, can afford it and are not excluded) and invite links (`https://t.me/<BOT_USERNAME>?start=ref_<id>`): 100 coins to both sides after the friend's first deposit of 50+ (`referral.js`), max 20 friends rewarded per player. Needs `BOT_USERNAME` and `PUBLIC_URL` set. |
| 4 | **Speed & reliability** | Done (measured) | Lobby list only to lobby sockets; no 2x/second re-render during play; late joiners no longer seated at running tables; `room:state` broadcasts omit rules, `called` (while playing) and duplicate fields. `node server/scripts/loadtest.js 20 15` runs 160 real sockets: room:state 1310 -> 952 B/msg, total 342 -> 275 KB/s, ~1.7 KB/s per player, event-loop p99 ~25 ms (clients share the process, so this is pessimistic). Run it against your real host size before launch; it uses no database. |
| 5 | **Deposits & cash-outs** | Partly | Daily deposit limit (below), a cap of 5 unconfirmed deposits per player (`MAX_PENDING_DEPOSITS`), and a risk score with reasons on every pending deposit in the admin dashboard, riskiest first (`risk.js`; it ranks, never blocks). **Not done: more payment methods** - each rail needs the provider's merchant account and API credentials, which only you can obtain; the registry in `server/src/payments/` is where a new one plugs in. |
| 6 | **Responsible play** | Done | `server/src/limits.js`: self-set daily deposit limit (lower = immediate, raise/remove = after 24 h), self-exclusion 1/7/30 days (blocks tables and deposits, withdrawals stay open), one-time 18+ confirmation before paid tables. UI: Profile -> "Play responsibly"; 18+ prompt on first paid join. |

## Before going live
1. Run the DB-backed tests: start Postgres (`docker compose up postgres`) and `cd server && node --test`.
2. Apply the schema (runs on boot): new columns `rounds.seed`, `rounds.seed_commit`, `profiles.limits`, `profiles.prefs`. Set `BOT_USERNAME` (invite links) and `PUBLIC_URL` (button in table alerts).
3. Check licensing and each payment provider's rules for real-money bingo in your market.
4. Decide on demo players for paid tables (row 2).

## Next
- Add a payment rail once you have credentials (CBE Birr / Chapa methods are the closest to what is wired).
- Round history link inside the win popup.
- Tune the risk weights in `server/src/risk.js` after a few weeks of real deposits.
