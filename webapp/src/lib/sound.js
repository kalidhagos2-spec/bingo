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
  if (muted) speech?.cancel();
  try {
    localStorage.setItem('tgb-muted', muted ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  return muted;
}

const speech = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

/**
 * Voice call-out of a drawn number, letter first ("G… 57"), after the lead-in blip.
 * Uses the browser's built-in speech synthesis, so no audio files are needed; when it is
 * unavailable only the blip plays. A new call cancels any call-out still being spoken.
 */
export function announceCall(letter, number) {
  if (muted) return;
  playCall();
  if (!speech) return;
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
