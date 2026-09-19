import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { connectSocket, request } from '../lib/socket.js';
import { api, cached } from '../lib/api.js';
import { themeFor } from '../lib/themes.js';
import { BottomNav } from './Nav.jsx';
import Logo from './Logo.jsx';
import { LETTERS, winningPattern, isCorners } from '../lib/bingo.js';
import { playMark, playLine, playWin, announceCall, isMuted, getVoice, cycleSound, preloadCalls } from '../lib/sound.js';
import { LANGS, etb, t, tError, useLang, useT } from '../lib/i18n.js';

/* Column colours as in the reference app: B red, I blue, N green, G amber, O violet. */
const COL = ['bg-red-600 text-white', 'bg-blue-600 text-white', 'bg-yellow-400 text-ink-950', 'bg-green-600 text-white', 'bg-purple-600 text-white'];
const letterIndex = (n) => Math.floor((n - 1) / 15);
const letterFor = (n) => LETTERS[letterIndex(n)];
/** 65 -> "01:05" */
const clock = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const stakeLabel = (stake) => (stake === 0 ? t('lobby.freeBingo') : t('lobby.stakeBingo', { amount: etb(stake) }));
/* Card looks per stake, after the lobby mockup: red, orange, green, purple. */
const CARD_LOOK = ['from-red-600 to-red-800', 'from-blue-500 to-blue-800', 'from-green-500 to-green-800', 'from-purple-500 to-purple-800'];

/** Home screen: lobby by stake, cartela pick, live table, win modal. */
export default function Game({ user, onNav, haptic, active = true }) {
  const t = useT();
  const onWallet = () => onNav('wallet');
  const onProfile = () => onNav('profile');
  const onShop = () => onNav('shop');
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [me, setMe] = useState(null);
  const [lobby, setLobby] = useState([]);
  const [room, setRoom] = useState(null);
  const [cards, setCards] = useState(null); // my cartelas this round: [{ cartela, cells, marks }]
  const [current, setCurrent] = useState(null);
  const [over, setOver] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(null); // stake of the table being joined: the button answers the tap at once
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState(false); // pressed "Start Game" on the pick screen
  const [muted, setMutedState] = useState(isMuted());
  const [voice, setVoice] = useState(getVoice()); // call-out language: 'am' (recorded Amharic) or 'en'
  // AUTO: called numbers are marked on my cartelas without tapping (remembered per device, on by default).
  const [auto, setAuto] = useState(() => {
    try {
      return localStorage.getItem('tgb-auto') !== '0';
    } catch {
      return true;
    }
  });
  const [profile, setProfile] = useState(() => cached('/profile'));
  const [leaders, setLeaders] = useState(() => cached('/profile/leaderboard')?.leaders ?? []);
  const [eco, setEco] = useState(() => cached('/economy')); // coins, daily bonus, missions, selected skin
  const [announcements, setAnnouncements] = useState(() => cached('/announcements')?.announcements ?? []);
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
  const roomRef = useRef(room);
  roomRef.current = room;

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
      setCards(null);
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
        if (!mine?.cartelas?.length) setCards(null);
      }
    });
    // Sent when the player picks a cartela and again (with fresh marks) when the round starts.
    socket.on('game:card', (c) => {
      setCards(c?.cards?.length ? c.cards : null);
      setOver(null);
    });
    // The server calls the next number by itself once the countdown is over.
    socket.on('game:number', ({ number, letter, called }) => {
      setCurrent(number);
      setRoom((r) => (r ? { ...r, called, current: number, callIndex: called.length } : r));
      announceCall(letter ?? letterFor(number), number);
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

  // Profile (sign-up status) and leaderboard for the lobby. Refreshed every round and whenever the player
  // comes back from another screen (the game stays mounted behind them, see App.jsx).
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    api('/profile').then((p) => alive && setProfile(p)).catch(() => {});
    api('/profile/leaderboard').then((r) => alive && setLeaders(r.leaders)).catch(() => {});
    api('/economy').then((e) => alive && setEco(e)).catch(() => {});
    api('/announcements').then((r) => alive && setAnnouncements(r.announcements)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [room?.round, active]);

  // Tick for countdown displays (lobby rows and the pick screen).
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const act = useCallback(async (event, payload) => {
    setError('');
    setBusy(true);
    try {
      const res = await request(socketRef.current, event, payload);
      if ('room' in res) setRoom(res.room);
      if ('card' in res) setCards(res.card?.cards?.length ? res.card.cards : null);
      return res;
    } catch (e) {
      // A stake the wallet cannot cover sends the player straight to the deposit page.
      if (/^Insufficient balance/.test(e.message)) {
        onNav('wallet', { need: payload?.stake ?? roomRef.current?.stake ?? 0 });
        return null;
      }
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [onNav]);

  const join = async (stake) => {
    setJoining(stake);
    haptic?.('light');
    await act('room:join', { stake });
    setJoining(null);
  };

  // Nothing is on the board until the round runs: during registration and the countdown the
  // previous round's numbers must not look like the draw to come.
  const boardOpen = room?.phase === 'waiting' || room?.phase === 'countdown';
  const shownCalled = useMemo(() => (boardOpen ? [] : room?.called ?? []), [boardOpen, room?.called]);
  const calledSet = useMemo(() => new Set(shownCalled), [shownCalled]);
  // Same rule as the server: a full card when FULL_CARD is on, else a row/column/diagonal or the four corners.
  const cardWins = (c) => (room?.rules?.fullCard ? c.marks.length > 0 && c.marks.every(Boolean) : Boolean(winningPattern(c.marks, room?.rules?.linesToWin ?? 1)));
  const canClaim = Boolean(cards?.some(cardWins));
  // What the server says I hold (the local cards can lag behind, e.g. right after a round).
  const myCartelas = room?.players.find((p) => p.id === myId)?.cartelas ?? [];
  const maxCartelas = room?.rules?.maxCartelas ?? 4;

  // Refs let the tap handlers stay referentially stable (so memoized cards and grids do not
  // re-render on every clock tick) while still seeing the latest state.
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const calledRef = useRef(calledSet);
  calledRef.current = calledSet;
  const myCartelasRef = useRef(myCartelas);
  myCartelasRef.current = myCartelas;
  const sentMarks = useRef(new Set()); // numbers already sent to the server this round
  const chimed = useRef(false); // the "you can claim" chime plays once per round

  useEffect(() => {
    sentMarks.current = new Set();
    chimed.current = false;
  }, [room?.round, room?.code]);

  /**
   * Marks `number` at once on every cartela of mine that has it, then tells the server in the
   * background. The tap never waits for the network: the server's answer only reconciles, and
   * a refusal puts the cell back.
   */
  const markNumber = useCallback(
    (number) => {
      if (sentMarks.current.has(number)) return;
      sentMarks.current.add(number);
      const setMark = (value) =>
        setCards(
          (list) =>
            list?.map((c) => {
              const i = c.cells.findIndex((cell) => cell.value === number);
              if (i < 0 || c.marks[i] === value) return c;
              const marks = c.marks.slice();
              marks[i] = value;
              return { ...c, marks };
            }) ?? list,
        );
      setMark(true);
      playMark();
      haptic?.('light');
      request(socketRef.current, 'game:mark', { number })
        .then((res) => {
          // The server's marks win, but never undo a newer tap that is still in flight.
          const fresh = new Map((res.cards ?? []).map((c) => [c.cartela, c.marks]));
          setCards((list) => list?.map((c) => (fresh.has(c.cartela) ? { ...c, marks: c.marks.map((m, i) => m || fresh.get(c.cartela)[i]) } : c)) ?? list);
          if (!chimed.current && res.cards?.some((c) => c.canClaim)) {
            chimed.current = true;
            playLine();
          }
        })
        .catch((e) => {
          sentMarks.current.delete(number);
          setMark(false);
          setError(e.message);
          haptic?.('error');
        });
    },
    [haptic],
  );

  /** Tap on cell `index` of my `cardIndex`-th cartela. Stable identity: see the refs above. */
  const onCell = useCallback(
    (cardIndex, index) => {
      const card = cardsRef.current?.[cardIndex];
      const cell = card?.cells[index];
      if (!cell || cell.value === null || card.marks[index] || roomRef.current?.phase !== 'playing') return;
      if (!calledRef.current.has(cell.value)) {
        haptic?.('error');
        setError(t('game.notCalledYet', { call: `${letterFor(cell.value)}-${cell.value}` }));
        return;
      }
      markNumber(cell.value);
    },
    [markNumber, haptic],
  );

  // AUTO mode: whenever a called number sits unmarked on one of my cartelas, mark it (all at once, no queue).
  useEffect(() => {
    if (!auto || room?.phase !== 'playing' || !cards?.length) return;
    for (const n of room.called ?? []) {
      if (!sentMarks.current.has(n) && cards.some((c) => c.cells.some((cell, i) => cell.value === n && !c.marks[i]))) markNumber(n);
    }
  }, [auto, current, room?.phase, room?.called, cards, markNumber]);

  const claim = async () => {
    const res = await act('game:claim');
    if (!res) haptic?.('error');
  };

  // Cartela picks show instantly: `pendingPicks[n]` is true while taking n, false while giving it back.
  const [pendingPicks, setPendingPicks] = useState({});
  const pendingRef = useRef(pendingPicks);
  pendingRef.current = pendingPicks;
  const shownCartelas = useMemo(() => {
    const kept = myCartelas.filter((n) => pendingPicks[n] !== false);
    const taking = Object.keys(pendingPicks).map(Number).filter((n) => pendingPicks[n] === true && !myCartelas.includes(n));
    return [...kept, ...taking].sort((a, b) => a - b);
  }, [myCartelas.join(','), pendingPicks]);

  /** Tap a cartela number on the pick screen: mine → give it back, free → take it. No waiting on the network. */
  const choose = useCallback(
    (cartela) => {
      if (cartela in pendingRef.current) return; // that tap is still on its way
      const mine = myCartelasRef.current.includes(cartela);
      setPendingPicks((p) => ({ ...p, [cartela]: !mine }));
      haptic?.('light');
      request(socketRef.current, mine ? 'game:release' : 'game:choose', { cartela })
        .then((res) => {
          if ('room' in res) setRoom(res.room);
          if ('card' in res) setCards(res.card?.cards?.length ? res.card.cards : null);
        })
        .catch((e) => {
          if (/^Insufficient balance/.test(e.message)) onNav('wallet', { need: roomRef.current?.stake ?? 0 });
          else setError(e.message);
          haptic?.('error');
        })
        .finally(() =>
          setPendingPicks((p) => {
            const { [cartela]: _done, ...rest } = p;
            return rest;
          }),
        );
    },
    [haptic, onNav],
  );

  const refresh = () => (room ? act('room:join', { code: room.code }) : act('room:list').then((r) => r && setLobby(r.rooms)));

  const leave = async () => {
    await act('room:leave');
    setRoom(null);
    setCards(null);
    setOver(null);
    setCurrent(null);
    setReady(false);
  };

  // One button: Amharic → English → muted.
  const toggleMute = () => {
    const next = cycleSound();
    setMutedState(next.muted);
    setVoice(next.voice);
  };

  // Sitting down at a table starts fetching the Amharic call-outs, so the first call is not late.
  useEffect(() => {
    if (room?.code) preloadCalls();
  }, [room?.code]);
  const toggleAuto = () => {
    setAuto((v) => {
      try {
        localStorage.setItem('tgb-auto', v ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !v;
    });
  };

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

  // ---------- lobby ----------
  if (!room) {
    const balance = me?.balance;
    return (
      <Shell>
        <Banner connected={connected} />

        <section className="flex items-center justify-between gap-2">
          <button onClick={onShop} aria-label={t('lobby.shopAria')} className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-ink-950/70 border border-ink-600 px-3 py-1.5 font-black text-amber-300 active:scale-95">
            🪙 {eco ? eco.coins.toLocaleString() : '—'} <span className="text-[10px] font-bold text-slate-300">{t('lobby.shop')}</span>
          </button>
          <button onClick={onWallet} className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-ink-950/70 border border-ink-600 px-3 py-1.5 font-black text-lime-300 active:scale-95">
            💵 {balance == null ? '—' : etb(balance)}
          </button>
          <button onClick={onProfile} className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-ink-950/70 border border-ink-600 px-3 py-1.5 font-black text-aqua-300 active:scale-95 truncate">
            👤 {profile?.name ?? user?.first_name ?? me?.name ?? t('common.player')}
          </button>
        </section>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 pb-1">
        <Announcements items={visibleAnnouncements} onDismiss={dismiss} />

        {profile && !profile.complete && (
          <button onClick={onProfile} className="text-left rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-ink-950 px-4 py-3 shadow-lg active:scale-[0.99]">
            <span className="block font-black">📝 {t('lobby.finishSignup')}</span>
            <span className="block text-xs font-semibold">{t('lobby.finishSignupHelp')}</span>
          </button>
        )}

        <section className="flex flex-col gap-2">
          {lobby.map(({ stake, room: r, maxPrize }, i) => (
            <div key={stake} className={`rounded-2xl bg-gradient-to-r ${CARD_LOOK[i % CARD_LOOK.length]} border border-white/20 p-3 flex items-center gap-3 shadow-lg shadow-black/30`}>
              <span className="flex-1 min-w-0 text-left drop-shadow">
                <span className="block text-xl font-black leading-tight">{stakeLabel(stake)}</span>
                <span className="block text-sm font-bold">{stake === 0 ? t('lobby.freeEntry') : t('lobby.entry', { amount: etb(stake) })}</span>
                <span className="block text-sm font-black text-amber-300">
                  {stake === 0 ? t('lobby.prizeCoins', { coins: 50 }) : t('lobby.prizeUpTo', { amount: etb(maxPrize ?? 3000) })}
                </span>
                <span className="block text-[11px] text-white/80">
                  {r ? `${t(r.players === 1 ? 'lobby.player' : 'lobby.players', { n: r.players })} · ${t('lobby.picked', { n: r.ready })} · ` : ''}
                  <LobbyStatus room={r} now={now} />
                </span>
              </span>
              <button
                disabled={!connected || busy}
                onClick={() => (stake > 0 && (balance ?? 0) < stake ? onNav('wallet', { need: stake }) : join(stake))}
                className={`shrink-0 rounded-xl border-2 px-5 py-2.5 text-lg font-black text-white drop-shadow active:scale-95 disabled:opacity-50 ${
                  stake > 0 && (balance ?? 0) < stake ? 'bg-gradient-to-b from-amber-400 to-orange-600 border-amber-200' : 'bg-gradient-to-b from-lime-400 to-green-600 border-lime-200'
                }`}
              >
                {joining === stake ? t('lobby.joining') : stake > 0 && (balance ?? 0) < stake ? t('lobby.deposit') : t('lobby.join')}
              </button>
            </div>
          ))}
        </section>

        <section className="rounded-2xl bg-ink-800 border border-ink-600/60 p-3">
          <h2 className="font-black mb-2">🏅 {t('lobby.leaderboard')}</h2>
          {leaders.length === 0 ? (
            <p className="text-xs text-slate-300">{t('lobby.noRounds')}</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {leaders.slice(0, 5).map((l, i) => (
                <li key={l.id} className="flex items-center gap-2 rounded-lg bg-ink-700/70 px-2 py-1 text-sm">
                  <span className="w-5 text-center font-black text-amber-300">{i + 1}</span>
                  <span className="flex-1 truncate font-bold">{l.name}</span>
                  <span className="text-xs text-slate-300">{t(l.wins === 1 ? 'lobby.win' : 'lobby.wins', { n: l.wins })} · {etb(l.winnings)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {error && <p className="text-sm text-rose-400 text-center">{tError(error)}</p>}
        </div>

        <BottomNav
          active="play"
          onNav={onNav}
          badges={{ missions: eco?.missions.some((m) => m.claimable) ? t('nav.new') : false, profile: Boolean(profile && !profile.complete) }}
        />
      </Shell>
    );
  }

  // ---------- inside a room ----------
  const secondsLeft = room.startsAt ? Math.max(0, Math.ceil((room.startsAt - now) / 1000)) : null;
  const playing = room.phase === 'playing';
  const open = room.phase === 'waiting' || room.phase === 'countdown';
  const showBoard = playing || room.phase === "finished" || (open && ready && shownCartelas.length > 0);

  if (!showBoard) {
    return (
      <Shell>
        <TopBar onBack={leave} backLabel={t('game.leave')} connected={connected} title={`${stakeLabel(room.stake)} · ${room.code}`} />
        <Announcements items={visibleAnnouncements.slice(0, 1)} onDismiss={dismiss} />
        <PickScreen
          room={room}
          cards={shownCartelas.length ? cards : null}
          theme={theme}
          myCartelas={shownCartelas}
          maxCartelas={maxCartelas}
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
  const many = (cards?.length ?? 0) >= 3;
  return (
    <Shell tight>
      <section className="w-full grid grid-cols-3 gap-2">
        <Stat label={t('game.stat.prize')} value={room.stake > 0 ? etb(room.pool) : t('game.free')} />
        <Stat label={t('game.stat.call')} value={shownCalled.length || '–'} />
        {/* The prize is built from cartelas, not heads: 3 players holding 12 cartelas play for 12 stakes. */}
        <Stat label={t('game.stat.playersCartelas')} value={`${playersInRound} · ${room.tickets ?? 0}`} />
      </section>

      {many ? (
        /* 3–4 cartelas: no master board; a slim call strip and the cards across the full width. */
        <section className="w-full flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
          <CallStrip current={boardOpen ? null : current} called={shownCalled} />
          <div className="grid grid-cols-2 gap-2">
            {cards.map((c, i) => (
              <Card
                key={c.cartela}
                cells={c.cells}
                marks={c.marks}
                called={calledSet}
                cardIndex={i}
                onCell={playing ? onCell : null}
                caption={`${t('game.cartela', { n: c.cartela })} · ${Math.max(0, c.marks.filter(Boolean).length - 1)}/24`}
                theme={theme}
              />
            ))}
            {cards.length === 3 && <LogoTile />}
          </div>
          {canClaim && playing && <p className="text-[11px] text-center font-bold text-amber-300">{t('game.youHaveBingo')}</p>}
        </section>
      ) : (
        /* 1–2 cartelas: master board on the left, call pill and cards on the right. */
        <section className="w-full flex-1 min-h-0 overflow-y-auto grid gap-2 items-stretch grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <CalledBoard called={calledSet} current={boardOpen ? null : current} />
          <div className="flex flex-col gap-2 min-w-0">
            <div className="rounded-2xl bg-ink-800 border border-ink-600/60 px-3 py-2 flex items-center justify-between">
              <span className="text-[11px] font-black tracking-widest text-slate-300">{t('game.callLabel')}</span>
              <span key={current} className={`${current ? COL[letterIndex(current)] : 'bg-ink-700'} min-w-[6rem] text-center rounded-xl px-4 py-1.5 text-2xl font-black shadow-lg animate-pop`} aria-live="polite">
                {current ? `${letterFor(current)}-${current}` : '—'}
              </span>
            </div>
            {shownCalled.length > 1 && (
              <div className="flex flex-wrap justify-center gap-1" aria-label={t('game.previousCalls')}>
                {shownCalled
                  .slice(-6, -1)
                  .reverse()
                  .map((n) => (
                    <span key={n} className={`${COL[letterIndex(n)]} rounded-md px-1.5 py-0.5 text-[11px] font-black opacity-80`}>
                      {letterFor(n)}-{n}
                    </span>
                  ))}
              </div>
            )}
            {cards?.length ? (
              <div className="flex flex-col gap-2">
                {cards.map((c, i) => (
                  <Card
                    key={c.cartela}
                    cells={c.cells}
                    marks={c.marks}
                    called={calledSet}
                    cardIndex={i}
                    onCell={playing ? onCell : null}
                    caption={`${t('game.cartela', { n: c.cartela })} · ${Math.max(0, c.marks.filter(Boolean).length - 1)}/24`}
                    theme={theme}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-ink-800 border border-ink-600/60 p-4 text-center text-xs text-slate-300">
                {t('game.roundInProgress')}
              </div>
            )}
            {canClaim && playing && <p className="text-[11px] text-center font-bold text-amber-300">{t('game.youHaveBingo')}</p>}
          </div>
        </section>
      )}

      {error && <p className="text-sm text-rose-400 text-center">{tError(error)}</p>}

      <nav className="w-full grid grid-cols-[1fr_1fr_1.2fr_auto_auto] gap-1.5 mt-auto">
        <button onClick={leave} className="py-2.5 rounded-xl bg-ink-800 border border-rose-500/40 text-rose-300 text-xs font-black tracking-wider active:scale-95">
          {t('game.leaveCaps')}
        </button>
        <button onClick={refresh} disabled={busy} className="py-2.5 rounded-xl bg-ink-800 border border-aqua-400/40 text-aqua-300 text-xs font-black tracking-wider active:scale-95 disabled:opacity-50">
          {t('game.refreshCaps')} ⟳
        </button>
        <button
          onClick={claim}
          disabled={!playing || !cards?.length || busy}
          className={`py-2.5 rounded-xl text-ink-950 text-sm font-black tracking-wide active:scale-95 disabled:opacity-40 ${canClaim ? 'bg-amber-400 animate-pulse-ring' : 'bg-amber-400/80'}`}
        >
          🎯 {t('game.bingo')}
        </button>
        <button onClick={toggleMute} aria-label={muted ? t('game.sound.offAria') : voice === 'am' ? t('game.sound.amAria') : t('game.sound.enAria')} className={`w-11 flex flex-col items-center justify-center gap-0.5 leading-none rounded-xl border text-base active:scale-95 ${muted ? 'bg-ink-800 border-ink-600 text-slate-400' : 'bg-rose-500/20 border-rose-500/50'}`}>
          <span>{muted ? '🔇' : '🔊'}</span>
          {!muted && <span className="text-[9px] font-black">{voice === 'am' ? 'አማ' : 'EN'}</span>}
        </button>
        <button
          onClick={toggleAuto}
          aria-pressed={auto}
          title={t('game.autoTitle')}
          className={`px-2 rounded-xl border text-[10px] font-black leading-tight active:scale-95 ${auto ? 'bg-lime-400/20 border-lime-400/60 text-lime-300' : 'bg-ink-800 border-ink-600 text-slate-400'}`}
        >
          AUTO
          <span className={`mt-0.5 block h-3.5 w-7 mx-auto rounded-full relative ${auto ? 'bg-lime-400' : 'bg-ink-600'}`}>
            <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${auto ? 'right-0.5' : 'left-0.5'}`} />
          </span>
        </button>
      </nav>

      {open && (
        <Overlay>
          <p className="text-6xl font-black tabular-nums">{secondsLeft ?? '…'}</p>
          <p className="mt-2 font-bold">{room.phase === 'countdown' ? t('game.aboutToStart') : t('game.waitingPlayers')}</p>
          <span className="my-4 inline-block w-8 h-8 rounded-full border-4 border-rose-500 border-t-transparent animate-spin" />
          <p className="w-full rounded-xl bg-aqua-400 text-ink-950 font-black py-2">
            {room.stake > 0 ? t('game.prizePool', { amount: etb(room.pool) }) : t('game.freeTable')} · {t('game.nPlaying', { n: room.ready })} · {t('game.nCartelas', { n: room.tickets ?? 0 })}
          </p>
          <button onClick={() => setReady(false)} className="mt-2 w-full rounded-xl bg-ink-700 border border-ink-600 font-bold py-2">
            {t('game.changeCartela')}
          </button>
          <button onClick={leave} className="mt-2 w-full rounded-xl bg-rose-500 text-ink-950 font-black py-2">
            {t('game.leaveGame')}
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

/** Every screen is exactly one viewport tall; long content scrolls inside its own box, never the page. */
function Shell({ children, tight = false }) {
  return (
    <main className={`h-[100dvh] overflow-hidden flex flex-col items-center bg-ink-900 text-slate-100 animate-fade-in ${tight ? 'gap-2 px-2 py-2' : 'gap-3 px-3 py-3'}`}>
      <div className={`w-full max-w-sm flex-1 min-h-0 flex flex-col ${tight ? 'gap-2' : 'gap-3'}`}>{children}</div>
    </main>
  );
}

/** Operator announcements: info (amber), warning (red) or promo (violet); dismissable per device. */
function Announcements({ items, onDismiss }) {
  const t = useT();
  if (items.length === 0) return null;
  const look = { info: 'from-amber-400 to-orange-500 text-ink-950', warning: 'from-rose-500 to-red-700 text-white', promo: 'from-violet-500 to-fuchsia-600 text-white' };
  const icon = { info: '📢', warning: '⚠️', promo: '🎁' };
  return (
    <div className="flex flex-col gap-2">
      {items.map((a) => (
        <div key={a.id} className={`rounded-2xl bg-gradient-to-r ${look[a.level] ?? look.info} px-3 py-2.5 flex items-start gap-2 shadow-[0_12px_30px_rgba(15,23,42,0.2)] animate-fade-in`}>
          <span className="text-xl leading-none">{icon[a.level] ?? '📢'}</span>
          <span className="flex-1 text-sm font-bold leading-snug">{a.text}</span>
          <button onClick={() => onDismiss(a.id)} aria-label={t('game.dismiss')} className="text-lg leading-none opacity-80 active:opacity-100">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

/** Lobby header: paper-plane logo lockup after the mockup, with the language switch in its corner. */
function Banner({ connected }) {
  const t = useT();
  const [lang, setLang] = useLang();
  const otherLang = LANGS.find((l) => l.id !== lang);
  return (
    <header className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-red-600/25 via-ink-800 to-ink-900 px-4 py-3 text-center shadow-[0_18px_40px_rgba(3,11,42,0.5)]">
      {/* Names the language the tap switches to. In the corner, so the pill row below stays as wide as it was. */}
      <button onClick={() => setLang(otherLang.id)} aria-label={t('lobby.langAria')} className="absolute left-3 top-3 z-10 rounded-full bg-ink-950/70 border border-ink-600 px-2.5 py-1 text-xs font-black text-slate-100 active:scale-95">
        🌐 {otherLang.short}
      </button>
      <span className={`absolute right-3 top-3 h-2.5 w-2.5 rounded-full ${connected ? 'bg-lime-400' : 'bg-red-500'} shadow-[0_0_16px_rgba(255,255,255,0.35)]`} title={connected ? t('common.connected') : t('common.disconnected')} />
      <div className="absolute inset-x-8 top-0 h-16 rounded-b-full bg-white/5 blur-2xl" />
      <Logo size="md" className="relative" />
    </header>
  );
}

function TopBar({ onBack, backLabel = null, title, connected }) {
  const t = useT();
  return (
    <header className="w-full flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/95 px-3 py-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.35)]">
      <button onClick={onBack} className="flex items-center gap-1 text-xs font-bold text-slate-300 active:text-white">
        <span className="text-base leading-none">‹</span>
        <span>{backLabel ?? t('common.back')}</span>
      </button>
      <h1 className="text-sm font-black tracking-[0.06em] text-slate-100 uppercase">
        <span className="text-red-400">USA</span> <span className="text-aqua-400">Bingo</span>
        {title ? <span className="ml-2 text-[10px] font-bold tracking-wide text-slate-400">{title}</span> : null}
      </h1>
      <span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-lime-400' : 'bg-rose-500'}`} title={connected ? t('common.connected') : t('common.disconnected')} />
    </header>
  );
}

function LobbyStatus({ room, now }) {
  const t = useT();
  if (!room) return <span className="font-bold">{t('lobby.status.open')}</span>;
  if (room.phase === 'countdown') {
    const s = Math.max(0, Math.ceil((room.startsAt - now) / 1000));
    return <span className="font-black text-white tabular-nums">{t('lobby.status.startsIn', { s })}</span>;
  }
  if (room.phase === 'playing') return <span className="font-bold">{t('lobby.status.playing', { n: room.callIndex })}</span>;
  if (room.phase === 'finished') return <span className="font-bold">{t('lobby.status.reopening')}</span>;
  return <span className="font-bold text-lime-300">{t('lobby.status.registering')}</span>;
}

function Stat({ label, value }) {
  return (
    <div className="rounded-2xl border border-aqua-300/30 bg-gradient-to-b from-aqua-400/20 to-slate-900/80 px-2 py-2 text-center shadow-[0_8px_20px_rgba(15,23,42,0.2)]">
      <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">{label}</span>
      <span className="mt-1 block text-lg font-black leading-tight text-aqua-200">{value}</span>
    </div>
  );
}

/** Pick screen: red timer, 10-column cartela grid with owners, previews of my cartelas, actions. */
function PickScreen({ room, cards, theme, myCartelas, maxCartelas, myId, busy, secondsLeft, onChoose, onLeave, onRefresh, onStart, error }) {
  const t = useT();
  // Rebuilt only when picks change, so the memoized grid below skips the twice-a-second clock ticks.
  const takenKey = room.players.map((p) => `${p.id}:${p.name}:${(p.cartelas ?? []).join(".")}`).join("|");
  const taken = useMemo(() => new Map(room.players.flatMap((p) => (p.cartelas ?? []).map((n) => [n, p]))), [takenKey]);
  const mine = useMemo(() => new Set(myCartelas), [myCartelas.join(",")]);
  const count = room.rules.cartelaCount;
  const atMax = myCartelas.length >= maxCartelas;
  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2">
      <div className="text-center">
        {room.phase === 'countdown' ? (
          <p className={`text-3xl font-black tabular-nums ${secondsLeft <= 10 ? 'text-rose-500' : 'text-rose-400'}`}>{clock(secondsLeft)}</p>
        ) : (
          <p className="font-bold text-slate-300">
            {t('pick.registering', { ready: room.ready, min: room.rules.minPlayers })}
          </p>
        )}
        <p className="text-[11px] text-slate-400">
          {room.stake > 0 ? t('pick.perCartela', { amount: etb(room.stake), n: room.tickets ?? 0, prize: etb(room.pool) }) : t('game.freeTable')} · {t('pick.inRoom', { n: room.players.length })}
        </p>
        <p className="text-xs font-bold text-amber-300">
          {t('pick.count', { n: myCartelas.length, max: maxCartelas })}
          {room.stake > 0 && myCartelas.length > 0 ? ` · ${t('pick.staked', { amount: etb(myCartelas.length * room.stake) })}` : ''}
          {atMax ? ` · ${t('pick.giveBackHint')}` : ''}
        </p>
      </div>

      <CartelaGrid count={count} taken={taken} mine={mine} myId={myId} atMax={atMax} onChoose={onChoose} />

      <div className="flex gap-2 overflow-x-auto shrink-0 pb-1">
        {cards?.length ? (
          cards.map((c) => (
            <div key={c.cartela} className="w-32 shrink-0">
              <Card cells={c.cells} marks={c.marks} caption={t('game.cartela', { n: c.cartela })} theme={theme} compact />
            </div>
          ))
        ) : (
          <div className="w-full rounded-2xl border border-dashed border-ink-600 bg-ink-800/60 flex items-center justify-center text-center text-xs text-slate-400 p-4">
            {t('pick.empty', { max: maxCartelas })}
          </div>
        )}
      </div>
      <div className="max-h-28 overflow-y-auto shrink-0">
        <div className="rounded-2xl bg-ink-800 border border-ink-600/60 p-3 text-[11px] text-slate-300 flex flex-col gap-1">
          <p className="font-black text-slate-100 text-xs">{t('pick.pickedList', { n: room.ready })}</p>
          {room.players.filter((p) => p.cartelas?.length).map((p) => (
            <p key={p.id} className="truncate">
              <span className={`inline-block min-w-7 px-1 text-center rounded font-black ${p.id === myId ? 'bg-lime-400 text-ink-950' : 'bg-rose-700 text-white'}`}>{p.cartelas.join(' ')}</span> {p.name}
              {p.id === myId ? ` ${t('pick.you')}` : ''}
            </p>
          ))}
          {room.players.filter((p) => !p.cartelas?.length).map((p) => (
            <p key={p.id} className="truncate text-slate-500">
              <span className="inline-block w-7 text-center rounded font-black bg-ink-700">?</span> {p.name}
              {p.id === myId ? ` ${t('pick.you')}` : ''}
            </p>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-rose-400 text-center">{tError(error)}</p>}
      </div>

      <nav className="grid grid-cols-3 gap-2 mt-auto shrink-0">
        <button onClick={onLeave} className="py-2.5 rounded-xl bg-ink-800 border border-ink-600 font-bold active:scale-95">
          {t('game.leave')}
        </button>
        <button onClick={onRefresh} disabled={busy} className="py-2.5 rounded-xl bg-ink-800 border border-ink-600 font-bold active:scale-95 disabled:opacity-50">
          {t('game.refresh')} ⟳
        </button>
        <button onClick={onStart} disabled={myCartelas.length === 0} className="py-2.5 rounded-xl bg-emerald-600 font-black active:scale-95 disabled:opacity-40">
          {t('pick.start')}
        </button>
      </nav>
    </>
  );
}

/** Slim call bar for the many-cartela layout: the latest number big, the five before it small. */
function CallStrip({ current, called }) {
  const t = useT();
  return (
    <div className="rounded-2xl bg-ink-800 border border-ink-600/60 px-3 py-2 flex items-center gap-2 shrink-0">
      <span className="text-[11px] font-black tracking-widest text-slate-300">{t('game.callLabel')}</span>
      <span key={current} className={`${current ? COL[letterIndex(current)] : 'bg-ink-700'} min-w-[5.5rem] text-center rounded-xl px-3 py-1 text-2xl font-black shadow-lg animate-pop`} aria-live="polite">
        {current ? `${letterFor(current)}-${current}` : '—'}
      </span>
      <span className="flex-1 flex flex-wrap justify-end gap-1" aria-label={t('game.previousCalls')}>
        {called
          .slice(-6, -1)
          .reverse()
          .map((n) => (
            <span key={n} className={`${COL[letterIndex(n)]} rounded-md px-1.5 py-0.5 text-[11px] font-black opacity-80`}>
              {letterFor(n)}-{n}
            </span>
          ))}
      </span>
      <span className="text-[11px] font-bold text-slate-400 shrink-0">{called.length}/75</span>
    </div>
  );
}

/** Fills the empty fourth slot when a player holds three cartelas. */
function LogoTile() {
  return (
    <div className="rounded-2xl border border-ink-600/60 bg-ink-800/70 flex items-center justify-center min-h-32 p-2">
      <Logo size="sm" />
    </div>
  );
}

/** The 75-number master board: called numbers red, the latest one green. */
function CalledBoardView({ called, current }) {
  // Fills the height it is given: 15 equal rows, so the numbers grow with the screen.
  return (
    <div className="h-full min-h-0 flex flex-col rounded-2xl bg-ink-800 border border-ink-600/60 p-1.5">
      <div className="grid grid-cols-5 gap-1 mb-1 shrink-0">
        {LETTERS.map((l, i) => (
          <span key={l} className={`${COL[i]} rounded-md text-center text-xs font-black py-0.5`}>
            {l}
          </span>
        ))}
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-5 grid-rows-[repeat(15,minmax(0,1fr))] gap-1">
        {Array.from({ length: 15 }, (_, row) =>
          LETTERS.map((_, col) => {
            const n = col * 15 + row + 1;
            const hit = called.has(n);
            const latest = n === current;
            return (
              <span
                key={n}
                className={`min-h-5 rounded text-sm font-bold flex items-center justify-center ${
                  latest ? 'bg-lime-400 text-ink-950 animate-pop' : hit ? 'bg-red-600 text-white' : 'bg-ink-700 text-slate-300'
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

/**
 * A cartela: coloured B I N G O header, marked numbers green, centre X. Numbers that
 * have been called but not marked yet get a glowing ring so the player can spot them.
 */
function CardView({ cells, marks, onCell, cardIndex = 0, caption, highlight = EMPTY, called = EMPTY, theme = themeFor("classic"), compact = false }) {
  const gap = compact ? 'gap-0.5' : 'gap-1';
  return (
    <div className={`rounded-2xl border ${compact ? 'p-1' : 'p-1.5'} ${theme.frame}`}>
      <div className={`grid grid-cols-5 ${gap} mb-0.5`}>
        {LETTERS.map((l, i) => (
          <span key={l} className={`${theme.cols[i]} rounded-md text-center ${compact ? 'text-[9px]' : 'text-xs'} font-black py-0.5`}>
            {l}
          </span>
        ))}
      </div>
      <div className={`grid grid-cols-5 ${gap}`}>
        {cells.map((cell) => {
          const free = cell.value === null;
          const marked = marks[cell.index];
          const win = highlight.has(cell.index);
          const due = !free && !marked && called.has(cell.value);
          let look = theme.idle;
          if (win) look = 'bg-rose-600 text-white';
          else if (marked) look = `${theme.marked} animate-pop`;
          else if (due) look = `${theme.idle} ring-2 ring-lime-400 ring-inset animate-pulse`;
          const Tag = onCell ? 'button' : 'span';
          return (
            <Tag
              key={cell.index}
              type={onCell ? 'button' : undefined}
              disabled={onCell ? free || marked : undefined}
              onClick={onCell ? () => onCell(cardIndex, cell.index) : undefined}
              aria-pressed={onCell ? marked : undefined}
              className={`aspect-square rounded-md ${compact ? 'text-[10px]' : 'text-base'} font-black flex items-center justify-center select-none ${look} ${onCell && !free && !marked ? 'active:scale-90' : ''}`}
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/80 px-8 animate-fade-in">
      <div className="w-full max-w-xs text-center">{children}</div>
    </div>
  );
}

function WinModal({ over, myId, onAgain, onLeave }) {
  const t = useT();
  const w = over.winner;
  const iWon = Boolean(w) && w.id === myId;
  const line = new Set(w?.line ?? []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/85 px-6 animate-fade-in">
      <div role="dialog" aria-modal="true" className="w-full max-w-xs rounded-3xl bg-ink-800 border border-aqua-400/40 p-5 text-center shadow-2xl animate-modal-in">
        <h2 className="text-lg font-black text-amber-300 mb-3">{w ? t('win.won', { name: w.name }) : t('win.none')}</h2>
        {w && (
          <>
            <p className="inline-block rounded-lg bg-ink-700 px-3 py-1 font-black text-amber-300 text-lg">{w.name}</p>
            <p className="text-sm text-slate-300 mt-1 mb-2">{t('win.cartela', { n: w.cartela })}</p>
            <Card cells={w.card} marks={w.marks} highlight={w.full ? new Set() : line} />
            <p className="mt-3 font-black text-amber-300 text-lg">
              {w.full ? t('win.full') : isCorners(w.line) ? t('win.corners') : t('win.line')}
              {w.prize > 0 ? ` | ${t('win.prize', { amount: etb(w.prize) })}` : ''}
            </p>
            {w.numbers?.length > 0 && !w.full && (
              <p className="mt-1 text-xs text-slate-300">
                {t('win.numbers', { numbers: w.numbers.map((n) => `${letterFor(n)}-${n}`).join(' · '), call: w.call ?? over.called.length })}
              </p>
            )}
            {iWon && <p className="text-sm text-lime-400 font-bold">{t('win.you')}</p>}
          </>
        )}
        {!w && <p className="text-sm text-slate-300">{t('win.refunded', { n: over.called.length })}</p>}
        <button onClick={onAgain} className="mt-4 w-full py-2.5 rounded-full border-2 border-slate-100 font-black active:scale-95">
          {t('win.again')} ➤➤➤
        </button>
        <button onClick={onLeave} className="mt-2 text-sm text-slate-400">
          {t('win.leaveRoom')}
        </button>
      </div>
    </div>
  );
}

/* ---------- memoized heavy pieces ----------
 * The game screen re-renders twice a second for its countdowns. These three are the expensive
 * parts (400 cartela buttons, 75 board cells, up to 4 × 25 card cells); with stable props they
 * now re-render only when their own data changes, which keeps taps instant. */

const EMPTY = new Set();

/** The 10-column grid of numbered cartelas on the pick screen. */
const CartelaGrid = memo(function CartelaGrid({ count, taken, mine, myId, atMax, onChoose }) {
  const t = useT(); // memo skips the clock ticks; this still follows the language switch
  return (
    <div className="grid grid-cols-10 gap-1 max-h-[34vh] overflow-y-auto shrink-0 rounded-xl border border-ink-600/60 p-1">
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
        const owner = taken.get(n);
        const isMine = mine.has(n);
        const locked = Boolean(owner) && owner.id !== myId;
        let look = 'bg-ink-700 border-ink-600 text-slate-100 active:scale-90';
        if (isMine) look = 'bg-lime-400 border-lime-300 text-ink-950';
        else if (locked) look = 'bg-rose-700 border-rose-600 text-white';
        else if (atMax) look = 'bg-ink-800 border-ink-700 text-slate-500';
        return (
          <button
            key={n}
            type="button"
            disabled={locked || (atMax && !isMine)}
            onClick={() => onChoose(n)}
            title={locked ? t('pick.takenBy', { name: owner.name }) : isMine ? t('pick.giveBack', { n }) : t('game.cartela', { n })}
            aria-pressed={isMine}
            className={`h-9 rounded-md border flex flex-col items-center justify-center leading-none ${look}`}
          >
            <span className="text-[11px] font-black">{n}</span>
            {locked && <span className="text-[7px] font-bold truncate max-w-full px-0.5">{owner.name.split(' ')[0].slice(0, 6)}</span>}
          </button>
        );
      })}
    </div>
  );
});

const Card = memo(CardView);
const CalledBoard = memo(CalledBoardView);
