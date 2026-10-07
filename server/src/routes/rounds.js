import { Router } from 'express';

/**
 * /api/rounds — the public record of finished rounds for the fairness screen: the balls in
 * calling order, the winner, and the seed that the ball order was derived from together with the
 * commitment players saw before the round. Needs Telegram auth like the rest of the player API.
 */
export function roundsRouter({ store, auth }) {
  const router = Router();
  router.use(auth);

  router.get('/', async (req, res, next) => {
    try {
      res.json({ rounds: await store.publicRounds(Math.min(Number(req.query.limit) || 30, 100)) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Bad round id' });
      const [round] = await store.publicRounds(1, id);
      if (!round) return res.status(404).json({ error: 'Round not found' });
      res.json({ round });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
