import { PHASE } from './game/room.js';

/**
 * Demo players: house-run bots that sit at the public tables and play like people, so a demo
 * (or a quiet hour) never shows an empty lobby. Off unless DEMO_BOTS > 0.
 *
 * They are ordinary players to the game engine: they join a table, pick one to three
 * cartelas a few seconds apart, mark called numbers after a human-like delay, press BINGO a
 * moment after they can, stay for another round or wander off. They run inside the server
 * (no sockets), driven by one timer.
 *
 * Two things keep them honest:
 *  - they have negative ids, so they can never be a Telegram account, never log in, never
 *    deposit or cash out; their wallets hold play money, topped up when it runs low;
 *  - when a demo player wins a paid round, every real player at the table gets that round's
 *    stake back (`Room.finish`). Real players can win the pool a demo player paid into, but
 *    can never lose money to one. The house ledger books only real stakes and real prizes.
 */

export const DEMO_ID_BASE = -1000;
export const isDemoId = (id) => Number(id) <= DEMO_ID_BASE;

// Ethiopian given names, in Latin letters and in Ge'ez script, the way Telegram display names
// are really written: some bare, some with a father's name or initial, some with digits, and
// many with an emoji or two.
const FIRST = ['Abel', 'Abebe', 'Alemayehu', 'Almaz', 'Aster', 'Bethel', 'Bereket', 'Biruk', 'Blen', 'Dagmawi', 'Dawit', 'Eden', 'Eyerusalem', 'Fikir', 'Fitsum', 'Genet', 'Getachew', 'Hana', 'Helen', 'Henok', 'Hiwot', 'Kaleb', 'Kidist', 'Lidya', 'Liya', 'Mahlet', 'Meron', 'Meseret', 'Mikias', 'Nahom', 'Natnael', 'Rahel', 'Robel', 'Ruth', 'Samrawit', 'Samuel', 'Saron', 'Selam', 'Sisay', 'Solomon', 'Surafel', 'Tewodros', 'Tigist', 'Tsion', 'Yared', 'Yohannes', 'Yonas', 'Zerihun'];
const FIRST_AM = ['አበበ', 'አልማዝ', 'በረከት', 'ብሩክ', 'ዳዊት', 'ኤደን', 'ፍቅር', 'ገነት', 'ሃና', 'ሄኖክ', 'ሕይወት', 'ካሌብ', 'ቅድስት', 'ሊያ', 'ማህሌት', 'ሜሮን', 'ናሆም', 'ራሄል', 'ሳሙኤል', 'ሰላም', 'ሰለሞን', 'ትዕግስት', 'ጽዮን', 'ያሬድ', 'ዮናስ', 'ዘሪሁን'];
const LAST = ['Tesfaye', 'Bekele', 'Alemu', 'Girma', 'Haile', 'Kebede', 'Mekonnen', 'Tadesse', 'Wolde', 'Assefa', 'Desta', 'Getachew', 'Lemma', 'Negash', 'Worku', 'Abera', 'Mulugeta', 'Tilahun'];
const EMOJI = ['🇪🇹', '🔥', '👑', '💎', '🦁', '⭐', '😎', '❤️', '🎯', '🙏', '💚💛❤️', '⚡', '🌹', '🏆', '😇', '🦅', '✨', '💪', '🌼', '🎱'];

/** "ሃና 🌹", "Yonas 🇪🇹", "👑 Dawit B.", "Meron_21", "Abebe Bekele": the mix of styles real sign-ups have. */
export function randomName(rng = Math.random) {
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const amharic = rng() < 0.3;
  const first = pick(amharic ? FIRST_AM : FIRST);
  const style = rng();
  let name = first;
  if (!amharic) {
    if (style < 0.3) name = first;
    else if (style < 0.5) name = `${first} ${pick(LAST)[0]}.`;
    else if (style < 0.7) name = `${first} ${pick(LAST)}`;
    else if (style < 0.85) name = `${first}${rng() < 0.5 ? '_' : ''}${10 + Math.floor(rng() * 89)}`;
    else name = first.toLowerCase();
  }
  const mood = rng();
  if (mood < 0.45) name = `${name} ${pick(EMOJI)}`;
  else if (mood < 0.6) name = `${pick(EMOJI)} ${name}`;
  else if (mood < 0.68) name = `${pick(EMOJI)} ${name} ${pick(EMOJI)}`;
  return name.slice(0, 32);
}

/** Bumped when the name style changes, so existing demo players are renamed once at the next start. */
const NAME_STYLE = 'demo_player_v2';

/**
 * Demo settings are short texts so the operator can type them in the dashboard:
 *   "50"            one value                "40-50"          a range, drawn at random
 *   "10=50,20=40"   a value per table stake  "30,50=20-25"    a default plus one exception
 */
export function forStake(text, stake = null) {
  const items = String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const own = items.find((item) => item.includes('=') && Number(item.split('=')[0]) === Number(stake));
  if (own) return own.split('=')[1].trim();
  return items.find((item) => !item.includes('=')) ?? '';
}

/** "40-50" -> { min: 40, max: 50 }; "50" -> { min: 50, max: 50 }; anything else -> { min: 0, max: 0 }. */
export function parseRange(text) {
  const [a, b = a] = String(text ?? '').split('-').map((s) => Number.parseInt(s.trim(), 10));
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return { min: 0, max: 0 };
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

export function createDemoBots({
  manager,
  store = null,
  stakes,
  count = 0, // demo players that exist
  minCount = count, // fewest of them around at any moment; the number drifts between the two
  crowdMs = [4 * 60_000, 10 * 60_000], // how long one crowd size lasts before it is re-rolled
  minBalance = 50,
  maxBalance = 500,
  perRoom = 3, // most demo players at one table
  minPerRoom = perRoom, // fewest; every table draws its own size between the two, anew each round
  // The share of the cartelas at a table with real players that demo players aim to hold
  // (0.9 = nine for every one of theirs). Every cartela keeps exactly the same chance in the
  // draw, so this sets how often a demo player wins without touching the game itself. 0 = off.
  share = 0,
  churn = 0.15, // chance a demo player gets up between rounds at a table of demo players
  // () => { count, perRoom, share } as texts (see forStake/parseRange): read on every beat, so the
  // operator's settings take effect without a restart. Overrides the fixed values above.
  live = null,
  tickMs = 700,
  onChange = () => {},
  rng = Math.random,
  now = Date.now,
  log = console.log,
}) {
  const between = (a, b) => a + rng() * (b - a);
  const int = (a, b) => Math.floor(between(a, b + 1));
  const bots = [];
  let timer = null;
  // How many demo players are "online" right now: bot i is around while i < active. A bot that
  // falls outside finishes its round and leaves; one that falls inside turns up a little later.
  let active = 0;
  const sizes = new Map(); // `${code}:${round}` -> how many players this table fills to in that round
  let crowdUntil = 0;

  // The settings in force right now.
  const spec = () => {
    const l = live?.() ?? {};
    return { count: String(l.count ?? `${minCount}-${count}`), perRoom: String(l.perRoom ?? `${minPerRoom}-${perRoom}`), share: String(l.share ?? share) };
  };
  const crowdRange = () => parseRange(forStake(spec().count));
  const tableRange = (stake) => parseRange(forStake(spec().perRoom, stake));
  const shareAt = (stake) => Math.min(0.95, Math.max(0, Number(forStake(spec().share, stake)) || 0));
  const biggestTable = () => Math.max(0, ...stakes.map((stake) => tableRange(stake).max));

  let lastSpec = '';
  let growing = null;
  function rollCrowd(t) {
    const current = JSON.stringify(spec());
    if (current !== lastSpec) {
      lastSpec = current; // the operator changed something: re-roll now, and resize tables next round
      crowdUntil = 0;
      sizes.clear();
    }
    const { min, max } = crowdRange();
    if (max > bots.length && !growing) growing = setup(max).finally(() => (growing = null));
    if (t < crowdUntil) return void (active = Math.min(active, bots.length));
    for (const key of sizes.keys()) if (!manager.rooms.has(key.split(':')[0])) sizes.delete(key); // tables that closed
    active = Math.min(int(min, max), bots.length);
    crowdUntil = t + between(crowdMs[0], crowdMs[1]);
  }

  /** Profiles and play-money wallets are kept in the store, so names and balances survive restarts. */
  async function setup(upTo = crowdRange().max) {
    const taken = new Set(bots.map((b) => b.name));
    const first = bots.length + 1;
    for (let i = first; i <= upTo; i++) {
      const id = DEMO_ID_BASE - i;
      const saved = store?.profile(id);
      let name = saved?.username === NAME_STYLE ? saved.name : null; // the username doubles as the style marker (and tells the operator what this account is)
      if (!name) {
        do name = randomName(rng);
        while (taken.has(name));
        await store?.setProfile(id, { name, firstName: name, username: NAME_STYLE, signedUpAt: saved?.signedUpAt ?? new Date(now()).toISOString() });
      }
      taken.add(name);
      if (store && store.balance(id) < minBalance) store.adjust(id, int(minBalance, maxBalance), 'Demo balance');
      bots.push({ id, name, nextAt: now() + between(1000, 20_000), wants: 1, nextPickAt: 0, planned: null, marks: new Map(), claimAt: null });
    }
    if (upTo >= first) log(`[demo] ${bots.length} demo player(s) (settings: ${spec().count} in all, ${spec().perRoom} per table, share ${spec().share}): ${bots.slice(first - 1).map((b) => b.name).join(', ')}`);
  }

  const demoCount = (room) => [...room.players.keys()].filter(isDemoId).length;
  const humanCount = (room) => room.players.size - demoCount(room);
  const stakeOf = (room) => room.stake;

  /**
   * Where an idle bot sits down: { room } to join or { stake } to open a table, or null to wait.
   * Real players who are waiting come first. Otherwise there is one table of demo players per
   * stake, filled towards `perRoom` players; nobody opens a second one while it is mid-round
   * (they wait for it to re-open), and one table's worth of bots stays free for real players.
   */
  function pickTable(bot) {
    const tables = [...manager.rooms.values()].filter((r) => !r.isPrivate);
    const open = tables.filter((r) => r.canJoin() && demoCount(r) < seatsFor(r));
    const withPeople = open.filter((r) => humanCount(r) > 0);
    if (withPeople.length) return { room: withPeople.reduce((a, b) => (demoCount(b) < demoCount(a) ? b : a)) };
    const busyAlone = bots.filter((b) => b !== bot && manager.roomOf(b.id) && humanCount(manager.roomOf(b.id)) === 0).length;
    const reserve = Math.min(biggestTable(), Math.ceil(active / 4));
    if (busyAlone >= active - reserve) return null;
    if (open.length) return { room: open.reduce((a, b) => (b.players.size < a.players.size ? b : a)) }; // the emptiest fills first
    const free = stakes.filter((stake) => !tables.some((r) => r.stake === stake && humanCount(r) === 0));
    if (free.length === 0) return null;
    const weights = free.map((_, i) => 1 / (i + 1)); // cheaper tables open first, as with people
    let roll = rng() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < free.length; i++) if ((roll -= weights[i]) <= 0) return { stake: free[i] };
    return { stake: free[0] };
  }

  function sitDown(bot, t) {
    const target = pickTable(bot);
    if (!target) return void (bot.nextAt = t + between(2000, 8000));
    const user = { id: bot.id, first_name: bot.name };
    const room = target.room ? manager.join(user, target.room.code) : manager.joinStake(user, target.stake);
    if (demoCount(room) > seatsFor(room)) return void leave(bot, t); // it filled up meanwhile
    plan(bot, room, t, true);
  }

  /** Decides, once per registration, whether to play this round and with how many cartelas. */
  function plan(bot, room, t, justArrived = false) {
    bot.planned = `${room.code}:${room.round}`;
    bot.marks.clear();
    bot.claimAt = null;
    // This round the table is smaller than the last one: the surplus get up, one by one.
    if (!justArrived && demoCount(room) > seatsFor(room)) return void leave(bot, t);
    if (!justArrived && humanCount(room) === 0) {
      // A real player's table that is short of company comes first: go there now.
      if (shortTable()) return void leave(bot, t, 0);
      if (rng() < churn || !isAround(bot)) return void leave(bot, t);
    }
    const roll = rng();
    bot.wants = Math.min(room.rules.maxCartelas, roll < 0.55 ? 1 : roll < 0.85 ? 2 : 3);
    bot.nextPickAt = t + between(1500, 6000);
  }

  const isAround = (bot) => bots.indexOf(bot) < active;

  function leave(bot, t, wait = between(4000, 25000)) {
    manager.leave(bot.id);
    bot.planned = null;
    bot.nextAt = t + wait;
  }

  /** A table with a real player at it that still has demo seats to fill. */
  const shortTable = () => [...manager.rooms.values()].find((r) => !r.isPrivate && r.canJoin() && humanCount(r) > 0 && demoCount(r) < seatsFor(r));

  const ticketsOf = (room, demo) => [...room.players.values()].filter((p) => isDemoId(p.id) === demo).reduce((n, p) => n + p.cards.length, 0);

  /** Cartelas the demo players at this table still need to reach their share of it (0 when `share` is off or nobody real has picked). */
  function shortOfShare(room) {
    const want = shareAt(room.stake);
    if (!(want > 0 && want < 1)) return 0;
    const real = ticketsOf(room, false);
    return real === 0 ? 0 : Math.max(0, Math.ceil((want / (1 - want)) * real) - ticketsOf(room, true));
  }

  /** How full this table gets this round: a number between `minPerRoom` and `perRoom`, drawn once per table and round. */
  function sizeOf(room) {
    const key = `${room.code}:${room.round}`;
    if (!sizes.has(key)) {
      for (const old of sizes.keys()) if (old.startsWith(`${room.code}:`)) sizes.delete(old);
      const { min, max } = tableRange(room.stake);
      sizes.set(key, int(min, max));
    }
    return sizes.get(key);
  }

  /** Demo seats at a table: they fill it to its size for this round, or to the brim when the share needs more of them. */
  const seatsFor = (room) => (shortOfShare(room) > 0 ? room.rules.maxPlayers - humanCount(room) : Math.max(0, Math.min(sizeOf(room), room.rules.maxPlayers) - humanCount(room)));

  function pickCartela(bot, room, t) {
    const me = room.players.get(bot.id);
    if (!me) return;
    // Behind on the share: take another cartela, and sooner, while registration is still open.
    const chasing = shortOfShare(room) > 0 && me.cards.length < room.rules.maxCartelas;
    if (chasing && me.cards.length >= bot.wants) bot.wants = me.cards.length + 1;
    if (chasing) bot.nextPickAt = Math.min(bot.nextPickAt, t + between(400, 1800));
    if (me.cards.length >= bot.wants || t < bot.nextPickAt) return;
    if (store && room.stake > 0 && store.balance(bot.id) < room.stake) store.adjust(bot.id, int(minBalance, maxBalance), 'Demo balance');
    for (let attempt = 0; attempt < 5; attempt++) {
      const cartela = int(1, room.rules.cartelaCount);
      if (room.ownerOf(cartela)) continue;
      room.choose(bot.id, cartela);
      break;
    }
    bot.nextPickAt = t + (shortOfShare(room) > 0 ? between(500, 1800) : between(1200, 5000));
  }

  function play(bot, room, t) {
    const me = room.players.get(bot.id);
    if (!me?.cards.length) return;
    // A called number is noticed a moment later, like a person scanning their cards.
    for (const n of room.called) {
      if (bot.marks.has(n)) continue;
      const mine = me.cards.some((c) => c.cells.some((cell) => cell.value === n && !c.marks[cell.index]));
      bot.marks.set(n, mine ? t + between(500, 2800) : 0);
    }
    let marked = false;
    for (const [n, due] of bot.marks) {
      if (!due || t < due) continue;
      bot.marks.set(n, 0);
      room.mark(bot.id, n);
      marked = true;
    }
    if (marked) onChange(room);
    if (room.progress(me).cards.some((c) => c.canClaim)) {
      bot.claimAt ??= t + between(700, 2600);
      if (t >= bot.claimAt) room.claim(bot.id);
    }
  }

  function tick() {
    const t = now();
    rollCrowd(t);
    for (const bot of bots) {
      try {
        const room = manager.roomOf(bot.id);
        if (!room) {
          if (t >= bot.nextAt && isAround(bot)) sitDown(bot, t);
        } else if (room.phase === PHASE.WAITING || room.phase === PHASE.COUNTDOWN) {
          if (bot.planned !== `${room.code}:${room.round}`) plan(bot, room, t);
          else pickCartela(bot, room, t);
        } else if (room.phase === PHASE.PLAYING) {
          play(bot, room, t);
        }
      } catch (err) {
        // A lost race (cartela just taken, round just ended) is normal; anything else must not stop the others.
        if (!/taken|No game running|Wait for the next round|Not yet|not in/i.test(err.message)) log(`[demo] ${bot.name}: ${err.message}`);
      }
    }
  }

  return {
    bots,
    tick,
    get active() {
      return active;
    },
    async start() {
      await setup();
      rollCrowd(now());
      // With live settings the beat always runs, so switching demo players on in the dashboard works.
      if (live || bots.length > 0) {
        timer = setInterval(tick, tickMs);
        timer.unref?.();
      }
      return this;
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
