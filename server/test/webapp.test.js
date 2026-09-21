import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serveWebapp } from '../src/webapp.js';

async function serve(t, dir) {
  const app = express();
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  const mounted = serveWebapp(app, dir);
  const server = app.listen(0);
  t.after(() => server.close());
  return { mounted, base: `http://127.0.0.1:${server.address().port}` };
}

test('the single-image deploy serves the Mini App next to the API, with the right caching', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'webapp-'));
  mkdirSync(path.join(dir, 'assets'));
  mkdirSync(path.join(dir, 'audio', 'am'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>USA Bingo</title>');
  writeFileSync(path.join(dir, 'assets', 'index-abc.js'), 'console.log(1)');
  writeFileSync(path.join(dir, 'audio', 'am', '12.mp3'), 'x');
  const { mounted, base } = await serve(t, dir);
  assert.equal(mounted, true);

  const get = async (p) => {
    const r = await fetch(base + p);
    return { status: r.status, cache: r.headers.get('cache-control'), type: r.headers.get('content-type') ?? '', body: await r.text() };
  };
  const page = await get('/');
  assert.deepEqual([page.status, page.cache], [200, 'no-cache']);
  assert.match(page.body, /USA Bingo/);
  assert.match((await get('/wallet?lang=am')).body, /USA Bingo/); // single-page routes get the page
  assert.match((await get('/assets/index-abc.js')).cache, /immutable/);
  assert.match((await get('/audio/am/12.mp3')).cache, /max-age=2592000/);
  assert.equal((await get('/assets/gone.js')).status, 404); // never the page in place of a script
  assert.match((await get('/api/health')).type, /json/); // the API is untouched
  assert.equal((await get('/api/nope')).status, 404);
  assert.doesNotMatch((await get('/socket.io/x')).body, /USA Bingo/);
});

test('without a build (docker-compose, local dev) the server serves no pages', async (t) => {
  const { mounted, base } = await serve(t, path.join(tmpdir(), 'no-such-webapp-dir'));
  assert.equal(mounted, false);
  assert.equal((await fetch(base + '/')).status, 404);
});
