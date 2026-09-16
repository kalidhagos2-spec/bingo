import 'dotenv/config';

const env = (key, fallback = '') => (process.env[key] ?? fallback).trim();
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
  depositFeePercent: num('DEPOSIT_FEE_PERCENT', 2),
  /** House accounts players transfer to when depositing by receipt id (shown with a copy button). */
  houseAccounts: {
    telebirr: { account: env('HOUSE_TELEBIRR_ACCOUNT'), name: env('HOUSE_TELEBIRR_NAME') },
    cbebirr: { account: env('HOUSE_CBEBIRR_ACCOUNT'), name: env('HOUSE_CBEBIRR_NAME') },
    boa: { account: env('HOUSE_BOA_ACCOUNT'), name: env('HOUSE_BOA_NAME') },
  },
  /** Cash-outs: limits in ETB and the share kept by the house (0 = free). */
  minWithdraw: num('MIN_WITHDRAW', 50),
  maxWithdraw: num('MAX_WITHDRAW', 5000),
  withdrawFeePercent: num('WITHDRAW_FEE_PERCENT', 0),
  /** Smallest in-game wallet transfer between players, in ETB. */
  minTransfer: num('MIN_TRANSFER', 5),
  /** TEST ONLY: credit every transfer+receipt deposit at once, without checking the receipt. */
  autoApproveDeposits: bool('AUTO_APPROVE_DEPOSITS'),
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

  /** Multiplayer room rules; see game/room.js DEFAULT_RULES for defaults. */
  game: {
    minPlayers: num('MIN_PLAYERS', 2),
    maxPlayers: num('MAX_PLAYERS', 8),
    fullCard: bool('FULL_CARD', true),
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
