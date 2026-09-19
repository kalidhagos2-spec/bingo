/**
 * Operator dashboard: a single self-contained HTML page (no build step) that talks to the
 * /api/admin endpoints with the admin token typed once and kept in localStorage.
 */
export function dashboardPage({ currency, payout = null, gateway = false }) {
  const payoutText = payout?.account ? `${payout.method ?? ''} ${payout.account}${payout.name ? ` (${payout.name})` : ''}`.trim() : 'the house account';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Telegram Bingo · Admin</title>
<style>
  :root{--bg:#0a1a5c;--panel:#10267a;--line:#2a52c4;--ink:#f1f5f9;--muted:#cbd5e1;--ok:#4ade80;--warn:#fbbf24;--bad:#fb7185;--aqua:#22d3ee}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;background:var(--panel);border-bottom:1px solid var(--line)}
  header h1{margin:0;font-size:18px}header h1 span{color:var(--warn)}
  main{max-width:1100px;margin:0 auto;padding:18px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
  .tile{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px}
  .tile b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
  .tile strong{display:block;font-size:22px;margin-top:2px}
  nav{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
  nav button,.btn{background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:10px;padding:8px 12px;font-weight:700;cursor:pointer}
  nav button.on{border-color:var(--aqua);background:#1a3a9c}
  .btn.ok{background:#166534;border-color:var(--ok)}.btn.bad{background:#7f1d1d;border-color:var(--bad)}.btn:disabled{opacity:.5;cursor:default}
  section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:16px;overflow-x:auto}
  section h2{margin:0 0 8px;font-size:15px;display:flex;align-items:center;justify-content:space-between;gap:8px}
  table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:7px 8px;text-align:left;border-bottom:1px solid #1a3a9c;white-space:nowrap}
  th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  .pending{color:var(--warn)}.paid{color:var(--ok)}.rejected,.cancelled{color:var(--bad)}
  .muted{color:var(--muted)}.right{text-align:right}
  input,select{background:#0a1a5c;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:7px 9px;font:inherit}
  #login{max-width:380px;margin:60px auto;text-align:center}#login input{width:100%;margin:10px 0}
  #msg{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#166534;border:1px solid var(--ok);padding:8px 14px;border-radius:10px;display:none}
  #msg.bad{background:#7f1d1d;border-color:var(--bad)}
</style></head><body>
<header><h1>🎱 Telegram Bingo · <span>Admin</span></h1><div><span id="clock" class="muted"></span> <button class="btn" id="refresh">⟳ Refresh</button> <button class="btn" id="logout">Log out</button></div></header>
<main>
  <div id="login">
    <h2>Operator access</h2>
    <p class="muted">Enter the <code>ADMIN_TOKEN</code> from <code>server/.env</code>. In dev mode without a token, just press Continue.</p>
    <input id="token" type="password" placeholder="admin token" autocomplete="off">
    <button class="btn ok" id="enter">Continue</button>
    <p id="loginErr" class="rejected"></p>
  </div>
  <div id="app" style="display:none">
    <div class="tiles" id="tiles"></div>
    <nav>
      <button data-tab="withdrawals" class="on">⬆️ Withdrawals</button>
      <button data-tab="deposits">⬇️ Deposits</button>
      <button data-tab="house">🏦 House ledger</button>
      <button data-tab="players">👥 Players</button>
      <button data-tab="games">🎮 Games</button>
      <button data-tab="rooms">🟢 Live tables</button>
      <button data-tab="settings">⚙️ Settings</button>
      <button data-tab="announcements">📢 Announcements</button>
    </nav>
    <section id="tab-withdrawals">
      <h2>Withdrawal requests
        <span><select id="wstatus"><option value="pending">Pending</option><option value="paid">Paid</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option><option value="all">All</option></select></span>
      </h2>
      <p class="muted" style="margin:0 0 8px">Send each approved payout from <b>${payoutText}</b> to the player's account in the row, then mark it paid with the transaction id.</p>
      <table><thead><tr><th>When</th><th>Ref</th><th>Player</th><th>Method</th><th>Account</th><th class="right">Amount</th><th class="right">Fee</th><th class="right">Payout</th><th>Status</th><th>Provider ref / reason</th><th></th></tr></thead><tbody id="wrows"></tbody></table>
    </section>
    <section id="tab-deposits" style="display:none">
      <h2>Deposits by transfer (pasted receipt ids)
        <span><select id="dstatus"><option value="pending">Pending</option><option value="paid">Confirmed</option><option value="rejected">Rejected</option><option value="all">All</option></select></span>
      </h2>
      <p class="muted" style="margin:0 0 8px">Check the transaction id against your Telebirr / bank statement, then confirm (credits the wallet minus the deposit fee) or reject.</p>
      <table><thead><tr><th>Submitted</th><th>Ref</th><th>Player</th><th>Method</th><th>Paid into</th><th>Transaction id</th><th class="right">Amount</th><th>Status</th><th>Check</th><th></th></tr></thead><tbody id="drows"></tbody></table>
    </section>
    <section id="tab-players" style="display:none">
      <h2>Players <span><input id="pq" placeholder="search id, name, phone, email" style="width:240px"> <span class="muted" id="pcount"></span></span></h2>
      <p class="muted" style="margin:0 0 8px">Click a row to see the player's wallet ledger.</p>
      <table><thead><tr><th>ID</th><th>Name</th><th>Username</th><th>Phone</th><th>Email</th><th>Signed up</th><th class="right">Wallet</th><th class="right">Coins</th><th class="right">Games</th><th class="right">Wins</th><th class="right">Won</th><th>Last activity</th><th>Status</th><th></th></tr></thead><tbody id="prows"></tbody></table>
    </section>
    <section id="tab-rooms" style="display:none">
      <h2>Live tables <span class="muted" id="rcount"></span></h2>
      <p class="muted" style="margin:0 0 8px">Click a table to see who is seated. Closing a table refunds open stakes and sends everyone back to the lobby.</p>
      <table><thead><tr><th>Room</th><th>Type</th><th class="right">Stake</th><th>Phase</th><th>#</th><th class="right">Seated</th><th class="right">Picked</th><th class="right">Pool</th><th class="right">Calls</th><th>Current</th><th></th></tr></thead><tbody id="rrows"></tbody></table>
    </section>
    <section id="tab-announcements" style="display:none">
      <h2>Announcements <span class="muted" id="acount"></span></h2>
      <div class="tile" style="margin-bottom:12px">
        <b>New announcement</b>
        <textarea id="atext" rows="3" maxlength="500" placeholder="Shown to every player in the app right away…" style="width:100%;margin-top:6px;background:#0a1a5c;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px;font:inherit"></textarea>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px">
          <label>Level <select id="alevel"><option value="info">Info</option><option value="warning">Warning</option><option value="promo">Promo</option></select></label>
          <label>Expires after <input id="ahours" type="number" min="1" max="720" placeholder="hours" style="width:90px"> <span class="muted">(empty = until removed)</span></label>
          <label><input id="atelegram" type="checkbox"> Also send as a Telegram message <span class="muted" id="atgnote"></span></label>
          <button class="btn ok" id="apost">Post</button>
        </div>
        <p id="aerr" class="rejected" style="margin:6px 0 0"></p>
      </div>
      <table><thead><tr><th>Posted</th><th>Level</th><th>Message</th><th>Expires</th><th>Status</th><th>Telegram</th><th></th></tr></thead><tbody id="arows"></tbody></table>
    </section>
    <section id="tab-settings" style="display:none">
      <h2>Settings <span><button class="btn" id="sreset">Reset to defaults</button> <button class="btn ok" id="ssave">Save changes</button></span></h2>
      <p class="muted" style="margin:0 0 8px">Changes apply immediately to new deposits, cash-outs and tables, and to the fee and pacing of tables already open. A running round finishes on the rules it started with. Saved values survive restarts; <b>Reset to defaults</b> returns every field to <code>server/.env</code>. House accounts and names take comma-separated lists, paired by position.</p>
      <div id="sform" class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))"></div>
      <p id="serr" class="rejected" style="margin:8px 0 0"></p>
    </section>
    <section id="tab-games" style="display:none">
      <h2>Game history <span><input id="gq" placeholder="search room code, player id or name" style="width:260px"> <span class="muted" id="gcount"></span></span></h2>
      <p class="muted" style="margin:0 0 8px">Click a round to see every player's cartela and marks.</p>
      <table><thead><tr><th>Finished</th><th>Room</th><th>#</th><th class="right">Stake</th><th class="right">Players</th><th>Winner</th><th>Result</th><th class="right" title="Everything staked on the round: stake x cartelas. The prize is this less the house cut.">Stakes</th><th class="right">Prize</th><th class="right" title="Real money only: what real players staked minus what a real winner was paid. Demo players stake play money, and a demo win refunds the real players.">House</th><th class="right">Calls</th><th class="right">Length</th></tr></thead><tbody id="grows"></tbody></table>
    </section>
    <section id="tab-house" style="display:none">
      <h2>House ledger <span class="muted" id="houseTotals"></span></h2>
      <table><thead><tr><th>When</th><th>Type</th><th>Detail</th><th class="right">Stakes / amount</th><th class="right">Prize</th><th class="right">Fee</th></tr></thead><tbody id="hrows"></tbody></table>
    </section>
  </div>
</main>
<div id="msg"></div>
<script>
const CUR = ${JSON.stringify(currency)};
const GATEWAY = ${JSON.stringify(Boolean(gateway))};
const PAYOUT = ${JSON.stringify(payoutText)};
const $ = (s) => document.querySelector(s);
const money = (n) => (Number(n ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + CUR;
const when = (iso) => iso ? new Date(iso).toLocaleString() : '';
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Demo players (house bots, negative ids; see demoBots.js) are always marked for the operator.
const demoTag = (id) => (Number(id) <= -1000 ? ' <span class="pending" title="House demo player: play money, cannot deposit or cash out">DEMO</span>' : '');
let token = localStorage.getItem('tgb-admin-token') ?? '';
let timer = null;

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', 'x-admin-token': token, 'ngrok-skip-browser-warning': '1', ...(opts.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? ('HTTP ' + res.status));
  return data;
}
function toast(text, bad = false) {
  const m = $('#msg'); m.textContent = text; m.className = bad ? 'bad' : ''; m.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => (m.style.display = 'none'), 3500);
}

async function loadSummary() {
  const s = await api('/api/admin/summary');
  $('#tiles').innerHTML = [
    ['House balance', money(s.house.balance)],
    ['Pending deposits', s.pendingDeposits.count + ' · ' + money(s.pendingDeposits.amount)],
    ['Pending cash-outs', s.pendingWithdrawals.count + ' · ' + money(s.pendingWithdrawals.amount)],
    ['Player balances', money(s.walletLiabilities)],
    ['Players', s.players],
    ['Rounds played', s.house.rounds],
    ['Round fees', money(s.house.roundFees) + ' (' + s.house.houseCutPercent + '%)'],
    ['Deposit fees', money(s.house.depositFees) + ' (' + s.house.depositFeePercent + '%)'],
    ['Live tables', s.rooms + ' rooms · ' + s.online + ' seated'],
  ].map(([k, v]) => '<div class="tile"><b>' + k + '</b><strong>' + v + '</strong></div>').join('');
}

async function loadWithdrawals() {
  const status = $('#wstatus').value;
  const { withdrawals } = await api('/api/admin/withdrawals?status=' + status);
  $('#wrows').innerHTML = withdrawals.length ? withdrawals.map((w) => '<tr>' +
    '<td>' + when(w.createdAt) + '</td><td><code>' + w.ref + '</code></td><td>' + w.userId + (w.playerName ? ' <span class="muted">' + esc(w.playerName) + '</span>' : '') + '</td><td>' + w.method + '</td><td>' + esc(w.account ?? '') + '</td>' +
    '<td class="right">' + money(-w.amount) + '</td><td class="right">' + money(w.fee) + '</td><td class="right"><b>' + money(w.payout) + '</b></td>' +
    '<td class="' + w.status + '">' + w.status + '</td><td class="muted">' + esc(w.providerRef ?? w.reason ?? '') + (w.verified ? ' <span class="paid">· ' + esc(w.verified) + '</span>' : '') + '</td>' +
    '<td>' + (w.status === 'pending' ? '<button class="btn ok" data-approve="' + w.ref + '">Approve</button> <button class="btn bad" data-reject="' + w.ref + '">Reject</button>' : '') + '</td></tr>').join('')
    : '<tr><td colspan="11" class="muted">Nothing here.</td></tr>';
}

async function loadDeposits() {
  const status = $('#dstatus').value;
  const { deposits } = await api('/api/admin/deposits?status=' + status);
  $('#drows').innerHTML = deposits.length ? deposits.map((d) => '<tr>' +
    '<td>' + when(d.createdAt) + '</td><td><code>' + d.ref + '</code></td><td>' + d.userId + (d.playerName ? ' <span class="muted">' + esc(d.playerName) + '</span>' : '') +
      (d.payerPhone || d.payerName ? '<br><span class="muted">sent from ' + esc([d.payerName, d.payerPhone].filter(Boolean).join(' · ')) + '</span>' : '') + '</td><td>' + d.method + '</td>' +
    '<td>' + esc(d.account ?? '') + (d.accountName ? ' <span class="muted">(' + esc(d.accountName) + ')</span>' : '') + '</td>' +
    '<td><code>' + esc(d.providerRef) + '</code>' + (d.method === 'telebirr' ? ' <a href="https://transactioninfo.ethiotelecom.et/receipt/' + encodeURIComponent(d.providerRef) + '" target="_blank" rel="noopener" style="color:var(--aqua)">receipt ↗</a>' : '') + '</td>' +
    '<td class="right"><b>' + money(d.amount) + '</b>' + (d.credited != null ? ' <span class="muted">→ ' + money(d.credited) + '</span>' : '') + '</td>' +
    '<td class="' + d.status + '">' + d.status + '</td><td class="muted">' + esc(d.verified ? 'verified: ' + d.verified : d.autoCheck ?? d.reason ?? '') + '</td>' +
    '<td>' + (d.status === 'pending' ? (d.method === 'telebirr' ? '<button class="btn" data-dverify="' + d.ref + '">Verify</button> ' : '') + '<button class="btn ok" data-dapprove="' + d.ref + '">Confirm</button> <button class="btn bad" data-dreject="' + d.ref + '">Reject</button>' : '') + '</td></tr>').join('')
    : '<tr><td colspan="10" class="muted">Nothing here.</td></tr>';
}

async function loadHouse() {
  const h = await api('/api/admin/house');
  $('#houseTotals').textContent = 'balance ' + money(h.balance) + ' · stakes ' + money(h.stakesCollected) + ' · prizes ' + money(h.prizesPaid) + ' · deposits ' + money(h.depositsReceived);
  $('#hrows').innerHTML = h.entries.length ? h.entries.map((e) => '<tr>' +
    '<td>' + when(e.at) + '</td><td>' + (e.type ?? 'round') + '</td>' +
    '<td>' + (e.type === 'adjustment' ? 'player ' + e.userId + ' · wallet adjusted by the operator' : e.type === 'deposit' || e.type === 'withdraw' ? 'player ' + e.userId + ' · ' + e.method + ' · <code>' + e.ref + '</code>' : 'room ' + e.room + ' · round ' + e.round + ' · ' + e.players + ' × ' + money(e.stake)) + '</td>' +
    '<td class="right">' + money(e.stakes ?? e.amount) + '</td><td class="right">' + (e.prize != null ? money(e.prize) : '') + '</td><td class="right"><b>' + money(e.fee) + '</b></td></tr>').join('')
    : '<tr><td colspan="6" class="muted">No fees collected yet.</td></tr>';
}

async function loadPlayers() {
  const q = $('#pq').value.trim();
  const { players, total } = await api('/api/admin/players?q=' + encodeURIComponent(q));
  $('#pcount').textContent = total + ' player' + (total === 1 ? '' : 's');
  $('#prows').innerHTML = players.length ? players.map((p) => '<tr class="prow" data-player="' + p.id + '" style="cursor:pointer">' +
    '<td>' + p.id + '</td><td>' + (p.name ?? '') + demoTag(p.id) + '</td><td>' + (p.username ? '@' + p.username : '') + '</td><td>' + (p.phone ?? '') + '</td><td>' + (p.email ?? '') + '</td>' +
    '<td>' + (p.signedUpAt ? new Date(p.signedUpAt).toLocaleDateString() : '<span class="muted">not finished</span>') + '</td>' +
    '<td class="right"><b>' + money(p.balance) + '</b></td><td class="right">' + p.coins + '</td><td class="right">' + p.stats.games + '</td><td class="right">' + p.stats.wins + '</td><td class="right">' + money(p.stats.winnings) + '</td>' +
    '<td class="muted">' + when(p.lastActivity) + '</td>' +
    '<td>' + (p.suspended ? '<span class="rejected" title="' + esc(p.suspended.reason) + '">' + (p.suspended.until ? 'suspended until ' + new Date(p.suspended.until).toLocaleDateString() : 'banned') + '</span>' : '<span class="paid">active</span>') + '</td>' +
    '<td>' + (p.suspended ? '<button class="btn ok" data-unsuspend="' + p.id + '">Reinstate</button>' : '<button class="btn bad" data-suspend="' + p.id + '">Suspend</button>') + (p.id > 0 ? ' <button class="btn" data-adjust="' + p.id + '" data-name="' + esc(p.name ?? '') + '" data-balance="' + p.balance + '">Adjust balance</button>' : '') + '</td></tr>').join('')
    : '<tr><td colspan="14" class="muted">No players match.</td></tr>';
}

async function togglePlayerLedger(row) {
  const next = row.nextElementSibling;
  if (next && next.classList.contains('ledger')) return next.remove();
  const { transactions } = await api('/api/admin/players/' + row.dataset.player + '/transactions');
  const tr = document.createElement('tr'); tr.className = 'ledger';
  tr.innerHTML = '<td colspan="14" style="white-space:normal;background:#0a1a5c">' + (transactions.length ? '<table>' + transactions.map((t) =>
    '<tr><td class="muted">' + when(t.createdAt) + '</td><td>' + (t.type ?? 'topup') + '</td><td>' + t.method + '</td><td class="right ' + (t.amount < 0 ? 'rejected' : 'paid') + '">' + money(t.amount) + '</td><td class="' + t.status + '">' + t.status + '</td><td class="muted">' + (t.note ?? t.reason ?? t.providerRef ?? '') + '</td></tr>').join('') + '</table>' : '<span class="muted">No transactions.</span>') + '</td>';
  row.after(tr);
}

const mins = (ms) => ms == null ? '' : Math.round(ms / 1000 / 60 * 10) / 10 + ' min';

async function loadGames() {
  const q = $('#gq').value.trim();
  const { rounds, total } = await api('/api/admin/rounds?q=' + encodeURIComponent(q) + '&limit=200');
  $('#gcount').textContent = rounds.length + ' of ' + total + ' round' + (total === 1 ? '' : 's');
  $('#grows').innerHTML = rounds.length ? rounds.map((r, i) => '<tr class="grow" data-round="' + i + '" style="cursor:pointer">' +
    '<td>' + when(r.at) + '</td><td><code>' + esc(r.room) + '</code></td><td>' + r.round + '</td><td class="right">' + (r.stake ? money(r.stake) : 'free') + '</td>' +
    '<td class="right">' + r.players.length + '</td>' +
    '<td>' + (r.winner ? esc(r.winner.name) + demoTag(r.winner.id) + ' <span class="muted">#' + r.winner.cartela + '</span>' : '<span class="muted">nobody</span>') + '</td>' +
    '<td>' + (r.winner ? (r.winner.full ? '<span class="paid">full card</span>' : 'line') : '<span class="rejected">75 numbers, refunded</span>') + '</td>' +
    '<td class="right">' + (r.stake ? money(r.stakes) + (r.demoStakes ? '<br><span class="muted">demo ' + money(r.demoStakes) + '</span>' : '') : '') + '</td>' +
    '<td class="right">' + (r.stake ? money(r.prize) : (r.freeCoins ? r.freeCoins + ' coins' : '')) + '</td><td class="right"><b>' + money(r.houseTake) + '</b></td>' +
    '<td class="right">' + (r.numbersCalled ?? '') + '</td><td class="right">' + mins(r.durationMs) + '</td></tr>').join('')
    : '<tr><td colspan="12" class="muted">No rounds yet.</td></tr>';
  loadGames.rounds = rounds;
}

function toggleRound(row) {
  const next = row.nextElementSibling;
  if (next && next.classList.contains('ledger')) return next.remove();
  const r = loadGames.rounds[Number(row.dataset.round)];
  const tr = document.createElement('tr'); tr.className = 'ledger';
  tr.innerHTML = '<td colspan="12" style="white-space:normal;background:#0a1a5c">' + winProof(r) + '<table>' + r.players.map((p) =>
    '<tr><td>' + p.id + '</td><td>' + esc(p.name) + demoTag(p.id) + (r.winner && r.winner.id === p.id ? ' 🏆' : '') + (p.left ? ' <span class="rejected">left mid-round</span>' : '') + '</td><td>cartela ' + ((p.cartelas && p.cartelas.length ? p.cartelas.join(', ') : p.cartela) ?? '?') + '</td><td>' + (p.marked ?? '?') + '/24 marked</td></tr>').join('') + '</table></td>';
  row.after(tr);
}

const LETTER = (n) => 'BINGO'[Math.floor((n - 1) / 15)] + '-' + n;

// The proof of a win: the numbers of the winning line, each with the call it came out on.
function winProof(r) {
  if (!r.winner || !r.winner.numbers || !r.called) return '';
  const at = (n) => r.called.indexOf(n) + 1;
  const all = r.winner.numbers.every((n) => at(n) > 0);
  return '<p style="margin:6px 4px"><b>' + esc(r.winner.name) + '</b> · cartela ' + r.winner.cartela + ' · ' + (r.winner.full ? 'full card' : 'winning numbers') + ': ' +
    r.winner.numbers.map((n) => '<code>' + LETTER(n) + '</code> <span class="muted">(call ' + (at(n) || '?') + ')</span>').join(' · ') +
    ' · ' + (all ? '<span class="paid">all called ✔</span>' : '<span class="rejected">NOT ALL CALLED</span>') +
    '<br><span class="muted">Balls in order (' + r.called.length + '): ' + r.called.map(LETTER).join(' ') + '</span></p>';
}

async function loadRooms() {
  const { rooms, now } = await api('/api/admin/rooms');
  $('#rcount').textContent = rooms.length + ' table' + (rooms.length === 1 ? '' : 's') + ' · ' + rooms.reduce((s, r) => s + r.players.length, 0) + ' seated';
  const phase = (r) => r.phase === 'countdown' ? 'starts in ' + Math.max(0, Math.ceil((r.startsAt - now) / 1000)) + ' s' : r.phase;
  $('#rrows').innerHTML = rooms.length ? rooms.map((r, i) => '<tr class="rrow" data-room="' + i + '" style="cursor:pointer">' +
    '<td><code>' + esc(r.code) + '</code></td><td>' + (r.isPrivate ? 'private' : 'public') + '</td><td class="right">' + (r.stake ? money(r.stake) : 'free') + '</td>' +
    '<td class="' + (r.phase === 'playing' ? 'paid' : r.phase === 'countdown' ? 'pending' : 'muted') + '">' + phase(r) + '</td><td>' + r.round + '</td>' +
    '<td class="right">' + r.players.length + '</td><td class="right">' + r.ready + '</td><td class="right">' + (r.stake ? money(r.pool) : '') + '</td>' +
    '<td class="right">' + r.called.length + '</td><td>' + (r.current ? LETTER(r.current) : '') + '</td>' +
    '<td><button class="btn bad" data-close="' + esc(r.code) + '">Close</button></td></tr>').join('')
    : '<tr><td colspan="11" class="muted">No live tables right now.</td></tr>';
  loadRooms.rooms = rooms;
}

function toggleRoom(row) {
  const next = row.nextElementSibling;
  if (next && next.classList.contains('ledger')) return next.remove();
  const r = loadRooms.rooms[Number(row.dataset.room)];
  const tr = document.createElement('tr'); tr.className = 'ledger';
  tr.innerHTML = '<td colspan="11" style="white-space:normal;background:#0a1a5c">' + (r.players.length ? '<table>' + r.players.map((p) =>
    '<tr><td>' + p.id + '</td><td>' + esc(p.name) + demoTag(p.id) + '</td><td>' + (p.cartela ? 'cartela ' + p.cartela : '<span class="muted">not picked</span>') + '</td><td>' + (p.playing ? p.marked + '/24 marked' : p.cartela ? '<span class="pending">ready for the next round</span>' : '<span class="muted">watching</span>') + '</td></tr>').join('') + '</table>' : '<span class="muted">Empty.</span>') + '</td>';
  row.after(tr);
}

async function loadAnnouncements() {
  const { announcements, telegramRecipients, telegramEnabled } = await api('/api/admin/announcements');
  const live = announcements.filter((a) => a.active && (!a.expiresAt || new Date(a.expiresAt) > new Date()));
  $('#acount').textContent = live.length + ' live · ' + announcements.length + ' total';
  $('#atgnote').textContent = telegramEnabled ? '(' + telegramRecipients + ' Telegram players)' : '(needs BOT_TOKEN on the server)';
  $('#atelegram').disabled = !telegramEnabled;
  $('#arows').innerHTML = announcements.length ? announcements.map((a) => {
    const expired = a.expiresAt && new Date(a.expiresAt) <= new Date();
    const status = !a.active ? '<span class="rejected">removed</span>' : expired ? '<span class="muted">expired</span>' : '<span class="paid">live</span>';
    const tg = a.telegram ? (a.telegram.done ? (a.telegram.error ? '<span class="rejected">' + esc(a.telegram.error) + '</span>' : a.telegram.sent + ' sent' + (a.telegram.failed ? ', ' + a.telegram.failed + ' failed' : '')) : 'sending…') : '<span class="muted">—</span>';
    return '<tr><td>' + when(a.createdAt) + '</td><td class="' + (a.level === 'warning' ? 'rejected' : a.level === 'promo' ? 'pending' : '') + '">' + a.level + '</td><td style="white-space:normal;max-width:420px">' + esc(a.text) + '</td><td>' + (a.expiresAt ? when(a.expiresAt) : '<span class="muted">never</span>') + '</td><td>' + status + '</td><td>' + tg + '</td>' +
      '<td>' + (a.active && !expired ? '<button class="btn bad" data-remove="' + a.id + '">Remove</button>' : '') + '</td></tr>';
  }).join('') : '<tr><td colspan="7" class="muted">No announcements yet.</td></tr>';
}

async function postAnnouncement() {
  $('#aerr').textContent = '';
  try {
    await api('/api/admin/announcements', { method: 'POST', body: JSON.stringify({ text: $('#atext').value, level: $('#alevel').value, expiresInHours: $('#ahours').value.trim() || null, telegram: $('#atelegram').checked }) });
    $('#atext').value = ''; $('#ahours').value = ''; $('#atelegram').checked = false;
    toast('Announcement posted');
    await loadAnnouncements();
  } catch (err) {
    $('#aerr').textContent = err.message;
    toast(err.message, true);
  }
}

let settingsData = null;
async function loadSettings() {
  settingsData = await api('/api/admin/settings');
  const { schema, values } = settingsData;
  const groups = [...new Set(schema.map((f) => f.group))];
  $('#sform').innerHTML = groups.map((g) => '<div class="tile"><b>' + g + '</b>' + schema.filter((f) => f.group === g).map((f) => {
    const v = values[f.key];
    const show = (x) => Array.isArray(x) ? x.join(',') : x;
    return '<label style="display:block;margin-top:8px"><span style="display:block;font-size:12px;color:var(--muted)">' + esc(f.label) + '</span>' +
      // Stakes and house accounts are text (comma-separated lists, names); everything else is a number.
      '<input data-setting="' + f.key + '" value="' + esc(show(v)) + '"' +
      (f.scope === 'stakes' ? ' type="text" placeholder="10,20,50"'
        : f.scope === 'account' ? ' type="text" placeholder="' + (f.field === 'name' ? 'Aman,Kalid' : '0937766034,0960524040') + '" autocomplete="off"'
        : ' type="number" min="' + f.min + '" max="' + f.max + '" step="' + f.step + '"') +
      ' style="width:100%;margin-top:3px"></label>';
  }).join('') + '</div>').join('');
  $('#serr').textContent = '';
}

async function saveSettings() {
  const patch = {};
  for (const input of document.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    const before = settingsData.values[key];
    const now = input.value.trim();
    if (String(Array.isArray(before) ? before.join(',') : before) !== now) patch[key] = now;
  }
  if (Object.keys(patch).length === 0) return toast('Nothing changed');
  try {
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) });
    toast('Settings saved');
    await Promise.all([loadSettings(), loadSummary()]);
  } catch (err) {
    $('#serr').textContent = err.message;
    toast(err.message, true);
  }
}

async function refreshAll() {
  try {
    await Promise.all([loadSummary(), loadWithdrawals(), loadDeposits(), loadHouse(), loadPlayers(), loadGames(), loadRooms(), loadAnnouncements()]);
    if (!settingsData) await loadSettings(); // not re-rendered on the timer, so edits in progress are kept
    $('#clock').textContent = 'updated ' + new Date().toLocaleTimeString();
  } catch (err) {
    if (/token|401/i.test(err.message)) return logout(err.message);
    toast(err.message, true);
  }
}

async function enter() {
  token = $('#token').value.trim();
  try {
    await api('/api/admin/summary');
    localStorage.setItem('tgb-admin-token', token);
    $('#login').style.display = 'none'; $('#app').style.display = 'block';
    await refreshAll();
    timer = setInterval(refreshAll, 15000);
  } catch (err) {
    $('#loginErr').textContent = err.message;
  }
}
function logout(reason) {
  clearInterval(timer); token = ''; localStorage.removeItem('tgb-admin-token');
  $('#app').style.display = 'none'; $('#login').style.display = 'block'; $('#loginErr').textContent = reason ?? '';
}

document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.tab) {
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b === t));
    for (const name of ['withdrawals', 'deposits', 'house', 'players', 'games', 'rooms', 'settings', 'announcements']) $('#tab-' + name).style.display = t.dataset.tab === name ? '' : 'none';
    if (t.dataset.tab === 'settings') loadSettings().catch((err) => toast(err.message, true));
    if (t.dataset.tab === 'rooms') loadRooms().catch((err) => toast(err.message, true));
  }
  if (t.dataset.dverify) {
    try {
      const r = await api('/api/admin/deposits/' + t.dataset.dverify + '/verify', { method: 'POST' });
      toast(r.check.ok ? 'Receipt confirmed · wallet credited' : 'Not confirmed: ' + r.check.reason, !r.check.ok);
      refreshAll();
    } catch (err) { toast(err.message, true); }
    return;
  }
  if (t.dataset.dapprove) {
    if (!confirm('Confirm this transfer and credit the wallet?')) return;
    try { await api('/api/admin/deposits/' + t.dataset.dapprove + '/approve', { method: 'POST' }); toast('Deposit confirmed'); refreshAll(); }
    catch (err) { toast(err.message, true); }
    return;
  }
  if (t.dataset.dreject) {
    const reason = prompt('Reason shown to the player:', 'Transaction id not found on our statement');
    if (reason === null) return;
    try { await api('/api/admin/deposits/' + t.dataset.dreject + '/reject', { method: 'POST', body: JSON.stringify({ reason }) }); toast('Deposit rejected'); refreshAll(); }
    catch (err) { toast(err.message, true); }
    return;
  }
  if (t.dataset.adjust) {
    const who = (t.dataset.name || 'player') + ' (' + t.dataset.adjust + ')';
    const raw = prompt('Adjust the wallet of ' + who + '. Balance now: ' + money(t.dataset.balance) + '\n\nAmount in ' + CUR + ': 30 adds 30, -30 takes 30 back.');
    if (raw === null) return;
    const amount = Number(String(raw).replace(',', '.').trim());
    if (!Number.isFinite(amount) || amount === 0) return toast('Enter a number other than 0', true);
    const reason = prompt('Reason (the player sees it in their wallet history):', amount > 0 ? 'Refund' : 'Correction');
    if (reason === null) return;
    if (!confirm((amount > 0 ? 'ADD ' : 'TAKE ') + money(Math.abs(amount)) + (amount > 0 ? ' to ' : ' from ') + who + '?\nNew balance: ' + money(Number(t.dataset.balance) + amount) + '\nReason: ' + reason)) return;
    try {
      const r = await api('/api/admin/players/' + t.dataset.adjust + '/adjust', { method: 'POST', body: JSON.stringify({ amount, reason }) });
      toast('Wallet adjusted · new balance ' + money(r.balance));
      refreshAll();
    } catch (err) { toast(err.message, true); }
    return;
  }
  if (t.dataset.remove) {
    if (!confirm('Remove this announcement for every player?')) return;
    try { await api('/api/admin/announcements/' + t.dataset.remove, { method: 'DELETE' }); toast('Announcement removed'); loadAnnouncements(); }
    catch (err) { toast(err.message, true); }
    return;
  }
  if (t.dataset.close) {
    const reason = prompt('Close table ' + t.dataset.close + '? Reason shown to the players:', 'Table closed by the operator');
    if (reason === null) return;
    try { await api('/api/admin/rooms/' + t.dataset.close + '/close', { method: 'POST', body: JSON.stringify({ reason }) }); toast('Table closed'); loadRooms(); loadSummary(); }
    catch (err) { toast(err.message, true); }
    return;
  }
  const rrow = t.closest('.rrow');
  if (rrow) return toggleRoom(rrow);
  const grow = t.closest('.grow');
  if (grow) return toggleRound(grow);
  if (t.dataset.suspend) {
    const reason = prompt('Reason shown to the player:', 'Suspicious activity');
    if (reason === null) return;
    const days = prompt('Suspend for how many days? Leave empty for a permanent ban.', '7');
    if (days === null) return;
    try { await api('/api/admin/players/' + t.dataset.suspend + '/suspend', { method: 'POST', body: JSON.stringify({ reason, days: days.trim() }) }); toast(days.trim() ? 'Player suspended' : 'Player banned'); loadPlayers(); }
    catch (err) { toast(err.message, true); }
    return;
  }
  if (t.dataset.unsuspend) {
    try { await api('/api/admin/players/' + t.dataset.unsuspend + '/unsuspend', { method: 'POST' }); toast('Player reinstated'); loadPlayers(); }
    catch (err) { toast(err.message, true); }
    return;
  }
  const prow = t.closest('.prow');
  if (prow) togglePlayerLedger(prow).catch((err) => toast(err.message, true));
  if (t.dataset.approve) {
    const providerRef = prompt(GATEWAY
      ? 'Telebirr transaction id of a payout you already sent — or leave empty to send it through the Telebirr gateway now:'
      : 'Send the payout from ' + PAYOUT + ' first, then paste its Telebirr transaction id (the receipt is checked before it is marked paid):');
    if (providerRef === null) return;
    const approve = (force) => api('/api/admin/withdrawals/' + t.dataset.approve + '/approve', { method: 'POST', body: JSON.stringify({ providerRef, force }) });
    try {
      const r = await approve(false);
      toast(r.verified === 'gateway' ? 'Sent through the gateway · marked paid' : r.verified === 'receipt' ? 'Receipt verified · marked paid' : 'Marked as paid');
      refreshAll();
    } catch (err) {
      if (/^Receipt check failed/.test(err.message) && confirm(err.message + '\\n\\nMark it as paid anyway?')) {
        try { await approve(true); toast('Marked as paid (unverified)'); refreshAll(); } catch (e2) { toast(e2.message, true); }
      } else toast(err.message, true);
    }
  }
  if (t.dataset.reject) {
    const reason = prompt('Reason shown to the player (the hold is refunded):', 'Account could not be verified');
    if (reason === null) return;
    try { await api('/api/admin/withdrawals/' + t.dataset.reject + '/reject', { method: 'POST', body: JSON.stringify({ reason }) }); toast('Rejected and refunded'); refreshAll(); }
    catch (err) { toast(err.message, true); }
  }
});
$('#enter').addEventListener('click', enter);
$('#token').addEventListener('keydown', (e) => e.key === 'Enter' && enter());
$('#refresh').addEventListener('click', refreshAll);
$('#logout').addEventListener('click', () => logout());
$('#wstatus').addEventListener('change', loadWithdrawals);
$('#dstatus').addEventListener('change', loadDeposits);
$('#apost').addEventListener('click', postAnnouncement);
$('#ssave').addEventListener('click', saveSettings);
$('#sreset').addEventListener('click', async () => {
  if (!confirm('Return every setting to the values in server/.env?')) return;
  try { await api('/api/admin/settings/reset', { method: 'POST' }); toast('Settings reset'); await Promise.all([loadSettings(), loadSummary()]); }
  catch (err) { toast(err.message, true); }
});
$('#gq').addEventListener('input', () => { clearTimeout(loadGames.t); loadGames.t = setTimeout(() => loadGames().catch((err) => toast(err.message, true)), 250); });
$('#pq').addEventListener('input', () => { clearTimeout(loadPlayers.t); loadPlayers.t = setTimeout(() => loadPlayers().catch((err) => toast(err.message, true)), 250); });
if (token || true) { $('#token').value = token; if (token) enter(); }
</script></body></html>`;
}
