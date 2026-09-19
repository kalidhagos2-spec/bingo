import { Router, json } from 'express';
import { houseAccounts } from './payments.js';

const NAME_MIN = 2;
const NAME_MAX = 32;
const PHONE_RE = /^\+?\d{7,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Lower-cased, trimmed email; null if invalid. Same rule as the bot's sign-up. */
export function normalizeEmail(text) {
  const email = String(text ?? '').trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/** Same rule as the bot: digits with optional +, Ethiopian local 09… numbers become +251…; null if invalid. */
export function normalizePhone(text) {
  const raw = String(text ?? '').replace(/[\s()-]/g, '');
  if (!PHONE_RE.test(raw)) return null;
  if (/^0\d{9}$/.test(raw)) return `+251${raw.slice(1)}`;
  return raw.startsWith('+') ? raw : `+${raw}`;
}

/** Id of another player's profile already holding this email, if any. */
function emailOwner(store, email, exceptId) {
  if (!email) return null;
  for (const [id, p] of Object.entries(store.data.profiles)) if (p.email === email && Number(id) !== exceptId) return Number(id);
  return null;
}

/** Public shape of a profile: stored fields merged with what Telegram tells us about the user. */
export function profileView(user, profile) {
  const stats = profile?.stats ?? { games: 0, wins: 0, winnings: 0 };
  return {
    id: user.id,
    name: profile?.name ?? [user.first_name, user.last_name].filter(Boolean).join(' ') ?? null,
    phone: profile?.phone ?? null,
    email: profile?.email ?? null,
    username: user.username ?? profile?.username ?? null,
    firstName: user.first_name ?? profile?.firstName ?? null,
    signedUpAt: profile?.signedUpAt ?? null,
    updatedAt: profile?.updatedAt ?? null,
    stats,
    complete: Boolean(profile?.name && profile?.phone),
  };
}

/**
 * /api/profile — the player profile the bot collects at sign-up, editable from the Mini App.
 * POST /sync is called by the bot (shared secret = BOT_TOKEN); the rest needs Telegram auth.
 */
export function profileRouter({ config, store, auth }) {
  const router = Router();

  router.post('/sync', json(), async (req, res) => {
    const token = req.get('x-bot-token') ?? '';
    const allowed = config.botToken ? token === config.botToken : config.devAllowAnon;
    if (!allowed) return res.status(401).json({ error: 'Bad bot token' });
    const { id, name, phone, email, username, firstName, lastName, signedUpAt } = req.body ?? {};
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'id required' });
    const taken = email && emailOwner(store, normalizeEmail(email), userId);
    if (taken) return res.status(409).json({ error: 'Email already used by another account' });
    // Phones are stored normalised (+251…) so transfers by phone number find the player.
    const profile = await store.setProfile(
      userId,
      clean({ name, phone: phone ? (normalizePhone(phone) ?? undefined) : phone, email: email ? normalizeEmail(email) ?? undefined : email, username, firstName, lastName, signedUpAt }),
    );
    res.json(profileView({ id: userId, first_name: firstName, last_name: lastName, username }, profile));
  });

  /**
   * What the bot's help commands show (/balance, /deposit, /withdraw): the player's wallet and
   * the current house accounts, limits and fees. Same shared-secret check as /sync.
   */
  router.get('/bot/:id', (req, res) => {
    const token = req.get('x-bot-token') ?? '';
    const allowed = config.botToken ? token === config.botToken : config.devAllowAnon;
    if (!allowed) return res.status(401).json({ error: 'Bad bot token' });
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'id required' });
    res.json({
      balance: store.balance(userId),
      currency: config.currency,
      deposit: { min: config.minTopup, max: config.maxTopup, feePercent: config.depositFeePercent, accounts: houseAccounts(config) },
      withdraw: { min: config.minWithdraw, max: config.maxWithdraw, feePercent: config.withdrawFeePercent },
      game: { stakes: config.stakes, maxCartelas: config.game.maxCartelas, cartelaCount: config.game.cartelaCount, maxPrize: config.game.maxPrize, countdownMs: config.game.countdownMs },
    });
  });

  router.get('/leaderboard', (_req, res) => {
    res.json({ leaders: store.leaderboard(10) });
  });

  router.use(auth);

  router.get('/', (req, res) => {
    res.json(profileView(req.user, store.profile(req.user.id)));
  });

  router.put('/', json(), async (req, res) => {
    const patch = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (name.length < NAME_MIN || name.length > NAME_MAX) return res.status(400).json({ error: `Name must be ${NAME_MIN}–${NAME_MAX} characters` });
      patch.name = name;
    }
    if (req.body?.phone !== undefined) {
      const text = String(req.body.phone).trim();
      if (text === '') patch.phone = null;
      else {
        const phone = normalizePhone(text);
        if (!phone) return res.status(400).json({ error: 'Phone must be 7–15 digits, e.g. +251900000000' });
        patch.phone = phone;
      }
    }
    if (req.body?.email !== undefined) {
      const text = String(req.body.email).trim();
      if (text === '') patch.email = null;
      else {
        const email = normalizeEmail(text);
        if (!email) return res.status(400).json({ error: 'Enter a valid email address' });
        if (emailOwner(store, email, req.user.id)) return res.status(409).json({ error: 'Email already used by another account' });
        patch.email = email;
      }
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Nothing to update' });
    const existing = store.profile(req.user.id);
    const after = { ...existing, ...patch };
    if (!existing?.signedUpAt && after.name && after.phone) patch.signedUpAt = new Date().toISOString();
    const profile = await store.setProfile(req.user.id, patch);
    res.json(profileView(req.user, profile));
  });

  return router;
}
