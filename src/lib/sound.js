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

// A bright short ping layered on top of the move/capture knock to mark check,
// the way chess.com layers its check voice over the capture voice when a move
// does both at once.
function checkChime(c, delay) {
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(1174.66, t + 0.05);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  osc.connect(g).connect(out());
  osc.start(t);
  osc.stop(t + 0.18);
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

// Plays just the base move/capture knock — used both for a full synth pass
// and to fill in the piece a custom sound didn't cover.
function synthBase(c, isCapture) {
  if (isCapture) {
    knock(c, 0, { freq: 145, dur: 0.09, vol: 0.9, clickVol: 0.3 });
  } else {
    knock(c, 0, { freq: 195, dur: 0.07, vol: 0.75, clickVol: 0.22 });
  }
}

function scheduleFor(c, san) {
  if (san.endsWith('#')) {
    mateFlourish(c);
  } else if (san.startsWith('O-O')) {
    knock(c, 0, { freq: 200, dur: 0.06, vol: 0.6, clickVol: 0.18 });
    knock(c, 0.09, { freq: 170, dur: 0.07, vol: 0.65, clickVol: 0.18 });
  } else {
    synthBase(c, san.includes('x'));
    if (san.endsWith('+')) checkChime(c, 0.02);
  }
}

// ---------------------------------------------------------------------------
// Custom sounds. Real recordings ship as the default for five events; users
// can replace any event (including those five) with their own file, and the
// synthesized knocks above are the last-resort fallback for whatever neither
// covers.
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

// Shipped with the app — no upload required. castle/correct/wrong have no
// recording and fall through to the synthesized sound (castle) or silence
// (correct/wrong), same as before.
export const DEFAULT_SOUNDS = {
  move: '/sounds/move.mp3',
  capture: '/sounds/capture.mp3',
  check: '/sounds/check.mp3',
  checkmate: '/sounds/checkmate.mp3',
  complete: '/sounds/complete.mp3',
};

let customSounds = {};
const buffers = new Map(); // key -> decoded AudioBuffer
const bufferSrc = new Map(); // key -> the src that buffer was decoded from

// Called by the app whenever settings change.
export function setCustomSounds(map) {
  customSounds = map ?? {};
}

function sourceFor(key) {
  return customSounds?.[key] || DEFAULT_SOUNDS[key] || null;
}

// Fetches and decodes once per distinct src, not once per key — so
// uploading over a key that already had a shipped default (or a different
// upload) correctly replaces what plays, instead of the old buffer sticking
// around because a key-only cache never noticed the source changed.
async function bufferFor(c, key, src) {
  if (buffers.has(key) && bufferSrc.get(key) === src) return buffers.get(key);
  const bytes = await (await fetch(src)).arrayBuffer();
  const buf = await c.decodeAudioData(bytes);
  buffers.set(key, buf);
  bufferSrc.set(key, src);
  return buf;
}

async function playCustom(key) {
  const src = sourceFor(key);
  if (!src) return false;
  const c = getCtx();
  if (!c) return false;
  if (c.state !== 'running') { try { await c.resume(); } catch { return false; } }
  try {
    const node = c.createBufferSource();
    node.buffer = await bufferFor(c, key, src);
    node.connect(out());
    node.start();
    return true;
  } catch {
    return false;
  }
}

export function playMoveSound(san) {
  if (!san) return;
  if (san.endsWith('#')) {
    playCustom('checkmate').then((done) => { if (!done) synth(san); });
    return;
  }
  if (san.startsWith('O-O')) {
    playCustom('castle').then((done) => { if (!done) synth(san); });
    return;
  }
  // A move that both captures and checks plays both voices at once, the way
  // chess.com layers its capture and check sounds together instead of
  // picking just one.
  const isCapture = san.includes('x');
  const isCheck = san.endsWith('+');
  Promise.all([
    playCustom(isCapture ? 'capture' : 'move'),
    isCheck ? playCustom('check') : Promise.resolve(true),
  ]).then(([baseDone, checkDone]) => {
    if (baseDone && checkDone) return;
    synthPartial(!baseDone && isCapture, !baseDone, isCheck && !checkDone);
  });
}

// Synthesizes only the pieces a custom sound didn't already cover, so a
// custom capture file paired with no custom check file still gets a chime
// layered on top rather than silence or a duplicate knock.
function synthPartial(isCapture, needBase, needCheck) {
  withAudio((c) => {
    if (needBase) synthBase(c, isCapture);
    if (needCheck) checkChime(c, 0.02);
  });
}

// Non-move events (correct / wrong / line complete). Silent unless a shipped
// default or a custom file covers the key — correct/wrong have neither, so
// nothing changes for people who don't set one.
export function playEventSound(key) {
  playCustom(key);
}

// Decode every event's effective sound (shipped default or an upload) up
// front. The first play otherwise has to fetch and decode it, which lands
// the sound noticeably after the moment it belongs to — the end of a line,
// most of all.
export async function primeSounds() {
  const c = getCtx();
  if (!c) return;
  const keys = SOUND_EVENTS.map((e) => e.key).filter((k) => sourceFor(k));
  await Promise.all(keys.map(async (key) => {
    try { await bufferFor(c, key, sourceFor(key)); } catch { /* a bad file simply stays unprimed */ }
  }));
}

// Resume may be pending from a just-happened gesture — play once it lands.
function withAudio(fn) {
  try {
    const c = getCtx();
    if (!c) return;
    if (c.state === 'running') {
      fn(c);
    } else {
      c.resume().then(() => { if (c.state === 'running') fn(c); }).catch(() => {});
    }
  } catch { /* audio is best-effort */ }
}

function synth(san) {
  withAudio((c) => scheduleFor(c, san));
}
