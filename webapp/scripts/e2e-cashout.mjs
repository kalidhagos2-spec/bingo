// Rehearses gateway cash-outs against a dev server running PAYOUT_PROVIDER=sandbox (DEV_ALLOW_ANON=true,
// no ADMIN_TOKEN). Usage: node scripts/e2e-cashout.mjs http://127.0.0.1:3100 [webhook-secret]
const base = process.argv[2] ?? 'http://127.0.0.1:3100';
const secret = process.argv[3] ?? 'hook-secret';
const j = (r) => r.json().then((b) => [r.status, b]);
const api = (path, body, headers = {}) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }).then(j);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [, me] = await api('/api/profile');
await api('/api/profile/sync', { id: me.id, name: me.name, firstName: me.firstName }, { 'x-bot-token': 'test' }); // the player must exist before an adjustment
await api(`/api/admin/players/${me.id}/adjust`, { amount: 300, reason: 'e2e seed' });
const ask = async (account, amount) => (await api('/api/payments/withdraw', { method: 'telebirr', amount, account }))[1];
const A = await ask('0911000011', 50);
const B = await ask('0911000099', 50);
const C = await ask('0911000096', 60);
const D = await ask('0911000098', 100);
console.log('requested 4 cash-outs; balance now', (await api('/api/payments/wallet'))[1].balance, '(300 - 260 held)');

const approve = (ref, body = {}) => api(`/api/admin/withdrawals/${ref}/approve`, body);
const [a1, a2] = await Promise.all([approve(A.ref), approve(A.ref)]);
console.log('A approve twice at once ->', [a1[0], a2[0]].sort().join(' / '), '|', (a1[0] === 409 ? a1 : a2)[1].error);
const b = await approve(B.ref);
console.log('B (..99) ->', b[0], b[1].status, '|', b[1].reason);
const c = await approve(C.ref);
console.log('C (..96) ->', c[0], 'retryable', c[1].retryable, '|', c[1].error, '| row is', (await api('/api/admin/withdrawals?status=pending'))[1].withdrawals.some((w) => w.ref === C.ref) ? 'pending again' : '?');
let d = await approve(D.ref);
console.log('D (100 > limit 60) ->', d[0], 'confirmRequired', d[1].confirmRequired);
d = await approve(D.ref, { force: true });
console.log('D forced ->', d[0], d[1].status);

console.log('waiting for the watcher (sandbox delay 8 s, check every 3 s)…');
await sleep(13_000);
const after = (await api('/api/admin/withdrawals?status=all'))[1].withdrawals;
const show = (ref) => { const w = after.find((x) => x.ref === ref); return `${w.status}${w.providerRef ? ' ' + w.providerRef : ''}${w.verified ? ' (' + w.verified + ')' : ''}${w.autoCheck ? ' · ' + w.autoCheck : ''}`; };
console.log('A ->', show(A.ref));
console.log('B ->', show(B.ref));
console.log('D ->', show(D.ref));

const hook = await api('/api/payments/payout-webhook/sandbox', { ref: D.ref, status: 'paid' }, { 'x-sandbox-secret': secret });
console.log('D webhook paid ->', hook[0], JSON.stringify(hook[1]), '-> now', (await api(`/api/admin/withdrawals/${D.ref}/check`, {}))[1].status);
const bad = await api('/api/payments/payout-webhook/sandbox', { ref: D.ref, status: 'failed' }, { 'x-sandbox-secret': 'wrong' });
console.log('webhook with a wrong secret ->', bad[0]);

const wallet = (await api('/api/payments/wallet'))[1];
console.log('final balance', wallet.balance, '= 300 - 50 (A paid) - 100 (D paid) - 60 (C still held) =', 300 - 50 - 100 - 60);
console.log('player history:', wallet.transactions.filter((t) => t.type === 'withdraw').map((t) => `${t.ref.slice(-4)}:${t.status}`).join(' '));
const summary = (await api('/api/admin/summary'))[1];
console.log('house fees from cash-outs:', summary.house.balance, '(2% of 50 + 2% of 100 = 3)');
