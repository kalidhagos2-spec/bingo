import { Router, json } from 'express';
import { requestCode, verifyCode, logout } from '../emailAuth.js';

/** /api/auth — email login (one-time code -> session token) and the current user. */
export function authRouter({ store, mailer, auth }) {
  const router = Router();

  router.post('/email/request', json(), async (req, res) => {
    try {
      const { email, code } = await requestCode(store, req.body?.email);
      const { sent, devCode } = await mailer.sendLoginCode(email, code);
      res.json({ ok: true, email, sent, ...(devCode ? { devCode } : {}) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/email/verify', json(), async (req, res) => {
    try {
      res.json(await verifyCode(store, req.body?.email, req.body?.code));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/logout', async (req, res) => {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    res.json({ ok: scheme?.toLowerCase() === 'bearer' && (await logout(store, token)) });
  });

  router.get('/me', auth, (req, res) => {
    res.json({ id: req.user.id, name: req.user.first_name, email: req.user.email ?? null, via: req.user.via ?? 'telegram' });
  });

  return router;
}
