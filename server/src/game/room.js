import { randomInt } from 'node:crypto';
import { cardForCartela, initialMarks, completedLines, cornersComplete, winningPattern, drawOrder, letterFor, CARTELA_COUNT } from './bingo.js';

export const PHASE = Object.freeze({
  WAITING: 'waiting', // registration open, not enough players have picked a cartela yet
  COUNTDOWN: 'countdown', // enough picks, auto-start timer running (players can still pick)
  PLAYING: 'playing',
  FINISHED: 'finished',
});

export const DEFAULT_RULES = Object.freeze({
  minPlayers: 2,
  maxPlayers: 8,
  fullCard: false, // true: BINGO needs every number marked; false: a line or the four corners wins
  linesToWin: 1, // rows / columns / diagonals needed when fullCard is false (four corners always count)
  callIntervalMs: 4000,
  countdownMs: 40000, // time players get to pick cartelas
  restartDelayMs: 8000,
  cartelaCount: CARTELA_COUNT,
  maxCartelas: 4, // cartelas one player may hold in a round; each one pays the stake
  houseCutPercent: 20, // share of every stake kept by the house; the rest is the prize pool
  maxPrize: 3000, // the prize pool never exceeds this, whatever the stakes add up to
});

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode(length = 4) {
  return Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

const money = (n) => Math.round(n * 100) / 100;

/** Prize pool for `tickets` cartelas paying `stake` each, after the house cut, capped at `maxPrize`. */
export function prizePool(stake, tickets, houseCutPercent, maxPrize = Infinity) {
  return Math.min(money((stake * tickets * (100 - houseCutPercent)) / 100), maxPrize);
}

/**
 * One bingo table. Pure game logic plus timers; transport is injected via `emit(event,
 * payload)` (to everyone) and `emitTo(userId, event, payload)` (private).
 *
 * The house hosts every table: rounds start on the registration countdown and numbers are
 * called by the server; no player controls the game.
 *
 * Cartelas: a player holds up to `maxCartelas` numbered cards per round (`player.cards`),
 * each a `{ cartela, cells, marks }`. Every cartela pays the stake when picked
 * (`wallet.charge`), is refunded when released or on leaving before the round starts, and
 * the prize pool (all stakes minus the house cut) goes to the winner via `wallet.credit`.
 * The house cut of a played round is reported to `stats.recordRound` as `houseTake`.
 */
export class Room {
  constructor({ code, stake = 0, isPrivate = false, rules = {}, emit, emitTo, wallet = null, stats = null, now = Date.now, timers = { set: setTimeout, clear: clearTimeout } }) {
    this.code = code;
    this.stake = stake;
    this.isPrivate = isPrivate; // created with a share code rather than from the public lobby
    this.rules = { ...DEFAULT_RULES, ...rules };
    // Every seat must be able to get its own cartela.
    this.rules.cartelaCount = Math.max(this.rules.cartelaCount, this.rules.maxPlayers);
    this.emit = emit;
    this.emitTo = emitTo;
    this.wallet = wallet; // { charge(userId, amount, note) -> boolean, credit(userId, amount, note) }
    this.stats = stats; // { recordRound({ participants, winnerId, prize }) }
    this.now = now;
    this.timers = timers;

    this.phase = PHASE.WAITING;
    this.round = 0;
    this.players = new Map(); // userId -> { id, name, cards: [{ cartela, cells, marks }], joinedAt }
    this.called = [];
    this.drawPool = [];
    this.pool = 0; // prize pool of the round in progress
    this.winner = null;
    this.startsAt = null;
    this.startedAt = null; // when the current round began calling
    this.timer = null;
  }

  // ---------- membership ----------

  get size() {
    return this.players.size;
  }

  /** Players holding at least one cartela (and having paid) for the coming round. */
  get ready() {
    let n = 0;
    for (const p of this.players.values()) if (p.cards.length) n++;
    return n;
  }

  /** Cartelas in play: every one pays the stake. */
  get tickets() {
    let n = 0;
    for (const p of this.players.values()) n += p.cards.length;
    return n;
  }

  get open() {
    return this.phase === PHASE.WAITING || this.phase === PHASE.COUNTDOWN;
  }

  canJoin() {
    return this.phase !== PHASE.PLAYING && this.size < this.rules.maxPlayers;
  }

  join(user) {
    if (this.players.has(user.id)) return this.players.get(user.id);
    if (!this.canJoin()) throw new Error(this.phase === PHASE.PLAYING ? 'Game already in progress' : 'Room is full');
    const player = { id: user.id, name: displayName(user), cards: [], joinedAt: this.now() };
    this.players.set(user.id, player);
    this.broadcast();
    return player;
  }

  leave(userId) {
    const player = this.players.get(userId);
    if (!player) return;
    if (this.open) for (const c of player.cards) this.refund(player, c.cartela);
    this.players.delete(userId);
    if (this.size === 0) {
      this.clearTimer();
      return;
    }
    if (this.phase === PHASE.COUNTDOWN && this.ready < this.rules.minPlayers) {
      this.clearTimer();
      this.phase = PHASE.WAITING;
      this.startsAt = null;
    }
    this.broadcast();
  }

  // ---------- money ----------

  poolFor(tickets) {
    return prizePool(this.stake, tickets, this.rules.houseCutPercent, this.rules.maxPrize);
  }

  charge(player, cartela) {
    if (this.stake === 0) return;
    if (!this.wallet?.charge(player.id, this.stake, `Stake for cartela ${cartela} in room ${this.code}`)) {
      throw new Error(`Insufficient balance: this room costs ${this.stake} per cartela`);
    }
  }

  refund(player, cartela) {
    if (this.stake === 0) return;
    this.wallet?.credit(player.id, this.stake, `Refund for cartela ${cartela} in room ${this.code}`);
  }

  // ---------- cartelas ----------

  ownerOf(cartela) {
    for (const p of this.players.values()) if (p.cards.some((c) => c.cartela === cartela)) return p;
    return null;
  }

  /**
   * Pick a numbered cartela while registration is open. Each pick pays the stake; a player
   * may hold up to `maxCartelas`. The card is dealt at once as a preview.
   */
  choose(userId, cartela) {
    if (!this.open) throw new Error('Wait for the next round to pick a cartela');
    const player = this.players.get(userId);
    if (!player) throw new Error('You are not in this room');
    if (!Number.isInteger(cartela) || cartela < 1 || cartela > this.rules.cartelaCount) {
      throw new Error(`Pick a cartela between 1 and ${this.rules.cartelaCount}`);
    }
    const owner = this.ownerOf(cartela);
    if (owner && owner.id !== userId) throw new Error(`Cartela ${cartela} is already taken by ${owner.name}`);
    if (owner) return player; // already yours
    if (player.cards.length >= this.rules.maxCartelas) throw new Error(`You can hold up to ${this.rules.maxCartelas} cartelas`);
    this.charge(player, cartela);
    this.deal(player, cartela);
    this.maybeCountdown();
    this.broadcast();
    return player;
  }

  /** Give a cartela back while registration is open; its stake is refunded. */
  release(userId, cartela) {
    if (!this.open) throw new Error('Wait for the next round to change cartelas');
    const player = this.players.get(userId);
    if (!player) throw new Error('You are not in this room');
    const i = player.cards.findIndex((c) => c.cartela === cartela);
    if (i < 0) throw new Error(`You do not hold cartela ${cartela}`);
    player.cards.splice(i, 1);
    this.refund(player, cartela);
    if (this.phase === PHASE.COUNTDOWN && this.ready < this.rules.minPlayers) {
      this.clearTimer();
      this.phase = PHASE.WAITING;
      this.startsAt = null;
    }
    this.emitTo(player.id, 'game:card', this.cardFor(player.id));
    this.broadcast();
    return player;
  }

  deal(player, cartela) {
    const existing = player.cards.find((c) => c.cartela === cartela);
    const card = { cartela, cells: cardForCartela(cartela), marks: initialMarks() };
    if (existing) Object.assign(existing, card);
    else player.cards.push(card);
    player.cards.sort((a, b) => a.cartela - b.cartela);
    this.emitTo(player.id, 'game:card', this.cardFor(player.id));
  }

  // ---------- lifecycle ----------

  maybeCountdown() {
    if (this.phase !== PHASE.WAITING || this.ready < this.rules.minPlayers) return;
    this.phase = PHASE.COUNTDOWN;
    this.startsAt = this.now() + this.rules.countdownMs;
    this.setTimer(() => this.start(), this.rules.countdownMs);
  }

  /** Countdown-triggered start (the house is the host). Only players holding a cartela play. */
  start() {
    if (this.phase === PHASE.PLAYING) throw new Error('Game already running');
    if (this.ready < this.rules.minPlayers) throw new Error(`Need at least ${this.rules.minPlayers} players with a cartela`);
    this.clearTimer();
    this.phase = PHASE.PLAYING;
    this.round += 1;
    this.called = [];
    this.drawPool = drawOrder();
    this.winner = null;
    this.startsAt = null;
    this.startedAt = this.now();
    this.pool = this.poolFor(this.tickets);
    for (const p of this.players.values()) {
      for (const c of p.cards) c.marks = initialMarks(); // fresh marks
      if (p.cards.length) this.emitTo(p.id, 'game:card', this.cardFor(p.id));
    }
    this.broadcast();
    this.callNext();
  }

  callNext() {
    if (this.phase !== PHASE.PLAYING) return;
    const number = this.drawPool.shift();
    if (number === undefined) {
      this.finish(null);
      return;
    }
    this.called.push(number);
    this.emit('game:number', { number, letter: letterFor(number), index: this.called.length, called: this.called });
    this.setTimer(() => this.callNext(), this.rules.callIntervalMs);
  }

  playerInRound(userId) {
    if (this.phase !== PHASE.PLAYING) throw new Error('No game running');
    const player = this.players.get(userId);
    if (!player?.cards.length) throw new Error('You are not in this round');
    return player;
  }

  /**
   * Marks a called number on the player's cartela (`cartela` given) or on every cartela of
   * theirs that carries it. Winning still requires `claim()`.
   */
  mark(userId, number, cartela = null) {
    const player = this.playerInRound(userId);
    if (!this.called.includes(number)) throw new Error('That number has not been called');
    const targets = cartela === null ? player.cards : player.cards.filter((c) => c.cartela === cartela);
    if (cartela !== null && targets.length === 0) throw new Error(`You do not hold cartela ${cartela}`);
    let hit = false;
    for (const card of targets) {
      const cell = card.cells.find((c) => c.value === number);
      if (!cell) continue;
      card.marks[cell.index] = true;
      hit = true;
    }
    if (!hit) throw new Error(cartela === null ? 'That number is not on your cards' : `That number is not on cartela ${cartela}`);
    return this.progress(player);
  }

  cardProgress(card) {
    const lines = completedLines(card.marks);
    const corners = cornersComplete(card.marks);
    const full = card.marks.every(Boolean);
    const pattern = winningPattern(card.marks, this.rules.linesToWin);
    const won = this.rules.fullCard ? full : Boolean(pattern);
    return { cartela: card.cartela, marks: card.marks, lines: lines.length, corners, pattern, marked: card.marks.filter(Boolean).length - 1, full, canClaim: won };
  }

  /** Progress of every cartela the player holds, plus the best one for the BINGO! button. */
  progress(player) {
    const cards = player.cards.map((c) => this.cardProgress(c));
    const best = cards.find((c) => c.canClaim) ?? cards.reduce((a, b) => (b.marked > a.marked ? b : a), cards[0]);
    return { cards, canClaim: Boolean(best?.canClaim), ...(best ?? {}) };
  }

  /** The BINGO! button: ends the round if one of the player's cartelas really qualifies. */
  claim(userId, cartela = null) {
    const player = this.playerInRound(userId);
    const p = this.progress(player);
    const chosen = cartela === null ? p.cards.find((c) => c.canClaim) : p.cards.find((c) => c.cartela === cartela);
    if (cartela !== null && !chosen) throw new Error(`You do not hold cartela ${cartela}`);
    if (!chosen?.canClaim) {
      const best = chosen ?? p;
      throw new Error(
        this.rules.fullCard
          ? `Not yet: ${best.marked}/${best.marks.length - 1} marked`
          : `Not yet: complete a row, column, diagonal or all four corners (${best.marked}/${best.marks.length - 1} marked)`,
      );
    }
    const card = player.cards.find((c) => c.cartela === chosen.cartela);
    this.finish(player, chosen.pattern ?? completedLines(card.marks)[0] ?? null, chosen.full, card);
    return p;
  }

  finish(player, line = null, full = false, card = player?.cards[0] ?? null) {
    this.clearTimer();
    this.phase = PHASE.FINISHED;
    if (player) {
      this.winner = { id: player.id, name: player.name, cartela: card.cartela, line, full, prize: this.pool, card: card.cells, marks: card.marks };
      if (this.pool > 0) this.wallet?.credit(player.id, this.pool, `Prize for room ${this.code}`);
    } else {
      this.winner = null;
      for (const p of this.players.values()) for (const c of p.cards) this.refund(p, c.cartela); // nobody won: stakes go back
    }
    const seated = [...this.players.values()].filter((p) => p.cards.length);
    const participants = seated.map((p) => p.id);
    const stakes = money(this.stake * this.tickets);
    this.stats?.recordRound({
      participants,
      players: seated.map((p) => ({ id: p.id, name: p.name, cartela: p.cards[0].cartela, cartelas: p.cards.map((c) => c.cartela), marked: markedCount(p) })),
      winnerId: player?.id ?? null,
      winner: player ? { id: player.id, name: player.name, cartela: card.cartela, full, line } : null,
      prize: player ? this.pool : 0,
      stake: this.stake,
      stakes: player ? stakes : 0, // no winner: everything was refunded
      houseTake: player ? money(stakes - this.pool) : 0,
      room: this.code,
      round: this.round,
      numbersCalled: this.called.length,
      startedAt: this.startedAt,
    });
    this.emit('game:over', { winner: this.winner, called: this.called, round: this.round, pool: this.pool });
    this.broadcast();
    this.setTimer(() => this.reopen(), this.rules.restartDelayMs);
  }

  /** Registration re-opens; everyone picks (and pays) again for the next round. */
  reopen() {
    if (this.phase !== PHASE.FINISHED) return;
    this.phase = PHASE.WAITING;
    this.winner = null;
    this.pool = 0;
    for (const p of this.players.values()) p.cards = [];
    this.broadcast();
  }

  // ---------- helpers ----------

  setTimer(fn, ms) {
    this.clearTimer();
    this.timer = this.timers.set(fn, ms);
  }

  clearTimer() {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  /**
   * The server is going down with this table still live. A round that cannot be finished is
   * void: every cartela still in play gets its stake back, whether registration was open or
   * numbers were already being called. (After FINISHED the prize is paid; nothing to return.)
   */
  abort() {
    this.clearTimer();
    if (this.phase !== PHASE.FINISHED) for (const p of this.players.values()) for (const c of p.cards) this.refund(p, c.cartela);
    this.players.clear();
  }

  destroy() {
    this.clearTimer();
    if (this.open) for (const p of this.players.values()) for (const c of p.cards) this.refund(p, c.cartela);
    this.players.clear();
  }

  /** Every cartela the player holds, or null when they hold none. */
  cardFor(userId) {
    const p = this.players.get(userId);
    if (!p?.cards.length) return null;
    return { cards: p.cards.map((c) => ({ cartela: c.cartela, cells: c.cells, marks: c.marks })), round: this.round };
  }

  /** Lobby summary. */
  summary() {
    return {
      code: this.code,
      stake: this.stake,
      isPrivate: this.isPrivate,
      phase: this.phase,
      players: this.size,
      ready: this.ready,
      tickets: this.tickets,
      startsAt: this.startsAt,
      pool: this.phase === PHASE.PLAYING || this.phase === PHASE.FINISHED ? this.pool : this.poolFor(this.tickets),
      callIndex: this.called.length,
    };
  }

  publicState() {
    return {
      ...this.summary(),
      round: this.round,
      rules: this.rules,
      called: this.called,
      current: this.called.at(-1) ?? null,
      winner: this.winner && {
        id: this.winner.id,
        name: this.winner.name,
        cartela: this.winner.cartela,
        line: this.winner.line,
        full: this.winner.full,
        prize: this.winner.prize,
      },
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        cartelas: p.cards.map((c) => c.cartela),
        cartela: p.cards[0]?.cartela ?? null,
        playing: p.cards.length > 0 && this.phase !== PHASE.WAITING && this.phase !== PHASE.COUNTDOWN,
        marked: markedCount(p),
      })),
    };
  }

  broadcast() {
    this.emit('room:state', this.publicState());
  }
}

/** Numbers marked across all of a player's cartelas (the free centre excluded). */
function markedCount(p) {
  return p.cards.reduce((n, c) => n + c.marks.filter(Boolean).length - 1, 0);
}

function displayName(user) {
  return user.first_name || user.username || `Player ${user.id}`;
}
