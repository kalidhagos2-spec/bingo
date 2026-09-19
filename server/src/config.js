import 'dotenv/config';

const env = (key, fallback = '') => (process.env[key] ?? fallback).trim();
/** "25" -> { count: 25, minCount: 25 }; "20-30" -> { count: 30, minCount: 20 }; anything else -> off. */
export const demoRange = (text) => {
  const [a, b = a] = String(text).split('-').map((s) => Number.parseInt(s.trim(), 10));
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return { count: 0, minCount: 0 };
  return { count: Math.max(a, b), minCount: Math.min(a, b) };
};

const num = (key, fallback) => {
  const raw = env(key);
  if (raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
};
const bool = (key, fallback = false) => env(key, String(fallback)).toLowerCase() === 'true';

const botToken = env('BOT_TOKEN');
// RENDER_EXTERNAL_URL is set automatically by Render for every web service (its own public
// https:// URL), so this needs no manual entry there; PUBLIC_URL/WEBAPP_URL still win when set.
const publicUrl = (env('PUBLIC_URL') || env('WEBAPP_URL') || env('RENDER_EXTERNAL_URL')).replace(/\/+$/, '');

export const config = {
  port: num('PORT', 3000),
  botToken,
  publicUrl,
  currency: 'ETB',
  minTopup: num('MIN_TOPUP', 10),
  maxTopup: num('MAX_TOPUP', 5000),
  /** Share of every wallet top-up kept by the house. */
  depositFeePercent: num('DEPOSIT_FEE_PERCENT', 0),
  /** House accounts players transfer to when depositing by receipt id (shown with a copy button). */
  houseAccounts: {
    telebirr: { account: env('HOUSE_TELEBIRR_ACCOUNT'), name: env('HOUSE_TELEBIRR_NAME') },
    cbebirr: { account: env('HOUSE_CBEBIRR_ACCOUNT'), name: env('HOUSE_CBEBIRR_NAME') },
    boa: { account: env('HOUSE_BOA_ACCOUNT'), name: env('HOUSE_BOA_NAME') },
  },
  /**
   * Cash-outs are paid out by the operator from this house account (shown to players on
   * the Cash out tab and to the operator in the dashboard). PAYOUT_METHOD limits which
   * rail players can be paid on; empty = every rail.
   */
  payout: {
    method: env('PAYOUT_METHOD', 'telebirr'),
    account: env('PAYOUT_ACCOUNT'),
    name: env('PAYOUT_NAME'),
  },
  /** Cash-outs: limits in ETB and the share kept by the house (0 = free). */
  minWithdraw: num('MIN_WITHDRAW', 50),
  maxWithdraw: num('MAX_WITHDRAW', 5000),
  withdrawFeePercent: num('WITHDRAW_FEE_PERCENT', 2),
  /** Smallest in-game wallet transfer between players, in ETB. */
  minTransfer: num('MIN_TRANSFER', 5),
  /** TEST ONLY: credit every transfer+receipt deposit at once, without checking the receipt. */
  autoApproveDeposits: bool('AUTO_APPROVE_DEPOSITS'),
  /** Pending Telebirr deposits are re-checked against the public receipt this often, for this long. */
  receiptRecheckMs: num('RECEIPT_RECHECK_MS', 180_000),
  receiptRecheckHours: num('RECEIPT_RECHECK_HOURS', 24),
  // Without a bot token initData cannot be verified, so anonymous dev access is implied.
  devAllowAnon: bool('DEV_ALLOW_ANON') || !botToken,
  /** PostgreSQL connection string; see server/.env.example. */
  databaseUrl: env('DATABASE_URL'),
  /**
   * Origins allowed to call the API / connect the Socket.io game from a *different* origin
   * than this server -- e.g. a webapp deployed separately (Vercel/Netlify/Render Static Site)
   * instead of behind the same nginx reverse proxy as in docker-compose. Comma-separated,
   * empty by default so same-origin deployments (the docker-compose setup) don't need it and
   * behave exactly as before -- no CORS headers, no cross-origin surface.
   */
  allowedOrigins: env('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),
  /** Operator access to /api/admin (house ledger). Empty = open in dev mode only. */
  adminToken: env('ADMIN_TOKEN'),

  /**
   * Demo players: house bots with random names and play-money wallets that join the public
   * tables and play like people (see demoBots.js). 0 = off. A real player never loses money
   * to one: when a demo player wins a paid round the real players' stakes are refunded.
   */
  demoBots: {
    // A number ("6") or a range ("20-30"): with a range, how many are around drifts at random
    // between the two, like a real crowd through the day.
    ...demoRange(env('DEMO_BOTS', '0')),
    minBalance: num('DEMO_BOTS_MIN_BALANCE', 50),
    maxBalance: num('DEMO_BOTS_MAX_BALANCE', 500),
    /** Players a table is filled to. A range ("20-30") gives every table its own random size, drawn anew each round. */
    perRoom: demoRange(env('DEMO_BOTS_PER_ROOM', '3')).count,
    minPerRoom: demoRange(env('DEMO_BOTS_PER_ROOM', '3')).minCount,
    /** Share of the cartelas at a table with real players that demo players aim to hold: 0.9 = 9 to 1. 0 = off. */
    share: num('DEMO_BOTS_SHARE', 0),
  },

  /** Multiplayer room rules; see game/room.js DEFAULT_RULES for defaults. */
  game: {
    minPlayers: num('MIN_PLAYERS', 2),
    maxPlayers: num('MAX_PLAYERS', 8),
    fullCard: bool('FULL_CARD', false),
    linesToWin: num('LINES_TO_WIN', 1),
    callIntervalMs: num('CALL_INTERVAL_MS', 4000),
    countdownMs: num('COUNTDOWN_MS', 40000),
    restartDelayMs: num('RESTART_DELAY_MS', 8000),
    cartelaCount: num('CARTELA_COUNT', 400),
    /** Cartelas one player may hold per round (each pays the stake). */
    maxCartelas: num('MAX_CARTELAS', 4),
    houseCutPercent: num('HOUSE_CUT_PERCENT', 20),
    /** Ceiling on any round's prize; the lobby advertises "prize up to" this amount. */
    maxPrize: num('MAX_PRIZE', 3000),
    freeBingoCoins: num('FREE_BINGO_COINS', 50),
  },
  /** Public tables offered in the lobby, one per stake in ETB (a 0 entry would add a free table). */
  stakes: [...new Set(env('STAKES', '10,20,50').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 0))],

  telebirr: {
    appId: env('TELEBIRR_APP_ID'),
    appKey: env('TELEBIRR_APP_KEY'),
    publicKey: env('TELEBIRR_PUBLIC_KEY'),
    shortCode: env('TELEBIRR_SHORT_CODE'),
    receiveName: env('TELEBIRR_RECEIVE_NAME', 'Telegram Bingo'),
    baseUrl: env('TELEBIRR_BASE_URL', 'https://app.ethiomobilemoney.et:2121').replace(/\/+$/, ''),
    /** Disbursement (B2C) endpoint from your Telebirr merchant contract; empty = cash-outs are paid by hand. */
    b2cUrl: env('TELEBIRR_B2C_URL'),
  },

  chapa: {
    secretKey: env('CHAPA_SECRET_KEY'),
    webhookSecret: env('CHAPA_WEBHOOK_SECRET'),
    baseUrl: env('CHAPA_BASE_URL', 'https://api.chapa.co').replace(/\/+$/, ''),
  },
};

/** Absolute URL for a payment route, used for provider return and webhook URLs. */
export function paymentUrl(path) {
  return `${config.publicUrl}/api/payments${path}`;
}
