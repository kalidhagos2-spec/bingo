/** Column letters of a bingo card: B 1-15, I 16-30, N 31-45, G 46-60, O 61-75. Cards themselves are dealt by the server. */
export const LETTERS = ['B', 'I', 'N', 'G', 'O'];

const SIZE = 5;

/** Rows, columns and both diagonals as cell indexes (row-major, 0–24). Mirrors server/src/game/bingo.js. */
export const LINES = (() => {
  const lines = [];
  for (let r = 0; r < SIZE; r++) lines.push(Array.from({ length: SIZE }, (_, c) => r * SIZE + c));
  for (let c = 0; c < SIZE; c++) lines.push(Array.from({ length: SIZE }, (_, r) => r * SIZE + c));
  lines.push(Array.from({ length: SIZE }, (_, i) => i * SIZE + i));
  lines.push(Array.from({ length: SIZE }, (_, i) => i * SIZE + (SIZE - 1 - i)));
  return lines;
})();

/** The four corner cells: a winning pattern besides any full line. */
export const CORNERS = [0, SIZE - 1, SIZE * (SIZE - 1), SIZE * SIZE - 1];

export const completedLines = (marks) => LINES.filter((line) => line.every((i) => marks[i]));
export const cornersComplete = (marks) => CORNERS.every((i) => marks[i]);

/** First winning pattern on the card under the line rules, or null (see the server for the rule of record). */
export function winningPattern(marks, linesToWin = 1) {
  const lines = completedLines(marks);
  if (lines.length >= linesToWin) return lines[0];
  return cornersComplete(marks) ? [...CORNERS] : null;
}

export const isCorners = (pattern) => Array.isArray(pattern) && pattern.length === 4 && CORNERS.every((i) => pattern.includes(i));
