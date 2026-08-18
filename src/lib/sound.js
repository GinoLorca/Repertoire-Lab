// Synthesized move sounds in the spirit of the chess.com defaults:
// a short wooden "thock" for moves, deeper for captures, double for castling.
// Web Audio only — no audio files, works offline.

let ctx = null;
let master = null;
let volume = 1;

function getCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
  }
  return ctx;
}

// Everything routes through one gain node so volume applies to synthesized
// knocks and uploaded files alike.
function out() {
  getCtx();
  return master ?? ctx?.destination;
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v ?? 1));
  if (master) master.gain.value = volume;
}

export function getVolume() {
  return volume;
}

// Browsers keep audio suspended until a user gesture. Creating/resuming the
// context *inside* a gesture handler unlocks it, so do that eagerly on any
// click or keypress from the moment the app loads.
if (typeof window !== 'undefined') {
  const unlock = () => {
    const c = getCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
}

// One percussive knock: a pitch-dropping sine "thump" plus a tiny noise click.
function knock(c, delay, { freq, dur, vol, clickVol }) {
  const t = c.currentTime + delay;

  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(out());
  osc.start(t);
  osc.stop(t + dur + 0.02);

  const len = Math.floor(c.sampleRate * 0.012);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2200;
  bp.Q.value = 0.9;
  const ng = c.createGain();
  ng.gain.setValueAtTime(clickVol, t);
  src.connect(bp).connect(ng).connect(out());
  src.start(t);
}

// Checkmate: the knock of the move that delivered it, then a short rising
// three-note figure so the end of a game sounds like the end of a game.
function mateFlourish(c) {
  knock(c, 0, { freq: 150, dur: 0.09, vol: 0.9, clickVol: 0.28 });
  [[523.25, 0.10], [659.25, 0.22], [783.99, 0.34]].forEach(([freq, delay], i) => {
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    const g = c.createGain();
    const dur = i === 2 ? 0.45 : 0.16;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out());
    osc.start(t);
    osc.stop(t + dur + 0.02);
  });
}

function scheduleFor(c, san) {
  if (san.endsWith('#')) {
    mateFlourish(c);
  } else if (san.startsWith('O-O')) {
    knock(c, 0, { freq: 200, dur: 0.06, vol: 0.6, clickVol: 0.18 });
    knock(c, 0.09, { freq: 170, dur: 0.07, vol: 0.65, clickVol: 0.18 });
  } else if (san.includes('x')) {
    knock(c, 0, { freq: 145, dur: 0.09, vol: 0.9, clickVol: 0.3 });
  } else {
    knock(c, 0, { freq: 195, dur: 0.07, vol: 0.75, clickVol: 0.22 });
  }
}

// ---------------------------------------------------------------------------
// Custom sounds. Users can replace any event with their own audio file; the
// synthesized knocks above are the fallback when no file is set.
// ---------------------------------------------------------------------------

export const SOUND_EVENTS = [
  { key: 'move', label: 'Move', hint: 'A normal move' },
  { key: 'capture', label: 'Capture', hint: 'A piece is taken' },
  { key: 'castle', label: 'Castle', hint: 'O-O or O-O-O' },
  { key: 'check', label: 'Check', hint: 'A move giving check' },
  { key: 'checkmate', label: 'Checkmate', hint: 'A move that ends the game' },
  { key: 'correct', label: 'Correct', hint: 'You played the right move in practice' },
  { key: 'wrong', label: 'Wrong', hint: 'You played a wrong move' },
  { key: 'complete', label: 'Line complete', hint: 'You finished a variation' },
];

let customSounds = {};
const buffers = new Map();

// Called by the app whenever settings change.
export function setCustomSounds(map) {
  customSounds = map ?? {};
  for (const key of [...buffers.keys()]) {
    if (!customSounds[key]) buffers.delete(key);
  }
}

async function playCustom(key) {
  const src = customSounds?.[key];
  if (!src) return false;
  const c = getCtx();
  if (!c) return false;
  if (c.state !== 'running') { try { await c.resume(); } catch { return false; } }
  try {
    if (!buffers.has(key)) {
      const bytes = await (await fetch(src)).arrayBuffer();
      buffers.set(key, await c.decodeAudioData(bytes));
    }
    const node = c.createBufferSource();
    node.buffer = buffers.get(key);
    node.connect(out());
    node.start();
    return true;
  } catch {
    return false;
  }
}

function eventFor(san) {
  if (san.endsWith('#')) return 'checkmate'; // before 'check': mate is also "+"-ish
  if (san.startsWith('O-O')) return 'castle';
  if (san.includes('x')) return 'capture';
  if (san.endsWith('+')) return 'check';
  return 'move';
}

export function playMoveSound(san) {
  if (!san) return;
  const key = eventFor(san);
  playCustom(key).then((done) => {
    if (done) return;
    // 'check' has no synthesized voice of its own — fall back to its base move.
    if (key === 'check') { playCustom('move').then((ok) => { if (!ok) synth(san); }); return; }
    synth(san);
  });
}

// Non-move events (correct / wrong / line complete). Silent unless a custom
// file is set, so nothing changes for people who don't use this.
export function playEventSound(key) {
  playCustom(key);
}

// Decode any custom sounds up front. The first play of an uploaded file
// otherwise has to fetch and decode it, which lands the sound noticeably after
// the moment it belongs to — the end of a line, most of all.
export async function primeSounds() {
  const c = getCtx();
  if (!c) return;
  const keys = SOUND_EVENTS.map((e) => e.key).filter((k) => customSounds?.[k] && !buffers.has(k));
  await Promise.all(keys.map(async (key) => {
    try {
      const bytes = await (await fetch(customSounds[key])).arrayBuffer();
      buffers.set(key, await c.decodeAudioData(bytes));
    } catch { /* a bad file simply stays unprimed */ }
  }));
}

function synth(san) {
  try {
    const c = getCtx();
    if (!c) return;
    if (c.state === 'running') {
      scheduleFor(c, san);
    } else {
      // Resume may be pending from a just-happened gesture — play once it lands.
      c.resume().then(() => {
        if (c.state === 'running') scheduleFor(c, san);
      }).catch(() => {});
    }
  } catch { /* audio is best-effort */ }
}
