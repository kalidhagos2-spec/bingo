import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { connectSocket, request } from '../lib/socket.js';
import { api } from '../lib/api.js';
import { themeFor } from '../lib/themes.js';
import { untilText } from './Missions.jsx';
import { BottomNav } from './Nav.jsx';
import { LETTERS } from '../lib/bingo.js';
import { playMark, playLine, playWin, playCall, isMuted, setMuted } from '../lib/sound.js';

/* Column colours as in the reference app: B red, I blue, N green, G amber, O violet. */
const COL = ['bg-rose-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-400', 'bg-violet-500'];
const letterIndex = (n) => Math.floor((n - 1) / 15);
const letterFor = (n) => LETTERS[letterIndex(n)];
/** 65 -> "01:05" */
const clock = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const etb = (n) => `${Number(n ?? 0).toFixed(n % 1 ? 2 : 0)} ETB`;
const stakeLabel = (stake) => (stake === 0 ? 'Free Bingo' : `${stake} ETB Bingo`);
/* Card looks per stake, after the lobby mockup: red, orange, green, purple. */
const CARD_LOOK = ['from-rose-600 to-red-800', 'from-orange-500 to-rose-700', 'from-emerald-500 to-green-800', 'from-violet-500 to-fuchsia-800'];

/** Home screen: lobby by stake, cartela pick, live table, win modal. */
export default function Game({ user, onNav, haptic }) {
  const onWallet = () => onNav('wallet');
  const onProfile = () => onNav('profile');
  const onShop = () => onNav('shop');
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [me, setMe] = useState(null);
  const [lobby, setLobby] = useState([]);
  const [room, setRoom] = useState(null);
  const [card, setCard] = useState(null);
  const [current, setCurrent] = useState(null);
  const [over, setOver] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState(false); // pressed "Start Game" on the pick screen
  const [muted, setMutedState] = useState(isMuted());
  const [profile, setProfile] = useState(null);
  const [leaders, setLeaders] = useState([]);
  const [eco, setEco] = useState(null); // coins, daily bonus, missions, selected skin
  const [announcements, setAnnouncements] = useState([]);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('tgb-dismissed') ?? '[]');
    } catch {
      return [];
    }
  });
  const theme = themeFor(eco?.theme);
  // Inside Telegram the id comes from initData; as a browser guest the server assigns one.
  const myId = user?.id ?? me?.id ?? null;
  const myIdRef = useRef(myId);
  myIdRef.current = myId;

  useEffect(() => {
    const socket = connectSocket();
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (e) => {
      if (/^Account suspended/.test(e.message)) window.dispatchEvent(new CustomEvent('tgb-suspended', { detail: e.message }));
      setError(e.message === 'unauthorized' ? 'Open this game from Telegram to play online.' : e.message);
    });
    socket.on('room:closed', ({ reason }) => {
      setRoom(null);
      setCard(null);
      setOver(null);
      setCurrent(null);
      setReady(false);
      setError(reason);
      haptic?.('warning');
    });
    socket.on('session:kicked', ({ reason }) => window.dispatchEvent(new CustomEvent('tgb-suspended', { detail: `Account suspended: ${reason}` })));
    socket.on('session:me', setMe);
    socket.on('wallet:balance', ({ balance }) => setMe((m) => ({ ...m, balance })));
    socket.on('lobby:rooms', setLobby);
    // Operator announcements: pushed live, and listed on connect via the API below.
    socket.on('announcement', (a) => {
      setAnnouncements((list) => [a, ...list.filter((x) => x.id !== a.id)]);
      haptic?.('medium');
    });
    socket.on('announcement:removed', ({ id }) => setAnnouncements((list) => list.filter((x) => x.id !== id)));
    socket.on('room:state', (state) => {
      setRoom(state);
      if (state.phase === 'playing') setOver(null);
      if (state.phase === 'waiting') {
        setCurrent(null);
        setReady(false);
        // Registration re-opened: the previous round's card is gone until we pick again.
        const mine = state.players.find((p) => p.id === myIdRef.current);
        if (!mine?.cartela) setCard(null);
      }
    });
    // Sent when the player picks a cartela and again (with fresh marks) when the round starts.
    socket.on('game:card', (c) => {
      setCard(c);
      setOver(null);
    });
    // The server calls the next number by itself once the countdown is over.
    socket.on('game:number', ({ number, called }) => {
      setCurrent(number);
      setRoom((r) => (r ? { ...r, called, current: number, callIndex: called.length } : r));
      playCall();
    });
    socket.on('game:over', (payload) => {
      setOver(payload);
      if (payload.winner && payload.winner.id === myIdRef.current) {
        playWin();
        haptic?.('success');
      } else {
        haptic?.('warning');
      }
    });
    return () => socket.disconnect();
  }, [haptic]);

  // Profile (sign-up status) and leaderboard for the lobby.
  useEffect(() => {
    let alive = true;
    api('/profile').then((p) => alive && setProfile(p)).catch(() => {});
    api('/profile/leaderboard').then((r) => alive && setLeaders(r.leaders)).catch(() => {});
    api('/economy').then((e) => alive && setEco(e)).catch(() => {});
    api('/announcements').then((r) => alive && setAnnouncements(r.announcements)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [room?.round]);

  // Tick for countdown displays (lobby rows and the pick screen).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const act = useCallback(async (event, payload) => {
    setError('');
    setBusy(true);
    try {
      const res = await request(socketRef.current, event, payload);
      if ('room' in res) setRoom(res.room);
      if ('card' in res) setCard(res.card);
      return res;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const marks = card?.marks ?? [];
  const markedCount = Math.max(0, marks.filter(Boolean).length - 1);
  const calledSet = useMemo(() => new Set(room?.called ?? []), [room?.called]);
  const canClaim = Boolean(card) && marks.length > 0 && marks.every(Boolean);
  // What the server says I hold (the local card can lag behind, e.g. right after a round).
  const myCartela = room?.players.find((p) => p.id === myId)?.cartela ?? null;

  const onCell = async (index) => {
    const cell = card?.cells[index];
    if (!cell || marks[index] || room?.phase !== 'playing') return;
    if (!calledSet.has(cell.value)) {
      haptic?.('error');
      setError(`${letterFor(cell.value)}-${cell.value} has not been called yet`);
      return;
    }
    const res = await act('game:mark', { number: cell.value });
    if (res) {
      setCard((c) => ({ ...c, marks: res.marks }));
      playMark();
      haptic?.('light');
      if (res.full) playLine();
    }
  };

  const claim = async () => {
    const res = await act('game:claim');
    if (!res) haptic?.('error');
  };

  const choose = async (cartela) => {
    if (cartela === myCartela) return;
    const res = await act('game:choose', { cartela });
    if (res) haptic?.('light');
  };

  const refresh = () => (room ? act('room:join', { code: room.code }) : act('room:list').then((r) => r && setLobby(r.rooms)));

  const leave = async () => {
    await act('room:leave');
    setRoom(null);
    setCard(null);
    setOver(null);
    setCurrent(null);
    setReady(false);
  };

  const toggleMute = () => setMutedState(setMuted());

  const dismiss = (id) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem('tgb-dismissed', JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  const visibleAnnouncements = announcements.filter((a) => !dismissed.includes(a.id) && (!a.expiresAt || new Date(a.expiresAt) > new Date()));

  const claimBonus = async () => {
    setError('');
    try {
      const r = await api('/economy/bonus/claim', { method: 'POST' });
      setEco(r.economy);
      haptic?.('success');
    } catch (e) {
      setError(e.message);
      haptic?.('error');
    }
  };

  // ---------- lobby ----------
  if (!room) {
    const balance = me?.balance;
    return (
      <Shell>
        <Banner connected={connected} />

        <section className="flex items-center justify-between gap-2">
          <button onClick={onShop} aria-label="Coins and shop" className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-ink-950/70 border border-ink-600 px-3 py-1.5 font-black text-amber-300 active:scale-95">
            🪙 {eco ? eco.coins.toLocaleString() : '—'} <span className="text-[10px] font-bold text-slate-300">SHOP ›</span>
          </button>
          <button onClick={onWallet} className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-ink-950/70 border border-ink-600 px-3 py-1.5 font-black text-lime-300 active:scale-95">
            💵 {balance == null ? '—' : etb(balance)}
          </button>
          <button onClick={onProfile} className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-ink-950/70 border border-ink-600 px-3 py-1.5 font-black text-aqua-300 active:scale-95 truncate">
            👤 {profile?.name ?? user?.first_name ?? me?.name ?? 'Player'}
          </button>
        </section>

        {eco && <DailyBonus bonus={eco.bonus} onClaim={claimBonus} />}

        <Announcements items={visibleAnnouncements} onDismiss={dismiss} />

        {profile && !profile.complete && (
          <button onClick={onProfile} className="text-left rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-ink-950 px-4 py-3 shadow-lg active:scale-[0.99]">
            <span className="block font-black">📝 Finish your sign-up</span>
            <span className="block text-xs font-semibold">Add your display name and phone number to your profile.</span>
          </button>
        )}

        <section className="flex flex-col gap-2">
          {lobby.map(({ stake, room: r, prize, houseCutPercent }, i) => (
            <div key={stake} className={`rounded-2xl bg-gradient-to-r ${CARD_LOOK[i % CARD_LOOK.length]} border border-white/20 p-3 flex items-center gap-3 shadow-lg shadow-black/30`}>
              <span className="flex-1 min-w-0 text-left drop-shadow">
                <span className="block text-xl font-black leading-tight">{stakeLabel(stake)}</span>
                <span className="block text-sm font-bold">{stake === 0 ? 'Free entry' : `${stake} ETB entry`}</span>
                <span className="block text-sm font-black text-amber-300">
                  {stake === 0 ? 'Prize: 🪙 50 coins' : r ? `Prize: ${etb(r.pool)}` : `Prize: ${etb(prize?.min)} – ${etb(prize?.max)}`}
                </span>
                <span className="block text-[11px] text-white/80">
                  {stake > 0 ? `House fee ${houseCutPercent}% · ` : ''}
                  {r ? `${r.players} player${r.players === 1 ? '' : 's'} · ${r.ready} picked · ` : ''}
                  <LobbyStatus room={r} now={now} />
                </span>
              </span>
              <button
                disabled={!connected || busy}
                onClick={() => act('room:join', { stake })}
                className="shrink-0 rounded-xl bg-gradient-to-b from-lime-400 to-green-600 border-2 border-lime-200 px-5 py-2.5 text-lg font-black text-white drop-shadow active:scale-95 disabled:opacity-50"
              >
                JOIN
              </button>
            </div>
          ))}
        </section>

        <section className="rounded-2xl bg-gradient-to-r from-orange-500 to-amber-600 border border-white/20 p-3 flex items-center gap-3 shadow-lg shadow-black/30">
          <span className="text-4xl drop-shadow">🏆</span>
          <span className="flex-1 min-w-0">
            <span className="block text-lg font-black leading-tight drop-shadow">Private Tournament</span>
            <span className="block text-xs text-white/85">Free table with a code to share with friends.</span>
          </span>
          <button disabled={!connected || busy} onClick={() => act('room:create', { stake: 0 })} className="shrink-0 rounded-xl bg-orange-700 border-2 border-amber-200 px-3 py-2 text-sm font-black text-white active:scale-95 disabled:opacity-50">
            Create Room
          </button>
        </section>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            act('room:join', { code });
          }}
          className="flex gap-2"
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            placeholder="ROOM CODE"
            className="flex-1 min-w-0 rounded-xl bg-ink-950/70 border border-ink-600 px-3 py-2.5 font-black tracking-[0.3em] uppercase outline-none"
            aria-label="Room code"
          />
          <button disabled={!connected || busy || code.length < 4} className="px-4 rounded-xl bg-aqua-400 text-ink-950 font-extrabold disabled:opacity-50">
            Join
          </button>
        </form>

        <section className="rounded-2xl bg-ink-800 border border-ink-600/60 p-3">
          <h2 className="font-black mb-2">🏅 Leaderboard</h2>
          {leaders.length === 0 ? (
            <p className="text-xs text-slate-300">No rounds played yet. Be the first!</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {leaders.slice(0, 5).map((l, i) => (
                <li key={l.id} className="flex items-center gap-2 rounded-lg bg-ink-700/70 px-2 py-1 text-sm">
                  <span className="w-5 text-center font-black text-amber-300">{i + 1}</span>
                  <span className="flex-1 truncate font-bold">{l.name}</span>
                  <span className="text-xs text-slate-300">{l.wins} win{l.wins === 1 ? '' : 's'} · {etb(l.winnings)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {error && <p className="text-sm text-rose-400 text-center">{error}</p>}

        <BottomNav
          active="play"
          onNav={onNav}
          badges={{ missions: eco?.missions.some((m) => m.claimable) ? 'NEW' : false, profile: Boolean(profile && !profile.complete) }}
        />
      </Shell>
    );
  }

  // ---------- inside a room ----------
  const secondsLeft = room.startsAt ? Math.max(0, Math.ceil((room.startsAt - now) / 1000)) : null;
  const playing = room.phase === 'playing';
  const open = room.phase === 'waiting' || room.phase === 'countdown';
  const showBoard = playing || room.phase === 'finished' || (open && ready && myCartela);

  if (!showBoard) {
    return (
      <Shell>
        <TopBar onBack={leave} backLabel="Leave" connected={connected} title={`${stakeLabel(room.stake)} · ${room.code}`} />
        <Announcements items={visibleAnnouncements.slice(0, 1)} onDismiss={dismiss} />
        <PickScreen
          room={room}
          card={myCartela ? card : null}
          theme={theme}
          myCartela={myCartela}
          myId={myId}
          busy={busy}
          secondsLeft={secondsLeft}
          onChoose={choose}
          onLeave={leave}
          onRefresh={refresh}
          onStart={() => setReady(true)}
          error={error}
        />
        {over && <WinModal over={over} myId={myId} onAgain={() => setOver(null)} onLeave={leave} />}
      </Shell>
    );
  }

  const playersInRound = room.players.filter((p) => p.playing).length || room.ready;
  return (
    <Shell tight>
      <section className="w-full grid grid-cols-3 gap-2">
        <Stat label="Prize" value={room.stake > 0 ? etb(room.pool) : 'Free'} />
        <Stat label="Call" value={room.callIndex || '–'} />
        <Stat label="Players" value={playersInRound} />
      </section>

      <section className="w-full grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-2 items-start">
        <CalledBoard called={calledSet} current={current} />
        <div className="flex flex-col gap-2 min-w-0">
          {card ? (
            <Card cells={card.cells} marks={marks} onCell={playing ? onCell : null} caption={`Cartela ${card.cartela}`} theme={theme} />
          ) : (
            <div className="rounded-2xl bg-ink-800 border border-ink-600/60 p-4 text-center text-xs text-slate-300">
              Round in progress. Pick a cartela when registration re-opens.
            </div>
          )}
          <div className="rounded-2xl bg-ink-800 border border-ink-600/60 px-3 py-2 flex items-center justify-between">
            <span className="text-[11px] font-black tracking-widest text-slate-300">CALL</span>
            <span key={current} className={`${current ? COL[letterIndex(current)] : 'bg-ink-700'} min-w-[5.5rem] text-center rounded-xl px-3 py-1.5 text-lg font-black text-ink-950 shadow-lg animate-pop`}>
              {current ? `${letterFor(current)}-${current}` : '—'}
            </span>
          </div>
          {card && playing && (
            <p className="text-[11px] text-center text-slate-300">
              {markedCount}/24 marked{canClaim ? ' · press BINGO!' : ''}
            </p>
          )}
        </div>
      </section>

      {error && <p className="text-sm text-rose-400 text-center">{error}</p>}

      <nav className="w-full grid grid-cols-[1fr_1fr_1.3fr_auto] gap-2 mt-auto">
        <button onClick={leave} className="py-2.5 rounded-xl bg-ink-800 border border-rose-500/40 text-rose-300 text-xs font-black tracking-wider active:scale-95">
          LEAVE
        </button>
        <button onClick={refresh} disabled={busy} className="py-2.5 rounded-xl bg-ink-800 border border-aqua-400/40 text-aqua-300 text-xs font-black tracking-wider active:scale-95 disabled:opacity-50">
          REFRESH ⟳
        </button>
        <button
          onClick={claim}
          disabled={!playing || !card || busy}
          className={`py-2.5 rounded-xl text-ink-950 text-sm font-black tracking-wide active:scale-95 disabled:opacity-40 ${canClaim ? 'bg-amber-400 animate-pulse-ring' : 'bg-amber-400/80'}`}
        >
          🎯 BINGO!
        </button>
        <button onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className={`w-11 rounded-xl border text-base active:scale-95 ${muted ? 'bg-ink-800 border-ink-600 text-slate-400' : 'bg-rose-500/20 border-rose-500/50'}`}>
          {muted ? '🔇' : '🔊'}
        </button>
      </nav>

      {open && (
        <Overlay>
          <p className="text-6xl font-black tabular-nums">{secondsLeft ?? '…'}</p>
          <p className="mt-2 font-bold">{room.phase === 'countdown' ? 'Game is about to start!' : 'Waiting for more players…'}</p>
          <span className="my-4 inline-block w-8 h-8 rounded-full border-4 border-rose-500 border-t-transparent animate-spin" />
          <p className="w-full rounded-xl bg-aqua-400 text-ink-950 font-black py-2">
            {room.stake > 0 ? `Prize · ${etb(room.pool)}` : 'Free table'} · {room.ready} playing
          </p>
          <button onClick={() => setReady(false)} className="mt-2 w-full rounded-xl bg-ink-700 border border-ink-600 font-bold py-2">
            Change cartela
          </button>
          <button onClick={leave} className="mt-2 w-full rounded-xl bg-rose-500 text-ink-950 font-black py-2">
            Leave game
          </button>
        </Overlay>
      )}

      {over && (
        <WinModal over={over} myId={myId} onAgain={() => setOver(null)} onLeave={leave} />
      )}
    </Shell>
  );
}

/* ---------- pieces ---------- */

function Shell({ children, tight = false }) {
  return (
    <main className={`min-h-full flex flex-col items-center bg-ink-900 text-slate-100 animate-fade-in ${tight ? 'gap-2 px-2 py-2' : 'gap-3 px-3 py-4'}`}>
      <div className="w-full max-w-sm flex-1 flex flex-col gap-3">{children}</div>
    </main>
  );
}

/** Operator announcements: info (amber), warning (red) or promo (violet); dismissable per device. */
function Announcements({ items, onDismiss }) {
  if (items.length === 0) return null;
  const look = { info: 'from-amber-400 to-orange-500 text-ink-950', warning: 'from-rose-500 to-red-700 text-white', promo: 'from-violet-500 to-fuchsia-600 text-white' };
  const icon = { info: '📢', warning: '⚠️', promo: '🎁' };
  return (
    <div className="flex flex-col gap-2">
      {items.map((a) => (
        <div key={a.id} className={`rounded-2xl bg-gradient-to-r ${look[a.level] ?? look.info} px-3 py-2 flex items-start gap-2 shadow-lg shadow-black/30 animate-fade-in`}>
          <span className="text-xl leading-none">{icon[a.level] ?? '📢'}</span>
          <span className="flex-1 text-sm font-bold leading-snug">{a.text}</span>
          <button onClick={() => onDismiss(a.id)} aria-label="Dismiss" className="text-lg leading-none opacity-80 active:opacity-100">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** Lobby header: paper-plane logo lockup after the mockup. */
function Banner({ connected }) {
  return (
    <header className="relative rounded-2xl bg-gradient-to-b from-ink-600 to-ink-800 border border-ink-600 px-3 py-3 text-center shadow-lg shadow-black/30">
      <span className={`absolute right-3 top-3 w-2.5 h-2.5 rounded-full ${connected ? 'bg-lime-400' : 'bg-rose-500'}`} title={connected ? 'Connected' : 'Disconnected'} />
      <p className="text-2xl font-black tracking-wide leading-none drop-shadow">✈️ TELEGRAM</p>
      <p className="text-4xl font-black tracking-wider leading-none text-amber-300 drop-shadow-[0_3px_0_rgba(0,0,0,0.5)]">★ BINGO ★</p>
    </header>
  );
}

function TopBar({ onBack, backLabel = 'Back', title, connected }) {
  return (
    <header className="w-full flex items-center justify-between rounded-2xl bg-ink-800 border border-ink-600/60 px-3 py-2">
      <button onClick={onBack} className="text-xs font-bold text-slate-300 active:text-white">
        ‹ {backLabel}
      </button>
      <h1 className="font-black tracking-tight">
        <span className="text-aqua-300">TG</span> Bingo{title ? <span className="text-slate-400 font-bold text-xs"> · {title}</span> : null}
      </h1>
      <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-lime-400' : 'bg-rose-500'}`} title={connected ? 'Connected' : 'Disconnected'} />
    </header>
  );
}

/** Daily bonus card: streak day, reward, claim button or countdown to the next one. */
function DailyBonus({ bonus, onClaim }) {
  return (
    <section className="rounded-2xl bg-gradient-to-br from-ink-700 to-ink-800 border border-amber-400/40 p-3 flex items-center gap-3 shadow-lg shadow-black/30">
      <span className={`text-5xl drop-shadow ${bonus.claimable ? 'animate-wiggle' : ''}`}>🎁</span>
      <span className="flex-1 min-w-0">
        <span className="block font-black text-lg leading-tight">Daily Bonus</span>
        <span className="block text-[11px] text-slate-300">
          Day {bonus.streak} streak{bonus.doubled ? ' · ✨ doubled' : ''}{bonus.usesShield ? ' · 🛡️ shield' : ''}
        </span>
        <span className="block text-sm font-black text-amber-300">
          {bonus.claimable ? `+🪙 ${bonus.reward} today` : `Next in ${untilText(bonus.nextAt)}`}
        </span>
      </span>
      <button disabled={!bonus.claimable} onClick={onClaim} className="shrink-0 rounded-xl bg-gradient-to-b from-amber-300 to-orange-500 border-2 border-amber-200 px-4 py-2.5 text-lg font-black text-ink-950 active:scale-95 disabled:opacity-40 disabled:grayscale">
        {bonus.claimable ? 'CLAIM' : 'Claimed ✓'}
      </button>
    </section>
  );
}

function LobbyStatus({ room, now }) {
  if (!room) return <span className="font-bold">Open · be the first</span>;
  if (room.phase === 'countdown') {
    const s = Math.max(0, Math.ceil((room.startsAt - now) / 1000));
    return <span className="font-black text-white tabular-nums">starts in {s} s</span>;
  }
  if (room.phase === 'playing') return <span className="font-bold">in progress · call {room.callIndex}</span>;
  if (room.phase === 'finished') return <span className="font-bold">re-opening…</span>;
  return <span className="font-bold text-lime-300">registering</span>;
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-aqua-400/90 text-ink-950 text-center py-1.5">
      <span className="block text-[10px] font-bold uppercase tracking-wider opacity-80">{label}</span>
      <span className="block text-lg font-black leading-tight">{value}</span>
    </div>
  );
}

/** Pick screen: red timer, 10-column cartela grid with owners, my card preview, actions. */
function PickScreen({ room, card, theme, myCartela, myId, busy, secondsLeft, onChoose, onLeave, onRefresh, onStart, error }) {
  const taken = new Map(room.players.filter((p) => p.cartela).map((p) => [p.cartela, p]));
  const count = room.rules.cartelaCount;
  return (
    <>
      <div className="text-center">
        {room.phase === 'countdown' ? (
          <p className={`text-3xl font-black tabular-nums ${secondsLeft <= 10 ? 'text-rose-500' : 'text-rose-400'}`}>{clock(secondsLeft)}</p>
        ) : (
          <p className="font-bold text-slate-300">
            Registering · {room.ready}/{room.rules.minPlayers} picked
          </p>
        )}
        <p className="text-[11px] text-slate-400">
          {room.stake > 0 ? `${room.stake} ETB per cartela · prize ${etb(room.pool)} (house fee ${room.rules.houseCutPercent}%)` : 'Free table'} · {room.players.length} in room
        </p>
      </div>

      <div className="grid grid-cols-10 gap-1">
        {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
          const owner = taken.get(n);
          const mine = n === myCartela;
          const locked = Boolean(owner) && owner.id !== myId;
          let look = 'bg-ink-700 border-ink-600 text-slate-100 active:scale-90';
          if (mine) look = 'bg-lime-400 border-lime-300 text-ink-950';
          else if (locked) look = 'bg-rose-700 border-rose-600 text-white';
          return (
            <button
              key={n}
              type="button"
              disabled={busy || locked}
              onClick={() => onChoose(n)}
              title={locked ? `Taken by ${owner.name}` : `Cartela ${n}`}
              aria-pressed={mine}
              className={`h-9 rounded-md border flex flex-col items-center justify-center leading-none ${look}`}
            >
              <span className="text-[11px] font-black">{n}</span>
              {locked && <span className="text-[7px] font-bold truncate max-w-full px-0.5">{owner.name.split(' ')[0].slice(0, 6)}</span>}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {card ? (
          <Card cells={card.cells} marks={card.marks} caption={`Cartela ${card.cartela}`} theme={theme} />
        ) : (
          <div className="rounded-2xl border border-dashed border-ink-600 bg-ink-800/60 flex items-center justify-center text-center text-xs text-slate-400 p-4">
            Tap a number above to get your cartela
          </div>
        )}
        <div className="rounded-2xl bg-ink-800 border border-ink-600/60 p-3 text-[11px] text-slate-300 flex flex-col gap-1">
          <p className="font-black text-slate-100 text-xs">Picked ({room.ready})</p>
          {room.players.filter((p) => p.cartela).map((p) => (
            <p key={p.id} className="truncate">
              <span className={`inline-block w-7 text-center rounded font-black ${p.id === myId ? 'bg-lime-400 text-ink-950' : 'bg-rose-700 text-white'}`}>{p.cartela}</span> {p.name}
              {p.id === myId ? ' (you)' : ''}
            </p>
          ))}
          {room.players.filter((p) => !p.cartela).map((p) => (
            <p key={p.id} className="truncate text-slate-500">
              <span className="inline-block w-7 text-center rounded font-black bg-ink-700">?</span> {p.name}
              {p.id === myId ? ' (you)' : ''}
            </p>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-rose-400 text-center">{error}</p>}

      <nav className="grid grid-cols-3 gap-2 mt-auto">
        <button onClick={onLeave} className="py-2.5 rounded-xl bg-ink-800 border border-ink-600 font-bold active:scale-95">
          Leave
        </button>
        <button onClick={onRefresh} disabled={busy} className="py-2.5 rounded-xl bg-ink-800 border border-ink-600 font-bold active:scale-95 disabled:opacity-50">
          Refresh ⟳
        </button>
        <button onClick={onStart} disabled={!myCartela} className="py-2.5 rounded-xl bg-emerald-600 font-black active:scale-95 disabled:opacity-40">
          Start Game
        </button>
      </nav>
    </>
  );
}

/** The 75-number master board: called numbers red, the latest one green. */
function CalledBoard({ called, current }) {
  return (
    <div className="rounded-2xl bg-ink-800 border border-ink-600/60 p-1.5">
      <div className="grid grid-cols-5 gap-1 mb-1">
        {LETTERS.map((l, i) => (
          <span key={l} className={`${COL[i]} rounded-md text-center text-[11px] font-black text-ink-950 py-0.5`}>
            {l}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: 15 }, (_, row) =>
          LETTERS.map((_, col) => {
            const n = col * 15 + row + 1;
            const hit = called.has(n);
            const latest = n === current;
            return (
              <span
                key={n}
                className={`h-5 rounded text-[11px] font-bold flex items-center justify-center ${
                  latest ? 'bg-lime-400 text-ink-950 animate-pop' : hit ? 'bg-rose-600 text-white' : 'bg-ink-700 text-slate-300'
                }`}
              >
                {n}
              </span>
            );
          }),
        )}
      </div>
    </div>
  );
}

/** A cartela: coloured B I N G O header, marked numbers green, centre X. */
function Card({ cells, marks, onCell, caption, highlight = new Set(), theme = themeFor('classic') }) {
  return (
    <div className={`rounded-2xl border p-1.5 ${theme.frame}`}>
      <div className="grid grid-cols-5 gap-1 mb-1">
        {LETTERS.map((l, i) => (
          <span key={l} className={`${theme.cols[i]} rounded-md text-center text-xs font-black text-ink-950 py-0.5`}>
            {l}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1">
        {cells.map((cell) => {
          const free = cell.value === null;
          const marked = marks[cell.index];
          const win = highlight.has(cell.index);
          let look = theme.idle;
          if (win) look = 'bg-rose-600 text-white';
          else if (marked) look = `${theme.marked} animate-pop`;
          const Tag = onCell ? 'button' : 'span';
          return (
            <Tag
              key={cell.index}
              type={onCell ? 'button' : undefined}
              disabled={onCell ? free || marked : undefined}
              onClick={onCell ? () => onCell(cell.index) : undefined}
              aria-pressed={onCell ? marked : undefined}
              className={`aspect-square rounded-md text-sm font-black flex items-center justify-center select-none ${look} ${onCell && !free && !marked ? 'active:scale-90' : ''}`}
            >
              {free ? '★' : cell.value}
            </Tag>
          );
        })}
      </div>
      {caption && <p className="mt-1 text-center text-[10px] font-bold text-aqua-300">{caption}</p>}
    </div>
  );
}

function Overlay({ children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/80 backdrop-blur-sm px-8 animate-fade-in">
      <div className="w-full max-w-xs text-center">{children}</div>
    </div>
  );
}

function WinModal({ over, myId, onAgain, onLeave }) {
  const w = over.winner;
  const iWon = Boolean(w) && w.id === myId;
  const line = new Set(w?.line ?? []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/85 backdrop-blur-sm px-6 animate-fade-in">
      <div role="dialog" aria-modal="true" className="w-full max-w-xs rounded-3xl bg-ink-800 border border-aqua-400/40 p-5 text-center shadow-2xl animate-modal-in">
        <h2 className="text-lg font-black text-amber-300 mb-3">{w ? `${w.name} won!! 🎉` : 'No winner this round 😶'}</h2>
        {w && (
          <>
            <p className="inline-block rounded-lg bg-ink-700 px-3 py-1 font-black text-amber-300 text-lg">{w.name}</p>
            <p className="text-sm text-slate-300 mt-1 mb-2">Cartela ~ {w.cartela}</p>
            <Card cells={w.card} marks={w.marks} highlight={w.full ? new Set() : line} />
            <p className="mt-3 font-black text-amber-300 text-lg">
              {w.full ? 'Full card' : 'Line'}
              {w.prize > 0 ? ` | ${etb(w.prize)} won` : ''}
            </p>
            {iWon && <p className="text-sm text-lime-400 font-bold">That is you! 🏆</p>}
          </>
        )}
        {!w && <p className="text-sm text-slate-300">{over.called.length} numbers were called. Stakes were refunded.</p>}
        <button onClick={onAgain} className="mt-4 w-full py-2.5 rounded-full border-2 border-slate-100 font-black active:scale-95">
          Play Again ➤➤➤
        </button>
        <button onClick={onLeave} className="mt-2 text-sm text-slate-400">
          Leave room
        </button>
      </div>
    </div>
  );
}
