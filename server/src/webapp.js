import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Serves the built Mini App (webapp/dist) from the game server itself, when it is there.
 *
 * docker-compose puts nginx in front and never ships the files here, so this is a no-op
 * locally. The single-image deploy (Dockerfile.render) copies the build to WEBAPP_DIR: one
 * service, one origin, so no CORS, no VITE_API_URL and no ALLOWED_ORIGINS to keep in step.
 * Cache rules match webapp/nginx.conf: the page is always revalidated, hashed assets never
 * change, the Amharic clips are kept for a month.
 */
export function serveWebapp(app, dir = process.env.WEBAPP_DIR || '/app/public') {
  const index = path.join(dir, 'index.html');
  if (!existsSync(index)) return false;

  app.use('/assets', express.static(path.join(dir, 'assets'), { immutable: true, maxAge: '365d' }));
  app.use('/audio', express.static(path.join(dir, 'audio'), { maxAge: '30d' }));
  // A missing file is a plain 404, never the page (a stale bundle name must not load HTML as script).
  app.use(['/assets', '/audio'], (_req, res) => res.status(404).end());
  app.use(express.static(dir, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
  // The Mini App is a single page: every other GET that is not the API or the socket gets it.
  app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  console.log(`[webapp] serving the Mini App from ${dir}`);
  return true;
}
