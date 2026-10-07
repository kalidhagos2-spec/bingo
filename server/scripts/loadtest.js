/**
 * Load test for the realtime layer: real Socket.io clients against the real attachRealtime(),
 * no database. Reports bytes sent per event type and event-loop lag.
 *
 *   node scripts/loadtest.js [tables=20] [seconds=20]
 *
 * Needs socket.io-client, which lives in ../webapp/node_modules (installed with the webapp).
 * Rounds are sped up (short countdown, fast calls) so many full rounds happen during the run.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { attachRealtime } from '../src/realtime.js';

const require = createRequire(new URL('../../webapp/package.json', import.meta.url));
const { io: connect } = require('socket.io-client');

const TABLES = Number(process.argv[2] ?? 20);
const SECONDS = Number(process.argv[3] ?? 20);
const PER_TABLE = 8;
const rules = { minPlayers: 2, maxPlayers: PER_TABLE, countdownMs: 1500, callIntervalMs: 250, claimWindowMs: 0, restartDelayMs: 500 };

const http = createServer();
const server = attachRealtime(http, { botToken: '', devAllowAnon: true, rules, stakes: [0], store: null });

// Bytes of every message a client receives, per event name (counted by the clients, so room-wide broadcasts are included).
const bytes = new Map();
const count = (event, payload) => {
  const row = bytes.get(event) ?? { n: 0, bytes: 0 };
  row.n += 1;
  row.bytes += Buffer.byteLength(JSON.stringify(payload ?? null));
  bytes.set(event, row);
};
await new Promise((resolve) => http.listen(0, resolve));
const url = `http://localhost:${http.address().port}`;

const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();

const clients = [];
let rounds = 0;
for (let i = 1; i <= TABLES * PER_TABLE; i++) {
  const socket = connect(url, { auth: { devId: String(i) }, transports: ['websocket'], forceNew: true });
  const me = { id: i, socket };
  socket.onAny((event, ...args) => count(event, args[0]));
  socket.on('game:over', () => {
    if (i % PER_TABLE === 1) rounds += 1;
  });
  // Every player takes a cartela as soon as registration opens, and claims when they can.
  const pick = () => socket.emit('game:choose', { cartela: i }, () => {});
  socket.on('room:state', (s) => {
    if ((s.phase === 'waiting' || s.phase === 'countdown') && !s.players.find((p) => p.id === i)?.cartelas?.length) pick();
  });
  socket.on('game:number', ({ number }) => socket.emit('game:mark', { number }, () => {}));
  socket.on('game:number', () => socket.emit('game:claim', {}, () => {}));
  clients.push(me);
}
await Promise.all(clients.map((c) => new Promise((resolve) => c.socket.on('connect', resolve))));
// Seat the players: tables of PER_TABLE share a private room code so each table is full.
const hosts = [];
for (let t = 0; t < TABLES; t++) {
  const host = clients[t * PER_TABLE];
  const code = await new Promise((resolve) => host.socket.emit('room:create', { stake: 0 }, (r) => resolve(r.room.code)));
  hosts.push(code);
  for (let k = 1; k < PER_TABLE; k++) await new Promise((resolve) => clients[t * PER_TABLE + k].socket.emit('room:join', { code }, resolve));
}
console.log(`${TABLES} tables x ${PER_TABLE} players = ${clients.length} sockets, running ${SECONDS}s…`);
const t0 = Date.now();
await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));
const secs = (Date.now() - t0) / 1000;
delay.disable();

console.log(`\nrounds finished: ${rounds}`);
console.log(`event loop lag: mean ${(delay.mean / 1e6).toFixed(1)} ms, p99 ${(delay.percentile(99) / 1e6).toFixed(1)} ms, max ${(delay.max / 1e6).toFixed(1)} ms`);
let total = 0;
console.log('\nevent'.padEnd(16), 'msgs'.padStart(8), 'KB'.padStart(9), 'KB/s'.padStart(8), 'avg B'.padStart(8));
for (const [event, row] of [...bytes].sort((a, b) => b[1].bytes - a[1].bytes)) {
  total += row.bytes;
  console.log(event.padEnd(15), String(row.n).padStart(8), (row.bytes / 1024).toFixed(0).padStart(9), (row.bytes / 1024 / secs).toFixed(1).padStart(8), String(Math.round(row.bytes / row.n)).padStart(8));
}
console.log(`\ntotal ${(total / 1024 / secs).toFixed(0)} KB/s out, ${(total / 1024 / secs / clients.length).toFixed(2)} KB/s per player`);

for (const c of clients) c.socket.close();
server.manager.shutdown();
server.io.close();
http.close();
process.exit(0);
