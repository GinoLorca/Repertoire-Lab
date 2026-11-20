// The chess work of lib/positions, done ahead of time and never in one go.
//
// Playing out a whole library is seconds of work. Done the moment a screen
// asks, that's the screen frozen; done here, it's a few milliseconds at a
// time between everything else, starting shortly after the app opens — so by
// the time Coaches Corner or a student's page wants the positions, they're
// usually there. When they aren't yet, the screen says what it needs
// (requestWarm) and draws without it: its lines and games jump the queue,
// worked through briskly, and it's told as they arrive (onWarmed).
import {
  warmPositions, prunePositions, allCached, lineItem,
} from './positions';

const IDLE_BUDGET_MS = 12;   // a slice of background work
const IDLE_GAP_MS = 12;      // …and the pause after it, where the browser has no idle callback (Safari)
const QUIET_MS = 300;        // background work stands back this long after a touch, a scroll or a key
const EAGER_BUDGET_MS = 12;  // a slice of what a screen is waiting for
const TELL_EVERY_MS = 200;   // how often a waiting screen hears of progress
const MAX_WAITING = 4;      // requests kept at once

let background = { items: [], at: 0 };
const urgent = []; // batches a screen is waiting for; the newest is done first
const listeners = new Set();
let timer = null; // { eager, cancel }
let lastTold = 0;
let lastInput = 0; // when you last touched, scrolled or typed

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const hidden = () => typeof document !== 'undefined' && document.hidden;
const backgroundLeft = () => background.at < background.items.length;

function tell(force) {
  if (!listeners.size) return;
  const t = now();
  if (!force && t - lastTold < TELL_EVERY_MS) return;
  lastTold = t;
  for (const fn of [...listeners]) { try { fn(); } catch { /* a listener's own trouble */ } }
}

// "As soon as the browser has drawn and listened": a message to ourselves
// isn't held back the few milliseconds a chain of zero timers is, which adds
// up when a screen is waiting on thousands of slices. (In a browser only —
// elsewhere a timer does.)
const soon = (() => {
  if (typeof window === 'undefined' || typeof MessageChannel !== 'function') {
    return (fn) => {
      const id = setTimeout(fn, 0);
      return () => clearTimeout(id);
    };
  }
  const channel = new MessageChannel();
  let waiting = null;
  channel.port1.onmessage = () => {
    const fn = waiting;
    waiting = null;
    if (fn) fn();
  };
  return (fn) => {
    waiting = fn;
    channel.port2.postMessage(0);
    return () => { if (waiting === fn) waiting = null; };
  };
})();

function schedule(eager, waitMs = 0) {
  if (timer) {
    // Already on its way — unless it's the slow kind and this can't wait.
    if (timer.eager || !eager) return;
    timer.cancel();
    timer = null;
  }
  const run = (deadline) => {
    timer = null;
    step(deadline);
  };
  if (eager) {
    timer = { eager: true, cancel: soon(run) };
  } else if (waitMs > 0 || typeof requestIdleCallback !== 'function') {
    const id = setTimeout(run, Math.max(IDLE_GAP_MS, waitMs));
    timer = { eager: false, cancel: () => clearTimeout(id) };
  } else {
    const id = requestIdleCallback(run, { timeout: 1000 });
    timer = { eager: false, cancel: () => cancelIdleCallback(id) };
  }
}

function step(deadline) {
  // What a screen is waiting for comes first, the newest request first.
  if (urgent.length) {
    const batch = urgent[urgent.length - 1];
    batch.at = warmPositions(batch.items, { from: batch.at, budgetMs: EAGER_BUDGET_MS });
    if (batch.at >= batch.items.length) {
      urgent.pop();
      tell(true);
    } else {
      tell(false);
    }
  } else if (backgroundLeft() && !hidden()) {
    // The rest of the library, when nothing else is going on: not while
    // you're in the middle of something.
    const busyFor = QUIET_MS - (now() - lastInput);
    if (busyFor > 0) {
      schedule(false, busyFor);
      return;
    }
    const idle = deadline && typeof deadline.timeRemaining === 'function' ? deadline.timeRemaining() : 0;
    const budgetMs = Math.max(4, Math.min(16, idle || IDLE_BUDGET_MS));
    background.at = warmPositions(background.items, { from: background.at, budgetMs });
    if (!backgroundLeft()) tell(true);
  }
  if (urgent.length) schedule(true);
  else if (backgroundLeft() && !hidden()) schedule(false);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!hidden() && backgroundLeft()) schedule(false);
  });
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const touched = () => { lastInput = now(); };
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart', 'touchmove', 'scroll']) {
    window.addEventListener(type, touched, { passive: true, capture: true });
  }
}

// Every line and game in the library, in the order they're wanted: your own
// lines (every student's card and every board checks against them), then
// students' lines, then the games.
export function libraryItems(state) {
  const mine = [];
  const theirs = [];
  for (const o of state?.openings ?? []) {
    const into = (o.ownerId ?? null) === null ? mine : theirs;
    for (const c of o.chapters ?? []) for (const v of c.variations ?? []) into.push(lineItem(v));
  }
  const games = [];
  for (const p of state?.players ?? []) for (const g of p.games ?? []) games.push({ moves: g.moves });
  return [...mine, ...theirs, ...games];
}

// The library as it is now: what to have ready, in the background.
export function warmLibrary(state) {
  const items = libraryItems(state);
  prunePositions(items);
  background = { items, at: 0 };
  if (!hidden()) schedule(false);
}

// A screen needs these now: they're worked out next, briskly.
export function requestWarm(items) {
  if (!items?.length || allCached(items)) return;
  urgent.push({ items, at: 0 });
  // A screen redrawn with newer lists asks again; the oldest requests are
  // left to the background (it has everything in the library anyway).
  while (urgent.length > MAX_WAITING) urgent.shift();
  schedule(true);
}

// Told as positions arrive (not more often than a few times a second), and
// when a request is finished. Returns the way to stop listening.
export function onWarmed(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    // Nobody waiting any more (the screen was left): what it asked for goes
    // back to the background's pace — it's all in the library's list anyway.
    if (!listeners.size) urgent.length = 0;
  };
}

// For the tests: everything queued, done now.
export function flushWarm() {
  if (timer) { timer.cancel(); timer = null; }
  while (urgent.length) {
    const batch = urgent.pop();
    warmPositions(batch.items, { from: batch.at, budgetMs: Infinity });
  }
  background.at = warmPositions(background.items, { from: background.at, budgetMs: Infinity });
  tell(true);
}
