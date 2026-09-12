import { randomInt } from 'node:crypto';
import { cardForCartela, initialMarks, completedLines, drawOrder, letterFor, CARTELA_COUNT } from './bingo.js';

export const PHASE = Object.freeze({
  WAITING: 'waiting', // registration open, not enough players have picked a cartela yet
  COUNTDOWN: 'countdown', // enough picks, auto-start timer running (players can still pick)
  PLAYING: 'playing',
  FINISHED: 'finished',
});

export const DEFAULT_RULES = Object.freeze({
  minPlayers: 2,
  maxPlayers: 8,
  fullCard: true, // round is won by claiming BINGO with every number on the card marked
  linesToWin: 1, // used only when fullCard is false
  callIntervalMs: 4000,
  countdownMs: 40000, // time players get to pick a cartela
  restartDelayMs: 8000,
  cartelaCount: CARTELA_COUNT,
  houseCutPercent: 2, // share of every player's stake kept by the house; the rest is the prize pool
});

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode(length = 4) {
  return Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

const money = (n) => Math.round(n * 100) / 100;

/** Prize pool for `players` paying `stake` after the house cut. */
export function prizePool(stake, players, houseCutPercent) {
  return money((stake * players * (100 - houseCutPercent)) / 100);
}

/**
 * One bingo table. Pure game logic plus timers; transport is injected via `emit(event,
 * payload)` (to everyone) and `emitTo(userId, event, payload)` (private).
 *
 * The house hosts every table: rounds start on the registration countdown and numbers are
 * called by the server; no player controls the game.
 *
 * Money: `stake` is charged when a player picks their first cartela of the round
 * (`wallet.charge`), refunded if they leave before the round starts, and the prize pool
 * (stakes minus the house cut) goes to the winner via `wallet.credit`. The house cut of a
 * played round is reported to `stats.recordRound` as `houseTake`.
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
    this.players = new Map(); // userId -> { id, name, cartela, card, marks, joinedAt }
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

  /** Players who hold a cartela (and have paid the stake) for the coming round. */
  get ready() {
    let n = 0;
    for (const p of this.players.values()) if (p.cartela) n++;
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
    const player = { id: user.id, name: displayName(user), cartela: null, card: null, marks: null, joinedAt: this.now() };
    this.players.set(user.id, player);
    this.broadcast();
    return player;
  }

  leave(userId) {
    const player = this.players.get(userId);
    if (!player) return;
    if (this.open && player.cartela) this.refund(player);
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

  poolFor(participants) {
    return prizePool(this.stake, participants, this.rules.houseCutPercent);
  }

  charge(player) {
    if (this.stake === 0) return;
    if (!this.wallet?.charge(player.id, this.stake, `Stake for room ${this.code}`)) {
      throw new Error(`Insufficient balance: this room costs ${this.stake} per cartela`);
    }
  }

  refund(player) {
    if (this.stake === 0) return;
    this.wallet?.credit(player.id, this.stake, `Refund for room ${this.code}`);
  }

  // ---------- cartelas ----------

  ownerOf(cartela) {
    for (const p of this.players.values()) if (p.cartela === cartela) return p;
    return null;
  }

  /**
   * Pick (or switch to) a numbered cartela while registration is open. The first pick
   * of a round pays the stake; switching is free. The card is dealt at once as a preview.
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
    if (!player.cartela) this.charge(player);
    this.deal(player, cartela);
    this.maybeCountdown();
    this.broadcast();
    return player;
  }

  deal(player, cartela) {
    player.cartela = cartela;
    player.card = cardForCartela(cartela);
    player.marks = initialMarks();
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
    this.pool = this.poolFor(this.ready);
    for (const p of this.players.values()) {
      if (p.cartela) this.deal(p, p.cartela); // fresh marks
      else p.card = p.marks = null; // spectator until the next round
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
    if (!player?.card) throw new Error('You are not in this round');
    return player;
  }

  /** Marks a called number on the player's card. Winning still requires `claim()`. */
  mark(userId, number) {
    const player = this.playerInRound(userId);
    if (!this.called.includes(number)) throw new Error('That number has not been called');
    const cell = player.card.find((c) => c.value === number);
    if (!cell) throw new Error('That number is not on your card');
    player.marks[cell.index] = true;
    return this.progress(player);
  }

  progress(player) {
    const lines = completedLines(player.marks);
    const full = player.marks.every(Boolean);
    const won = this.rules.fullCard ? full : lines.length >= this.rules.linesToWin;
    return { marks: player.marks, lines: lines.length, marked: player.marks.filter(Boolean).length - 1, full, canClaim: won };
  }

  /** The BINGO! button: ends the round if the player's card really qualifies. */
  claim(userId) {
    const player = this.playerInRound(userId);
    const p = this.progress(player);
    if (!p.canClaim) {
      throw new Error(this.rules.fullCard ? `Not yet: ${p.marked}/${player.marks.length - 1} marked` : `Not yet: ${p.lines}/${this.rules.linesToWin} lines`);
    }
    this.finish(player, completedLines(player.marks)[0] ?? null, p.full);
    return p;
  }

  finish(player, line = null, full = false) {
    this.clearTimer();
    this.phase = PHASE.FINISHED;
    if (player) {
      this.winner = { id: player.id, name: player.name, cartela: player.cartela, line, full, prize: this.pool, card: player.card, marks: player.marks };
      if (this.pool > 0) this.wallet?.credit(player.id, this.pool, `Prize for room ${this.code}`);
    } else {
      this.winner = null;
      for (const p of this.players.values()) if (p.card) this.refund(p); // nobody won: stakes go back
    }
    const seated = [...this.players.values()].filter((p) => p.card);
    const participants = seated.map((p) => p.id);
    const stakes = money(this.stake * participants.length);
    this.stats?.recordRound({
      participants,
      players: seated.map((p) => ({ id: p.id, name: p.name, cartela: p.cartela, marked: p.marks.filter(Boolean).length - 1 })),
      winnerId: player?.id ?? null,
      winner: player ? { id: player.id, name: player.name, cartela: player.cartela, full, line } : null,
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
    for (const p of this.players.values()) p.cartela = p.card = p.marks = null;
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

  destroy() {
    this.clearTimer();
    if (this.open) for (const p of this.players.values()) if (p.cartela) this.refund(p);
    this.players.clear();
  }

  cardFor(userId) {
    const p = this.players.get(userId);
    return p?.card ? { cells: p.card, marks: p.marks, round: this.round, cartela: p.cartela } : null;
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
      startsAt: this.startsAt,
      pool: this.phase === PHASE.PLAYING || this.phase === PHASE.FINISHED ? this.pool : this.poolFor(this.ready),
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
        cartela: p.cartela,
        playing: Boolean(p.card) && this.phase !== PHASE.WAITING && this.phase !== PHASE.COUNTDOWN,
        marked: p.marks ? p.marks.filter(Boolean).length - 1 : 0,
      })),
    };
  }

  broadcast() {
    this.emit('room:state', this.publicState());
  }
}

function displayName(user) {
  return user.first_name || user.username || `Player ${user.id}`;
}
