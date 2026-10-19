// Before & After: a critical position in a game, and where it led.
//
// A moment pins up to three places in a game's tree — the position that
// mattered (the Before), where the game went from there (the After, what was
// played) and, when there was something better, where that would have led
// (the Better) — with a title, a note and Stockfish's score at each. It's
// what a coach puts up to show cause and effect: this move, and what it was
// still costing ten moves later.
//
//   { id, title?, note?,
//     before: [san],    the moves from the start to the critical position
//     after: [san],     …on to the After — always through `before`
//     better?: [san],   …on to the Better — through `before` too, but off the
//                       way to the After
//     evals?: { before?, after?, better? } }   { type: 'cp' | 'mate', value },
//                                              from White's side (lib/engine)
//
// Places are kept as the moves that lead there, not node ids: ids are made
// afresh whenever a tree is rebuilt, and the moves are the same in every copy
// of it — the coach's, the student's, a Lab session's.
//
// Pure, so tests/moments.test.mjs covers it.
import { Chess } from 'chess.js';
import { materialDiff } from './material';
import { newGameAt, moveNumberLabel, sideToMove } from './startPos';

export const MAX_MOMENTS = 20;
export const MAX_TITLE = 120;
export const MAX_MOMENT_NOTE = 2000;
export const SLOTS = ['before', 'after', 'better'];
const MAX_PATH = 600;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// The node `path` leads to, or null when the tree doesn't have every move of
// it — unlike nodeAtPath (lib/reviewsInProgress), which settles for as far as
// it gets: a moment on a move that's gone isn't on the move before it.
export function nodeAt(tree, path) {
  let node = tree;
  for (const san of path ?? []) {
    node = node?.children?.find((c) => c.san === san);
    if (!node) return null;
  }
  return node ?? null;
}

export const startsWith = (path, prefix) => prefix.length <= path.length
  && prefix.every((san, i) => path[i] === san);

// An After is further on from the Before, along the same moves.
export const canFollow = (before, path) => path.length > before.length && startsWith(path, before);

// A Better also carries on from the Before, but somewhere the game didn't go:
// not on the way to the After, and not past it either.
export const canBeBetter = (moment, path) => canFollow(moment.before, path)
  && !startsWith(moment.after, path) && !startsWith(path, moment.after);

// The moves from one place to another further on — the chain of cause and
// effect between a Before and its After.
export const movesBetween = (from, to) => (canFollow(from, to) ? to.slice(from.length) : []);

// In the order they happen in the game, so Present walks through it start to
// finish: by the Before, then the After.
export const inGameOrder = (list) => [...list].sort((a, b) => (a.before.length - b.before.length)
  || (a.after.length - b.after.length));

function cleanPath(v) {
  if (!Array.isArray(v) || v.length > MAX_PATH) return null;
  return v.every((san) => typeof san === 'string' && san.length > 0 && san.length <= 12) ? [...v] : null;
}

function cleanScore(s) {
  if (!isObj(s) || !Number.isInteger(s.value)) return null;
  if (s.type === 'cp' && Math.abs(s.value) <= 100000) return { type: 'cp', value: s.value };
  if (s.type === 'mate' && Math.abs(s.value) <= 500) return { type: 'mate', value: s.value };
  return null;
}

function cleanEvals(raw, moment) {
  if (!isObj(raw)) return null;
  const out = {};
  for (const slot of SLOTS) {
    if (slot === 'better' && !moment.better) continue;
    const s = cleanScore(raw[slot]);
    if (s) out[slot] = s;
  }
  return Object.keys(out).length ? out : null;
}

// A list from storage, a save or another account, rebuilt from what's allowed
// and nothing more — and only moments whose places `tree` still has: a
// moment on a move that was taken out goes with it. A Better that's gone, or
// was never a real alternative, is dropped from its moment on its own.
export function cleanMoments(raw, tree) {
  if (!Array.isArray(raw) || !tree) return [];
  const out = [];
  const ids = new Set();
  for (const m of raw.slice(0, MAX_MOMENTS * 4)) {
    if (out.length >= MAX_MOMENTS) break;
    if (!isObj(m)) continue;
    const before = cleanPath(m.before);
    const after = cleanPath(m.after);
    if (!before || !after || !canFollow(before, after)) continue;
    if (!nodeAt(tree, before) || !nodeAt(tree, after)) continue;
    let id = typeof m.id === 'string' && ID.test(m.id) && !ids.has(m.id) ? m.id : null;
    for (let n = out.length + 1; !id; n += 1) if (!ids.has(`m${n}`)) id = `m${n}`;
    ids.add(id);
    const moment = { id, before, after };
    const title = text(m.title, MAX_TITLE);
    const note = text(m.note, MAX_MOMENT_NOTE);
    if (title) moment.title = title;
    if (note) moment.note = note;
    const better = cleanPath(m.better);
    if (better && canBeBetter(moment, better) && nodeAt(tree, better)) moment.better = better;
    const evals = cleanEvals(m.evals, moment);
    if (evals) moment.evals = evals;
    out.push(moment);
  }
  return inGameOrder(out);
}

// The position at the end of `path`, played from `baseFen` the way the
// analysis board plays it (so it's the same key its drawings are kept under)
// — null if a move doesn't play.
export const fenAt = (baseFen, path) => placeAt(baseFen, path)?.fen ?? null;

// …and the move that got there ({ from, to }, null at the start), for the
// board's last-move squares.
export function placeAt(baseFen, path) {
  try {
    const g = newGameAt(baseFen);
    let lastMove = null;
    for (const san of path) {
      const mv = g.move(san);
      lastMove = { from: mv.from, to: mv.to };
    }
    return { fen: g.fen(), lastMove };
  } catch {
    return null;
  }
}

// ---------- Saying where a moment is ----------

// "14…c5": the move at `i` in a line from `baseFen`, numbered.
const numbered = (path, i, baseFen) => `${moveNumberLabel(i, baseFen, '…')}${path[i]}`;

// The move a place is reached by — "13…Be7" — or "Start" for the position
// before any move.
export const placeLabel = (path, baseFen) => (path?.length ? numbered(path, path.length - 1, baseFen) : 'Start');

// What a moment is about, when it hasn't been given a title: the move played
// from the Before — "14.c5".
export const defaultTitle = (moment, baseFen) => numbered(moment.after, moment.before.length, baseFen);

// The moves from one place on to another, the way a book prints them —
// "14.c5 Nd7 15.Nd5 … 22.Nd5" — with the middle left out past `max` moves.
export function movesText(from, to, baseFen, { max = 8 } = {}) {
  const parts = [];
  for (let i = from.length; i < to.length; i += 1) {
    const white = (moveNumberLabel(i, baseFen, '…')).endsWith('.');
    parts.push(white || i === from.length ? numbered(to, i, baseFen) : to[i]);
  }
  if (parts.length <= max) return parts.join(' ');
  const head = parts.slice(0, max - 2);
  const last = to.length - 1;
  const tail = (moveNumberLabel(last, baseFen, '…')).endsWith('.') ? parts[parts.length - 1] : numbered(to, last, baseFen);
  return `${head.join(' ')} … ${tail}`;
}

// ---------- Scores ----------

// Stockfish's score, short: "+0.3", "−1.8", "#3", "#−2". From White's side.
export function scoreText(score) {
  if (!score) return '…';
  if (score.type === 'mate') return `#${score.value < 0 ? '−' : ''}${Math.abs(score.value)}`;
  const v = score.value / 100;
  if (Math.abs(v) < 0.05) return '0.0';
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
}

// One of a moment's scores, short — and "Mate" for a place that is already
// checkmate, which the engine has no line for (lib/gameReview gameOverScore).
export function slotScore(moment, slot, baseFen) {
  const fen = moment[slot] && fenAt(baseFen, moment[slot]);
  if (fen && new Chess(fen).isCheckmate()) return 'Mate';
  return scoreText(moment.evals?.[slot]);
}

// A score in centipawns for the side to move at the Before — a forced mate
// as a flat 1000, the way the game reviewer counts it.
const forSide = (score, side) => {
  const cp = score.type === 'mate' ? Math.sign(score.value) * 1000 : score.value;
  return side === 'w' ? cp : -cp;
};

// How it went from the Before to `slot` for the side whose move it was at the
// Before: 'worse' or 'better' by a pawn or more, else 'same' — and null until
// both scores are in.
export function swing(moment, baseFen, slot = 'after') {
  const a = moment.evals?.before;
  const b = moment.evals?.[slot];
  if (!a || !b) return null;
  const side = sideToMove(fenAt(baseFen, moment.before) ?? baseFen);
  const delta = forSide(b, side) - forSide(a, side);
  return { delta, tone: delta <= -100 ? 'worse' : delta >= 100 ? 'better' : 'same' };
}

// Every move a moment marks, by node id: { [id]: [{ role, n }] }, `role`
// 'before' | 'after' | 'better' and `n` the moment's number in game order —
// for the move list's markers. A move can be one moment's After and the next
// one's Before.
export function momentMarks(tree, moments) {
  const out = {};
  (moments ?? []).forEach((m, i) => {
    for (const role of SLOTS) {
      const node = m[role] && nodeAt(tree, m[role]);
      if (node && node.id !== 'root') out[node.id] = [...(out[node.id] ?? []), { role, n: i + 1 }];
    }
  });
  return out;
}

// ---------- What changed between two positions ----------

const FILES = 'abcdefgh';
const pieceCode = (p) => `${p.color}${p.type.toUpperCase()}`; // 'wN', 'bP' — the board's own piece names

function squaresOf(fen) {
  const out = {};
  const board = new Chess(fen).board();
  board.forEach((row, r) => row.forEach((p, f) => {
    if (p) out[`${FILES[f]}${8 - r}`] = pieceCode(p);
  }));
  return out;
}

// What's different on the board from one position to the other: the pieces
// no longer standing where they stood (`left` — the After board's ghosts),
// what now stands somewhere new (`arrived`), and the material count at each,
// as White's lead in points (lib/material: positive is White ahead).
export function boardChange(fromFen, toFen) {
  const a = squaresOf(fromFen);
  const b = squaresOf(toFen);
  const left = [];
  const arrived = [];
  for (const [square, piece] of Object.entries(a)) if (b[square] !== piece) left.push({ square, piece });
  for (const [square, piece] of Object.entries(b)) if (a[square] !== piece) arrived.push({ square, piece });
  const bySquare = (x, y) => x.square.localeCompare(y.square);
  return {
    left: left.sort(bySquare),
    arrived: arrived.sort(bySquare),
    material: { from: materialDiff(fromFen).diff, to: materialDiff(toFen).diff },
  };
}

// White's lead in points, said the way a coach says it.
export const materialLabel = (lead) => {
  if (lead === 0) return 'Material even';
  return `${lead > 0 ? 'White' : 'Black'} +${Math.abs(lead)}`;
};

// ---------- Carrying marks forward ----------

const EMPTY = { arrows: [], squares: {} };

// The Before's arrows and squares added onto the After — the weakness that's
// still there ten moves later, pointed out in the same colours. What the
// After already had stays as it was: an arrow or a square it has its own
// colour for keeps it.
export function carryMarks(annotations, fromFen, toFen) {
  const from = annotations?.[fromFen] ?? EMPTY;
  const to = annotations?.[toFen] ?? EMPTY;
  const has = new Set((to.arrows ?? []).map((a) => `${a[0]}${a[1]}`));
  const arrows = [...(to.arrows ?? []), ...(from.arrows ?? []).filter((a) => !has.has(`${a[0]}${a[1]}`))];
  const squares = { ...(from.squares ?? {}), ...(to.squares ?? {}) };
  return { ...annotations, [toFen]: { arrows, squares } };
}

// Whether carrying forward would add anything at all.
export function canCarry(annotations, fromFen, toFen) {
  const next = carryMarks(annotations, fromFen, toFen)[toFen];
  const to = annotations?.[toFen] ?? EMPTY;
  return next.arrows.length > (to.arrows?.length ?? 0)
    || Object.keys(next.squares).length > Object.keys(to.squares ?? {}).length;
}

// ---------- Presenting ----------

// The steps Present walks through for one moment, in order:
//   { kind: 'before' }       the Before, the After covered — what happens next?
//   { kind: 'play', i }      the moves in between, one at a time (i played)
//   { kind: 'after' }        the After, uncovered: scores, drawings, the note
//   { kind: 'better' }       the Better beside them, when there is one
// With `cover` off, the After is there from the start and nothing is replayed.
export function presentSteps(moment, { cover = true } = {}) {
  const steps = [];
  if (cover) {
    steps.push({ kind: 'before' });
    const n = moment.after.length - moment.before.length;
    for (let i = 1; i < n; i += 1) steps.push({ kind: 'play', i });
  }
  steps.push({ kind: 'after' });
  if (moment.better) steps.push({ kind: 'better' });
  return steps;
}

// Every moment's steps end to end — what → and ← walk along — each with its
// moment's index.
export function presentPlan(moments, opts) {
  return moments.flatMap((m, index) => presentSteps(m, opts).map((step) => ({ ...step, index })));
}

// Where in the plan a moment starts.
export const planStart = (plan, index) => Math.max(0, plan.findIndex((s) => s.index === index));
