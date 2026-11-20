// The positions a line of moves passes through — worked out once.
//
// Naming a game's opening, finding the book move on the analysis board,
// counting a student's off-beat games: each asks "which positions does this
// line reach?", and answering means playing the moves out with chess.js —
// about the slowest thing the app does (it generates every legal move to read
// one). That used to be asked again on every redraw: Coaches Corner replayed
// the whole library once per student card, and every game twice, each time
// anything changed — seconds, on a real library, and more with every line,
// student and game added.
//
// So each distinct line is played out once and remembered by what it is — its
// start and its moves, as text — not by which object holds it: a sync swaps
// every opening and game for new objects that say the same thing, and they
// find their positions already here. A student's copy of one of your lines
// costs nothing either.
//
// Nothing is kept beyond the session, and what's remembered follows the
// library: lines that are no longer anywhere in it are dropped
// (prunePositions).
//
// tests/positions.test.mjs holds it to the code it replaced, move for move.
import { START_FEN, newGameAt } from './startPos';

// Position key: piece placement, side to move, castling and en passant.
export const fen4 = (fen) => fen.split(' ').slice(0, 4).join(' ');

// A line's identity: where it starts and its moves. The separators can't be
// in a move, so two different lists never read as one.
const SEP = '\u0001';
const sigOf = (moves, startFen) => `${startFen && startFen !== START_FEN ? startFen : ''}\u0002${
  Array.isArray(moves) ? moves.join(SEP) : ''}`;

const cache = new Map(); // sig → { keys, last }
// Move lists already known to be here, by the array itself — so asking "is
// this one done?" for thousands of lines needn't build thousands of strings.
// Only ever a shortcut for that question: positionsOf always goes by content.
let known = new WeakSet();
let walked = 0; // lines played out this session (for the tests)

// ---------- Playing a move, the short way ----------
//
// chess.js's move() does three things: reads the move (which of the legal
// moves is "Nf3"?), plays it, and writes a report of it — its SAN again from
// every legal move, the position before and after as text. Only the first
// two matter here, and the report is most of the cost: without it a library
// is played out in well under half the time.
//
// Reading and playing are chess.js's own two steps, called directly. They
// aren't part of its published interface, so nothing is taken on trust: the
// first time, a few lines with everything awkward in them (castling both
// ways, en passant, promotion, checks) are played both ways, and unless
// every position agrees — a later chess.js that works differently, say —
// the short way is never used. A move it can't settle goes the long way too.
const PROBES = [
  [['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'd4', 'exd4', 'e5', 'd5', 'exd6', 'Qxd6', 'Re1+', 'Be6', 'Ng5', 'O-O-O', 'Nxe6', 'fxe6']],
  [['a8=Q', 'h1=Q+', 'Kg3', 'Qg1+', 'Kf4'], '8/P6k/8/8/8/8/6Kp/8 w - - 0 1'],
  [['Nbd2', 'Rae8', 'O-O-O', 'b5', 'Kb1', 'b4'], 'r4rk1/pp1bbppp/2n1pn2/q2p4/3P1B2/2PBPN2/PPQ2PPP/RN2K2R w KQ - 4 10'],
];
let quick = null; // not yet checked

const playLong = (chess, san) => {
  try { return Boolean(chess.move(san)); } catch { return false; }
};

function playQuick(chess, san) {
  if (typeof san !== 'string') return playLong(chess, san);
  let move;
  try { move = chess._moveFromSan(san, false); } catch { return playLong(chess, san); }
  if (!move) return false; // move() would have refused it
  // "--", a null move (it has nowhere to go): chess.js has rules of its own
  // for when one may be played.
  if (move.from === move.to) return playLong(chess, san);
  chess._makeMove(move);
  return true;
}

function trail(moves, startFen, play) {
  const chess = newGameAt(startFen);
  const keys = [fen4(chess.fen())];
  for (const san of Array.isArray(moves) ? moves : []) {
    // The first move that can't be played ends the line there, as it did
    // when each caller played the moves out itself.
    if (!play(chess, san)) break;
    keys.push(fen4(chess.fen()));
  }
  return { keys, last: chess.fen() };
}

function quickIsSound() {
  try {
    const probe = newGameAt(START_FEN);
    if (typeof probe._moveFromSan !== 'function' || typeof probe._makeMove !== 'function') return false;
    for (const [moves, startFen] of PROBES) {
      const a = trail(moves, startFen, playLong);
      const b = trail(moves, startFen, playQuick);
      if (a.keys.length !== moves.length + 1 || a.last !== b.last) return false;
      if (a.keys.length !== b.keys.length || a.keys.some((k, i) => k !== b.keys[i])) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function walk(moves, startFen) {
  if (quick === null) quick = quickIsSound();
  walked += 1;
  return trail(moves, startFen, quick ? playQuick : playLong);
}

// For the tests: whether the short way is in use (null: not yet decided),
// and a way to rule it out or let it be decided again.
export const quickPlay = () => quick;
export function setQuickPlay(on) { quick = on; }
export const QUICK_PROBES = PROBES;

// { keys, last }: keys[0] is the start, keys[i] the position after i moves —
// as far as the moves can be played; `last` is the full FEN of the position
// the line ends in. Shared, so never changed by a caller.
export function positionsOf(moves, startFen = START_FEN) {
  const sig = sigOf(moves, startFen);
  let hit = cache.get(sig);
  if (!hit) {
    hit = walk(moves, startFen);
    cache.set(sig, hit);
  }
  if (Array.isArray(moves)) known.add(moves);
  return hit;
}

// The same, for a line that's only passing through — the moves on a board
// as you explore, a search typed in: the library's own lines and games are
// found as above, anything else is kept just long enough to be asked about
// again (a board asks about the same line on every redraw), so hours of
// exploring leave nothing behind.
const PASSING = 64;
const passing = new Map(); // sig → { keys, last }, the most recent last
export function positionsOnce(moves, startFen = START_FEN) {
  const sig = sigOf(moves, startFen);
  const kept = cache.get(sig);
  if (kept) return kept;
  let hit = passing.get(sig);
  if (hit) {
    passing.delete(sig);
  } else {
    hit = walk(moves, startFen);
    if (passing.size >= PASSING) passing.delete(passing.keys().next().value);
  }
  passing.set(sig, hit);
  return hit;
}

// Whether a line's positions are already worked out (asking never works
// them out).
export function hasPositions(moves, startFen = START_FEN) {
  if (Array.isArray(moves) && known.has(moves)) return true;
  if (!cache.has(sigOf(moves, startFen))) return false;
  if (Array.isArray(moves)) known.add(moves);
  return true;
}

// Lines as { moves, startFen } — what the functions below take.
export const lineItem = (v) => ({ moves: v?.moves, startFen: v?.startFen || undefined });

export const allCached = (items) => {
  for (const it of items) if (!hasPositions(it.moves, it.startFen)) return false;
  return true;
};

// A few missing — a game just added, a line just edited — are worked out on
// the spot (true: all there now); more than `max` are left for the
// background (false), so a screen neither waits on a whole library nor
// blinks over one new game.
export function settleSmall(items, max = 8) {
  const missing = [];
  for (const it of items) {
    if (hasPositions(it.moves, it.startFen)) continue;
    missing.push(it);
    if (missing.length > max) return false;
  }
  for (const it of missing) positionsOf(it.moves, it.startFen);
  return true;
}

// Works out the ones that aren't yet, from `from` on, until `budgetMs` has
// gone: the index to carry on from next time (items.length: all done).
export function warmPositions(items, { from = 0, budgetMs = 8 } = {}) {
  const until = performance.now() + budgetMs;
  let i = from;
  for (; i < items.length; i += 1) {
    const it = items[i];
    if (hasPositions(it.moves, it.startFen)) continue;
    positionsOf(it.moves, it.startFen);
    if (performance.now() >= until) { i += 1; break; }
  }
  return i;
}

// Forgets lines that are no longer in the library, once there are clearly
// more remembered than it has: `items` is everything it has now.
export function prunePositions(items) {
  if (cache.size <= items.length * 1.5 + 2000) return 0;
  const live = new Set();
  for (const it of items) live.add(sigOf(it.moves, it.startFen));
  let dropped = 0;
  for (const sig of cache.keys()) {
    if (!live.has(sig)) { cache.delete(sig); dropped += 1; }
  }
  // The shortcut may name arrays whose lines just went.
  if (dropped) known = new WeakSet();
  return dropped;
}

// For the tests: how many lines are remembered, and how many were played out.
export const positionsStats = () => ({ size: cache.size, passing: passing.size, walked });
export function resetPositions() {
  cache.clear();
  passing.clear();
  known = new WeakSet();
  walked = 0;
}
