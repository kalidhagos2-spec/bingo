let ctx;
let muted = false;
try {
  muted = localStorage.getItem('tgb-muted') === '1';
} catch {
  /* storage unavailable */
}

export function isMuted() {
  return muted;
}

/** Toggle (or set) the mute flag; remembered per device. */
export function setMuted(value = !muted) {
  muted = Boolean(value);
  if (muted) {
    speech?.cancel();
    stopClip();
  }
  try {
    localStorage.setItem('tgb-muted', muted ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  return muted;
}

const speech = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

// Call-out language: 'am' plays the recorded Amharic clips in /audio/am (see
// scripts/make_amharic_audio.py), 'en' uses the phone's own English speech engine.
let voice = 'am';
try {
  if (localStorage.getItem('tgb-voice') === 'en') voice = 'en';
} catch {
  /* storage unavailable */
}

export function getVoice() {
  return voice;
}

/** One button cycles the call-outs: Amharic → English → muted → Amharic. Returns the new { muted, voice }. */
export function cycleSound() {
  if (muted) {
    setMuted(false);
    voice = 'am';
  } else if (voice === 'am') voice = 'en';
  else setMuted(true);
  try {
    localStorage.setItem('tgb-voice', voice);
  } catch {
    /* storage unavailable */
  }
  stopClip();
  preloadCalls();
  return { muted, voice };
}

// ---------- Amharic clips ----------
// The mp3s are fetched once, in the background, when a player sits down at a table (about
// 0.8 MB in total, cached by the browser afterwards) so a call never waits on the network.
const CLIP_COUNT = 75;
const clips = new Map(); // number -> Promise<ArrayBuffer | null>
let playing = null;

function fetchClip(n) {
  if (!clips.has(n)) {
    clips.set(
      n,
      fetch(`/audio/am/${n}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => {
          clips.delete(n); // offline blip: try again next time
          return null;
        }),
    );
  }
  return clips.get(n);
}

/** Starts downloading every Amharic call-out, a few at a time. Safe to call repeatedly. */
export function preloadCalls() {
  if (muted || voice !== 'am' || clips.size >= CLIP_COUNT) return;
  let next = 1;
  const worker = async () => {
    while (next <= CLIP_COUNT) await fetchClip(next++);
  };
  for (let i = 0; i < 4; i++) worker();
}

function stopClip() {
  try {
    playing?.stop();
  } catch {
    /* already ended */
  }
  playing = null;
}

/** Plays the Amharic clip of `number`; resolves false when it cannot (no clip, no audio) so the caller can fall back. */
async function playAmharic(number) {
  const ac = getContext();
  if (!ac) return false;
  const data = await fetchClip(number);
  if (!data) return false;
  try {
    const buffer = await ac.decodeAudioData(data.slice(0)); // decoding detaches its input: keep ours
    if (muted || voice !== 'am') return true;
    stopClip();
    const source = ac.createBufferSource();
    source.buffer = buffer;
    source.connect(ac.destination);
    source.start();
    playing = source;
    return true;
  } catch {
    return false;
  }
}

/**
 * Voice call-out of a drawn number, letter first ("G… 57"), after the lead-in blip: the
 * recorded Amharic clip by default, the browser's English speech when the player picked EN
 * or the clip is unavailable. A new call cuts off any call-out still being spoken.
 */
export function announceCall(letter, number) {
  if (muted) return;
  playCall();
  if (voice === 'am') {
    speech?.cancel();
    playAmharic(number).then((ok) => !ok && speakEnglish(letter, number));
    return;
  }
  stopClip();
  speakEnglish(letter, number);
}

function speakEnglish(letter, number) {
  if (muted || !speech) return;
  try {
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(`${letter}, ${number}`);
    utterance.lang = 'en-US';
    utterance.rate = 1;
    utterance.pitch = 1;
    speech.speak(utterance);
  } catch {
    /* speech unavailable in this webview */
  }
}

function getContext() {
  if (muted) return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(ac, freq, start, duration, type = 'sine', gain = 0.25) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** Short click when a cell is marked. */
export function playMark() {
  const ac = getContext();
  if (!ac) return;
  tone(ac, 660, ac.currentTime, 0.08, 'triangle', 0.12);
}

/** Rising chime when a line is completed. */
export function playLine() {
  const ac = getContext();
  if (!ac) return;
  const t = ac.currentTime;
  tone(ac, 523.25, t, 0.18, 'triangle', 0.18);
  tone(ac, 783.99, t + 0.1, 0.25, 'triangle', 0.18);
}

/** Soft blip each time the caller announces a number. */
export function playCall() {
  const ac = getContext();
  if (!ac) return;
  tone(ac, 880, ac.currentTime, 0.06, 'sine', 0.08);
}

/** Fanfare for BINGO. */
export function playWin() {
  const ac = getContext();
  if (!ac) return;
  const t = ac.currentTime;
  const melody = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
  melody.forEach((f, i) => tone(ac, f, t + i * 0.13, 0.28, 'square', 0.12));
  tone(ac, 261.63, t, 1.2, 'sine', 0.1);
  tone(ac, 329.63, t + 0.3, 1.0, 'sine', 0.1);
}
