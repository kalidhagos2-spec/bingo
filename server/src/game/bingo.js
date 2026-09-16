import { randomInt } from 'node:crypto';

export const SIZE = 5;
export const FREE_INDEX = 12;
export const MAX_NUMBER = 75;
/** How many numbered cartelas (cards) players can pick from before a round. */
export const CARTELA_COUNT = 400;

/** Fisher–Yates; `pick(n)` returns an integer in [0, n). Defaults to crypto randomness. */
export function shuffle(arr, pick = randomInt) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** mulberry32: tiny deterministic PRNG so a cartela number always maps to the same card. */
function seeded(seed) {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

/** 25 cells, row-major. Column ranges B 1-15 … O 61-75; centre is FREE (null). */
export function generateCard(pick = randomInt) {
  const columns = Array.from({ length: SIZE }, (_, col) =>
    shuffle(Array.from({ length: 15 }, (_, i) => col * 15 + 1 + i), pick).slice(0, SIZE),
  );
  const cells = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const index = row * SIZE + col;
      cells.push({ index, row, col, value: index === FREE_INDEX ? null : columns[col][row] });
    }
  }
  return cells;
}

/** The fixed card printed on cartela number `n` (same on every server, every round). */
export function cardForCartela(n) {
  return generateCard(seeded(n * 0x9e3779b1));
}

export function initialMarks() {
  const marks = Array(SIZE * SIZE).fill(false);
  marks[FREE_INDEX] = true;
  return marks;
}

export const LINES = (() => {
  const lines = [];
  for (let r = 0; r < SIZE; r++) lines.push(Array.from({ length: SIZE }, (_, c) => r * SIZE + c));
  for (let c = 0; c < SIZE; c++) lines.push(Array.from({ length: SIZE }, (_, r) => r * SIZE + c));
  lines.push(Array.from({ length: SIZE }, (_, i) => i * SIZE + i));
  lines.push(Array.from({ length: SIZE }, (_, i) => i * SIZE + (SIZE - 1 - i)));
  return lines;
})();

export function completedLines(marks) {
  return LINES.filter((line) => line.every((i) => marks[i]));
}

/** Shuffled draw order for the caller. */
export function drawOrder() {
  return shuffle(Array.from({ length: MAX_NUMBER }, (_, i) => i + 1));
}

export function letterFor(number) {
  return 'BINGO'[Math.floor((number - 1) / 15)];
}
