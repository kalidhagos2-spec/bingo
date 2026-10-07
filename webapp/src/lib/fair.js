/**
 * Provable fairness check, run in the player's own browser. Mirrors server/src/game/bingo.js
 * (`seededPick` / `drawOrderFromSeed`): the ball order is a pure function of a seed whose SHA-256
 * was published before the round. Change both together.
 */
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = (text) => crypto.subtle.digest('SHA-256', enc.encode(text));

export async function commitOf(seed) {
  return hex(await sha256(seed));
}

export async function drawOrderFromSeed(seed, max = 75) {
  let counter = 0;
  let block = new Uint8Array(0);
  let pos = 0;
  const nextByte = async () => {
    if (pos >= block.length) {
      block = new Uint8Array(await sha256(`${seed}:${counter++}`));
      pos = 0;
    }
    return block[pos++];
  };
  const pick = async (n) => {
    const limit = 256 - (256 % n);
    let b;
    do b = await nextByte();
    while (b >= limit);
    return b % n;
  };
  const arr = Array.from({ length: max }, (_, i) => i + 1);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = await pick(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** { ok, commitOk, orderOk } — does the revealed seed match the commitment, and the called balls its order? */
export async function verifyRound({ seed, commit, called }) {
  if (!seed || !commit || !called?.length) return { ok: false, commitOk: false, orderOk: false, unavailable: true };
  const commitOk = (await commitOf(seed)) === commit;
  const order = await drawOrderFromSeed(seed);
  const orderOk = called.every((n, i) => order[i] === n);
  return { ok: commitOk && orderOk, commitOk, orderOk };
}
