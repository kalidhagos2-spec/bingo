// End-to-end check against a dev server (DEV_ALLOW_ANON=true, no ADMIN_TOKEN): two real players
// (no demo players) play one paid round. Usage: node scripts/e2e-two-players.mjs http://127.0.0.1:3100
import { io } from 'socket.io-client';

const base = process.argv[2] ?? 'http://127.0.0.1:3100';
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then((r) => r.json());
const ask = (socket, event, payload) => new Promise((resolve, reject) => socket.emit(event, payload, (res) => (res?.ok ? resolve(res) : reject(new Error(res?.error ?? 'failed')))));

async function player(id, name, cartelas) {
  await post('/api/profile/sync', { id, name, firstName: name }, { 'x-bot-token': 'test' });
  await post(`/api/admin/players/${id}/adjust`, { amount: 100, reason: 'e2e seed' });
  const socket = io(base, { path: '/socket.io', auth: { devId: String(id) }, transports: ['websocket'] });
  const me = { id, name, socket, balance: null, over: null };
  socket.on('wallet:balance', ({ balance }) => (me.balance = balance));
  socket.on('game:over', (payload) => (me.over = payload));
  socket.on('game:number', async ({ number }) => {
    try {
      const res = await ask(socket, 'game:mark', { number });
      if (res.cards?.some((c) => c.canClaim)) await ask(socket, 'game:claim', {});
    } catch {
      /* not on my cards / round already over */
    }
  });
  await new Promise((r) => socket.on('connect', r));
  await ask(socket, 'room:join', { stake: 10 });
  for (const c of cartelas) await ask(socket, 'game:choose', { cartela: c });
  return me;
}

const a = await player(501, 'Abebe', [11, 12]);
const b = await player(502, 'Sara', [21]);
console.log(`after picking: ${a.name} ${a.balance} ETB (2 cartelas), ${b.name} ${b.balance} ETB (1 cartela)`);
while (!a.over || !b.over) await new Promise((r) => setTimeout(r, 200));
await new Promise((r) => setTimeout(r, 300));
const w = a.over.winner;
const loser = w.id === a.id ? b : a;
const winner = w.id === a.id ? a : b;
console.log(`winner: ${w.name} with cartela ${w.cartela}, numbers ${w.numbers.join(' ')}, winning ball ${w.ball} on call ${w.ballCall}; last ball called ${a.over.called.at(-1)} (call ${a.over.called.length})`);
console.log(`prize ${w.prize} ETB = 3 cartelas x 10 less 20%: ${w.prize === 24}`);
console.log(`${winner.name} (won):  ${winner.balance} ETB`);
console.log(`${loser.name} (lost): ${loser.balance} ETB  -> stake kept: ${loser.balance === 100 - 10 * (loser.id === 501 ? 2 : 1)}`);
console.log(`game ended on the winning ball: ${w.ball === a.over.called.at(-1)}`);
a.socket.close();
b.socket.close();
process.exit(0);
