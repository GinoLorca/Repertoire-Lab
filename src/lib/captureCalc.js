// The Capture Calculator: play out a forcing line with captures on the
// analysis board and keep a running material count, so a move that "looks
// good" but loses material is plain to see. Chess Arcade's review board has
// the same calculator with the same words (its hvCalc*); both apps pass the
// same cases (tests/fixtures/captureCalc.cases.json).
//
// Counting, from where the calculator was turned on (the start):
//   · a capture wins the piece taken: pawn 1, knight 3, bishop 3, rook 5,
//     queen 9 (en passant takes a pawn);
//   · a promotion wins what the new piece is worth over the pawn: a queen 8,
//     a rook 4, a bishop or a knight 2 — a capturing promotion counts both;
//   · the balance is White's points less Black's.
// Whether the trades are finished is the board's own legal moves (chess.js):
// can the side to move take on the square of the last capture? A pinned
// piece can't, so it doesn't count.
//
// The calculator's moves are scratch: kept here, outside the board's move
// tree, until "Keep as a side line" (calcKeep) puts them into it.
//
// Pure — no React, no store: tests/captureCalc.test.mjs.
import { Chess } from 'chess.js';
import { moveNumberLabel, isWhiteMove } from './startPos';
import { addMove, findNode } from './moveTree';

export const CALC_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
export const PIECE_NAME = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};
export const SIDE_NAME = { w: 'White', b: 'Black' };

// ---------- Counting ----------

// A move with its number, as the calculator writes it: "15. Bxh7+" for White,
// "15...Kxh7" for Black. `i` counts from the line's start (lib/startPos).
export const moveLabel = (i, startFen, san) => (isWhiteMove(i, startFen)
  ? `${moveNumberLabel(i, startFen)} ${san}`
  : `${moveNumberLabel(i, startFen)}${san}`);

// The sequence played from `startFen`: each move with what it took and what
// it's worth to the side that played it, and the position after every move
// (fens[0] is the start). Stops at the first move that can't be played there.
// Null when the start itself won't load.
export function calcLine(startFen, sans = []) {
  let game;
  try { game = new Chess(startFen); } catch { return null; }
  const start = game.fen();
  const moves = [];
  const fens = [start];
  for (const san of sans) {
    let mv = null;
    try { mv = game.move(san); } catch { mv = null; }
    if (!mv) break;
    const i = moves.length;
    // chess.js says isCapture() is false for en passant (its flag is 'e'),
    // but `captured` is still 'p' — so `captured` is what's read.
    const captured = mv.captured ?? null;
    const promotion = mv.promotion ?? null;
    const points = (captured ? CALC_VALUES[captured] ?? 0 : 0)
      + (promotion ? (CALC_VALUES[promotion] ?? 1) - 1 : 0);
    moves.push({
      san: mv.san,
      color: mv.color,
      label: moveLabel(i, start, mv.san),
      from: mv.from,
      to: mv.to,
      captured,
      enPassant: Boolean(captured && mv.flags.includes('e')),
      promotion,
      points,
    });
    fens.push(game.fen());
  }
  return { startFen: start, moves, fens };
}

// The count at move `at` of the line (0: the start, nothing played yet):
//   white / black — points each side has won; balance = white - black;
//   took — the pieces each side took, in the order taken; promoted — the
//   pieces each side promoted to; events — how many captures and promotions
//   so far;
//   status — { kind: 'none' } before any capture or promotion,
//            { kind: 'mate' } when the position is checkmate,
//            { kind: 'open', side, square } while the side to move can still
//              take on the square of the last capture,
//            { kind: 'done' } once it can't.
export function calcCount(line, at = line?.moves?.length ?? 0) {
  const n = Math.max(0, Math.min(at, line?.moves?.length ?? 0));
  const pts = { w: 0, b: 0 };
  const took = { w: [], b: [] };
  const promoted = { w: [], b: [] };
  let last = null;
  let events = 0;
  for (const m of (line?.moves ?? []).slice(0, n)) {
    pts[m.color] += m.points;
    if (m.captured) took[m.color].push(m.captured);
    if (m.promotion) promoted[m.color].push(m.promotion);
    if (m.captured || m.promotion) { last = m; events += 1; }
  }
  const fen = line?.fens?.[n] ?? null;
  let status = { kind: 'none' };
  let game = null;
  try { game = fen ? new Chess(fen) : null; } catch { game = null; }
  if (game?.isCheckmate()) status = { kind: 'mate' };
  else if (last && game) {
    const side = game.turn();
    const retake = game.moves({ verbose: true }).some((mv) => mv.to === last.to && mv.captured);
    status = retake ? { kind: 'open', side, square: last.to } : { kind: 'done' };
  }
  return {
    at: n,
    fen,
    turn: game?.turn() ?? null,
    white: pts.w,
    black: pts.b,
    balance: pts.w - pts.b,
    took,
    promoted,
    events,
    status,
  };
}

// ---------- Words (the same in Chess Arcade) ----------

// Every piece name here takes "a": a pawn, a knight, a bishop, a rook, a queen.
const named = (piece) => `a ${PIECE_NAME[piece]}`;

// 'white' / 'w' → 'w', anything else null: whose side "(you)" goes after.
const sideKey = (you) => (you === 'white' || you === 'w' ? 'w' : you === 'black' || you === 'b' ? 'b' : null);
const sideWithYou = (color, you) => `${SIDE_NAME[color]}${sideKey(you) === color ? ' (you)' : ''}`;

// What a move did, beside it in the list: "takes a pawn" (en passant too),
// "promotes to a queen", "takes a rook, promotes to a queen" — or '' for a
// move that neither took nor promoted.
export function moveWhat(m) {
  if (!m) return '';
  return [
    m.captured ? `takes ${named(m.captured)}` : '',
    m.promotion ? `promotes to ${named(m.promotion)}` : '',
  ].filter(Boolean).join(', ');
}

// Its points: "+1", "+13", or '' for none.
export const movePoints = (m) => (m?.points ? `+${m.points}` : '');

// "Start: after 14...Nd7, White to move" / "Start: this position, White to move".
// `lastLabel` is the move that reached the start ("14...Nd7"), or null.
export function startText(lastLabel, turn) {
  const side = SIDE_NAME[turn === 'b' ? 'b' : 'w'];
  return `Start: ${lastLabel ? `after ${lastLabel}` : 'this position'}, ${side} to move`;
}

// The balance: "White +2", "Black +3", "Even" — with "(you)" after the colour
// when the board knows which side is yours ('white' / 'black', or 'w' / 'b').
export function balanceText(balance, you = null) {
  if (!balance) return 'Even';
  return `${sideWithYou(balance > 0 ? 'w' : 'b', you)} +${Math.abs(balance)}`;
}

// What changed hands, in the order taken: "White took: bishop, pawn (4)",
// "Black (you) took: nothing". Null before any capture or promotion.
export function tookText(color, count, you = null) {
  if (!count?.events) return null;
  const list = count.took[color];
  const side = sideWithYou(color, you);
  if (!list.length) return `${side} took: nothing`;
  const sum = list.reduce((s, p) => s + (CALC_VALUES[p] ?? 0), 0);
  return `${side} took: ${list.map((p) => PIECE_NAME[p]).join(', ')} (${sum})`;
}

// A promotion: "White promoted: queen (+8)"; null when that side didn't.
export function promotedText(color, count, you = null) {
  const list = count?.promoted?.[color] ?? [];
  if (!list.length) return null;
  const sum = list.reduce((s, p) => s + (CALC_VALUES[p] ?? 1) - 1, 0);
  return `${sideWithYou(color, you)} promoted: ${list.map((p) => PIECE_NAME[p]).join(', ')} (+${sum})`;
}

// The status line: "No captures yet.", "Checkmate. The count doesn’t matter
// now.", "Not finished: Black can take back on e5.", "Trades finished."
export function statusText(count) {
  const s = count.status;
  if (s.kind === 'mate') return 'Checkmate. The count doesn’t matter now.';
  if (s.kind === 'open') return `Not finished: ${SIDE_NAME[s.side]} can take back on ${s.square}.`;
  if (s.kind === 'done') return 'Trades finished.';
  return 'No captures yet.';
}

// Who came out ahead, once the trades are finished: "White comes out ahead by
// 2.", "Black comes out ahead by 3.", "It’s an even trade." Null otherwise.
// Never "(you)" here.
export function verdictText(count) {
  if (count.status.kind !== 'done') return null;
  if (!count.balance) return 'It’s an even trade.';
  return `${SIDE_NAME[count.balance > 0 ? 'w' : 'b']} comes out ahead by ${Math.abs(count.balance)}.`;
}

// ---------- The engine's view of it ----------
// The count says who has more; the engine says who stands better — and they
// can disagree, which is the lesson: up two pawns and losing. A score is the
// engine's own, from White's side (lib/engine): { type: 'cp', value } in
// hundredths of a pawn, or { type: 'mate', value } in moves (negative: Black
// mates).

// Under this many hundredths either way, nobody is better.
const EVAL_EVEN = 30;

// Whose position is better: 'w', 'b', or null (about even, or no score yet).
export function evalSide(score) {
  if (!score) return null;
  if (score.type === 'mate') return score.value < 0 ? 'b' : 'w';
  if (Math.abs(score.value) < EVAL_EVEN) return null;
  return score.value > 0 ? 'w' : 'b';
}

// The number: "+1.4", "−0.6", "0.0", "M3".
export function evalNumber(score) {
  if (!score) return '';
  if (score.type === 'mate') return `M${Math.abs(score.value)}`;
  const pawns = (Math.abs(score.value) / 100).toFixed(1);
  if (pawns === '0.0') return '0.0';
  return `${score.value > 0 ? '+' : '−'}${pawns}`;
}

// In words: "About even", "White is a little better", "Black (you) is
// better", "White is winning", "Black mates in 3", "White has checkmated".
export function evalText(score, you = null) {
  if (!score) return '';
  const side = evalSide(score);
  if (!side) return 'About even';
  const who = sideWithYou(side, you);
  if (score.type === 'mate') {
    const n = Math.abs(score.value);
    return n <= 1 && score.over ? `${who} has checkmated` : `${who} mates in ${n}`;
  }
  const by = Math.abs(score.value);
  if (by < 100) return `${who} is a little better`;
  if (by < 300) return `${who} is better`;
  return `${who} is winning`;
}

// White's share of a two-sided bar, 0–100 (50: even) — the curve the board's
// own eval bar uses, so the two read alike.
export function evalShare(score) {
  if (!score) return 50;
  const cp = score.type === 'mate' ? (score.value < 0 ? -1500 : 1500) : score.value;
  return Math.max(3, Math.min(97, 50 + 50 * (2 / (1 + Math.exp(-cp / 320)) - 1)));
}

// Where the count and the engine part ways, in a sentence; null when they
// agree (or there's no score). "White is up 2 in material, but Black has the
// better position.", "White is up 3 in material, but the position is about
// even.", "The count is even, but Black has the better position."
export function evalVersusCount(balance, score, you = null) {
  if (!score) return null;
  const better = evalSide(score);
  const ahead = balance > 0 ? 'w' : balance < 0 ? 'b' : null;
  if (better === ahead) return null;
  if (!ahead) return `The count is even, but ${sideWithYou(better, you)} has the better position.`;
  const up = `${sideWithYou(ahead, you)} is up ${Math.abs(balance)} in material`;
  if (!better) return `${up}, but the position is about even.`;
  return `${up}, but ${sideWithYou(better, you)} has the better position.`;
}

// ---------- The calculator's own state ----------
// { anchorId, anchorFen, baseFen, startLabel, sans, at, marks }: the board's
// move it was turned on at (the board stays there), that position, the moves
// played since and how far along them the board is, and anything drawn on
// those positions (scratch, like the moves).

export function calcStart({
  anchorId = 'root', anchorFen, baseFen = null, startLabel = null, marks = {},
} = {}) {
  return {
    anchorId, anchorFen, baseFen, startLabel, sans: [], at: 0, marks,
  };
}

// A move played on the board: the next move of the sequence if it's the same
// one (it's followed), otherwise it replaces the rest.
export function calcPlay(calc, san) {
  if (!calc || !san) return calc;
  if (calc.sans[calc.at] === san) return { ...calc, at: calc.at + 1 };
  return { ...calc, sans: [...calc.sans.slice(0, calc.at), san], at: calc.at + 1 };
}

// Step to a point of the sequence (0: the start); the moves after it stay.
export function calcStep(calc, at) {
  if (!calc) return calc;
  const n = Math.max(0, Math.min(calc.sans.length, Number(at) || 0));
  return n === calc.at ? calc : { ...calc, at: n };
}

// How far the calculator's moves follow the board's tree from where it
// started: { nodes, all, end } — the tree's node for each move as long as the
// tree has it, whether every move is already there (then there's nothing new
// to keep), and the tree's node at the end of them (null once they leave it),
// whose next move → plays into the sequence, as stepping along the game does.
export function calcFollow(tree, anchorId, sans = []) {
  let node = findNode(tree, anchorId);
  const nodes = [];
  for (const san of sans) {
    node = node?.children?.find((c) => c.san === san) ?? null;
    if (!node) break;
    nodes.push(node);
  }
  return { nodes, all: Boolean(node) && nodes.length === sans.length, end: nodes.length === sans.length ? node : null };
}

// "Keep as a side line": the moves into the board's tree from the move it was
// turned on at — a move already there (the game's own, a line kept before) is
// followed, never doubled. { tree, ids } with ids[i] the node of move i.
export function calcKeep(tree, anchorId, sans = []) {
  let next = tree;
  let at = anchorId;
  const ids = [];
  for (const san of sans) {
    const r = addMove(next, at, san);
    next = r.tree;
    at = r.nodeId;
    ids.push(at);
  }
  return { tree: next, ids };
}

// ---------- What's drawn while it's on ----------
// Arrows and squares are kept by position (FEN), as the board keeps its own
// (`annotations`). While the calculator is on they're its own scratch copy:
// what the board already had on a position shows (the copy starts from it),
// a change goes into the copy only, and "Keep as a side line"
// (calcKeepMarks) is the one way any of it reaches the board.

const NO_MARKS = { arrows: [], squares: {} };
const hasAny = (m) => Boolean(m?.arrows?.length || Object.keys(m?.squares ?? {}).length);

// What's drawn on a position while it's on: the calculator's copy once it has
// one there, else the board's own drawing there.
export function calcMarksAt(calc, fen, annotations = {}) {
  return calc?.marks?.[fen] ?? annotations?.[fen] ?? NO_MARKS;
}

// A drawing made while it's on: `fn` (marks to marks) on its copy of that
// position — started from the board's own, so keeping the line adds to your
// drawings instead of replacing them.
export function calcDraw(calc, fen, annotations, fn) {
  if (!calc) return calc;
  return { ...calc, marks: { ...calc.marks, [fen]: fn(calcMarksAt(calc, fen, annotations)) } };
}

// Where a drawing on the analysis board goes, the calculator FIRST: 'calc'
// while it's on, wherever the board's own move is — never a saved game's
// Game Review then, so nothing drawn in the calculator reaches the review or
// (on a student's own game, where the review is sent on) the student. Else
// 'review' at a move the game's Game Review holds (`reviewRef` not null),
// else 'board' (the board's own drawings).
export function drawTarget(calc, reviewRef = null) {
  if (calc) return 'calc';
  return reviewRef != null ? 'review' : 'board';
}

// The analysis board's drawings at the position it shows, and where a change
// to them goes: { to, marks, editable, reviewRef }. `marks` is drawn on the
// board (with the review's own on top, by the board); `editable` is the set a
// change starts from (the drag preview's next colour, Clear, the click that
// clears) — on a saved game's move the board's own and the review's drawn
// ones together (`join` = reviewOnBoard's marksWith), in the calculator its
// copy only. `reviewRef` is null unless a change goes to the review.
export function drawingsHere({
  calc = null, fen, annotations = {}, reviewRef = null, reviewDrawn = null, join = null,
} = {}) {
  const to = drawTarget(calc, reviewRef);
  if (to === 'calc') {
    const marks = calcMarksAt(calc, fen, annotations);
    return {
      to, marks, editable: marks, reviewRef: null,
    };
  }
  const marks = annotations?.[fen] ?? NO_MARKS;
  if (to === 'review') {
    return {
      to, marks, editable: join && reviewDrawn ? join(marks, reviewDrawn) : marks, reviewRef,
    };
  }
  return {
    to, marks, editable: marks, reviewRef: null,
  };
}

// "Keep as a side line": its drawings added to the board's own, for the
// positions of the line kept (`fens`, its start and every move). Added, never
// taken away: an arrow or square the board had there stays even if it went in
// the calculator (a click on the board to move a piece clears what's drawn,
// and that was scratch too); one drawn in both keeps the calculator's colour.
// What was drawn on moves since replaced (no longer in `fens`) goes with them.
export function calcKeepMarks(annotations = {}, calc = null, fens = []) {
  const out = { ...annotations };
  const on = new Set(fens);
  for (const [f, m] of Object.entries(calc?.marks ?? {})) {
    if (!on.has(f) || !hasAny(m)) continue;
    const was = out[f];
    if (!hasAny(was)) { out[f] = m; continue; }
    const arrows = [...m.arrows];
    for (const a of was.arrows ?? []) if (!arrows.some((b) => b[0] === a[0] && b[1] === a[1])) arrows.push(a);
    out[f] = { ...was, arrows, squares: { ...(was.squares ?? {}), ...(m.squares ?? {}) } };
  }
  return out;
}

// The board's tree node for the position the calculator shows at `at`: the
// move it was turned on at while at the start, then the tree's own move as
// long as its moves are the tree's (the game's moves, followed with ->), else
// null (a position only the calculator has). What the game's Game Review drew
// there is shown on it, as it would be on the game's own move.
export function calcNodeAt(tree, calc, at = calc?.at ?? 0) {
  if (!calc) return null;
  if (!at) return calc.anchorId;
  const { nodes } = calcFollow(tree, calc.anchorId, calc.sans.slice(0, at));
  return nodes.length === at ? nodes[at - 1].id : null;
}

// A change to what's drawn (`fn`: marks to marks), sent where drawingsHere
// said (`here`): the calculator's copy (setCalc), the game's Game Review
// (writeReviewMarks(ref, next)) or the board's own (setAnnotations) —
// React's setters, given updaters. The analysis board's one way to change a
// drawing, so the order (the calculator first) is the same for an arrow, a
// square, Clear and the click that clears. Returns where it went.
export function applyDrawing(here, {
  fen, annotations = {}, fn, setCalc, writeReviewMarks, setAnnotations,
}) {
  if (here.to === 'calc') {
    setCalc((c) => calcDraw(c, fen, annotations, fn));
    return 'calc';
  }
  if (here.to === 'review') {
    writeReviewMarks(here.reviewRef, fn(here.editable));
    return 'review';
  }
  setAnnotations((all) => ({ ...all, [fen]: fn(all?.[fen] ?? NO_MARKS) }));
  return 'board';
}
