import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardPage } from '../src/routes/adminDashboard.js';

// The dashboard is one HTML page built from a template string, so `node --check` on the module
// says nothing about the script inside it: a stray "\n" there becomes a line break in a browser
// string literal and kills the whole page, the login button included.
test('the dashboard page ships a browser script that parses', () => {
  for (const options of [{ currency: 'ETB' }, { currency: 'ETB', payout: { method: 'telebirr', account: "09'60", name: 'A "B"' }, gateway: true }]) {
    const html = dashboardPage(options);
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim());
    assert.ok(scripts.length >= 1);
    for (const source of scripts) assert.doesNotThrow(() => new Function(source), 'the dashboard script has a syntax error');
    for (const id of ['enter', 'token', 'prows', 'grows']) assert.ok(html.includes(`id="${id}"`), `#${id} is on the page`);
  }
});
