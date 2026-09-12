import { Router } from 'express';
import { economyView, claimBonus, claimMission, buy, selectTheme } from '../economy.js';

/** /api/economy — coins, daily bonus, missions and shop for the signed-in player. */
export function economyRouter({ store, auth }) {
  const router = Router();
  router.use(auth);

  router.get('/', (req, res) => {
    res.json(economyView(store.profileOrEmpty(req.user.id)));
  });

  const action = (fn) => async (req, res) => {
    try {
      const result = await store.updateProfile(req.user.id, (profile) => fn(profile, req));
      res.json({ ...result, economy: economyView(store.profileOrEmpty(req.user.id)) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };

  router.post('/bonus/claim', action((profile) => claimBonus(profile)));
  router.post('/missions/:id/claim', action((profile, req) => claimMission(profile, req.params.id)));
  router.post('/shop/:id/buy', action((profile, req) => buy(profile, req.params.id)));
  router.post('/theme/:theme', action((profile, req) => ({ theme: selectTheme(profile, req.params.theme) })));

  return router;
}
