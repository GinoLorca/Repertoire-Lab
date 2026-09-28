import { Chess } from 'chess.js';

// Where a line starts.
//
// Most lines start from the normal starting position. Some don't: a course's
// "Typical Ideas" chapter sets up a middlegame position ([SetUp "1"] [FEN …])
// and plays on from there, perhaps with Black to move at move 12. Such a line
// carries `startFen`; a line without one starts from the beginning.
//
// A line's moves, comments and badges are still indexed from 0 — the first
// move played from its start, whoever makes it — and -1 is the starting
// position's own comment. What changes is how a move is numbered ("12…" for
// Black's first move there) and whose move it is, which come from the FEN:
// never from counting moves from 0.

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Placement, side to move, castling and en passant — a position, without the
// move counters.
export const fen4 = (fen) => String(fen ?? '').trim().split(/\s+/).slice(0, 4).join(' ');

// The FEN as chess.js writes it (four-field FENs padded, an en passant square
// that can't be used dropped), or null if it isn't a legal position.
export function normalizeFen(fen) {
  if (!fen || !String(fen).trim()) return null;
  try {
    return new Chess(String(fen).trim()).fen();
  } catch {
    return null;
  }
}

export const isStandardStart = (fen) => !fen || fen4(normalizeFen(fen) ?? fen) === fen4(START_FEN);

// What a line stores: the normalised FEN of a set-up start, or null for the
// normal one — so "no startFen" always means the beginning, and two lines
// from the same position compare equal.
export function canonicalStartFen(fen) {
  const n = normalizeFen(fen);
  return n && fen4(n) !== fen4(START_FEN) ? n : null;
}

export const startFenOf = (variation) => variation?.startFen || START_FEN;

// Two lines start from the same position.
export const sameStart = (a, b) => fen4(normalizeFen(startFenOf(a)) ?? startFenOf(a))
  === fen4(normalizeFen(startFenOf(b)) ?? startFenOf(b));

// A board at a line's start. Never throws: a FEN that won't load (a line
// copied from a newer build, a typo) gives the normal starting position.
export function newGameAt(fen) {
  try {
    return new Chess(fen || START_FEN);
  } catch {
    return new Chess();
  }
}

// The moves of a line played from its start, stopping at the first one that
// can't be played there rather than throwing: { game, played } where `played`
// are chess.js move objects.
export function replay(moves, fen) {
  const game = newGameAt(fen);
  const played = [];
  for (const san of moves ?? []) {
    let mv = null;
    try { mv = game.move(san); } catch { mv = null; }
    if (!mv) break;
    played.push(mv);
  }
  return { game, played };
}

// The half-move of the game a line's first move is: 0 for White's first move
// of a game, 23 for Black's 12th.
export function plyOffset(fen) {
  const parts = String(fen || START_FEN).trim().split(/\s+/);
  const full = Math.max(1, parseInt(parts[5], 10) || 1);
  return (full - 1) * 2 + (parts[1] === 'b' ? 1 : 0);
}

// Whether a line's move `i` (0-based from its start) is White's.
export const isWhiteMove = (i, fen) => (plyOffset(fen) + i) % 2 === 0;

// Its move number: 12 for Black's 12th.
export const moveNumberOf = (i, fen) => Math.floor((plyOffset(fen) + i) / 2) + 1;

// "12." for a White move, "12..." (or `blackMark`) for a Black one.
export const moveNumberLabel = (i, fen, blackMark = '...') => (isWhiteMove(i, fen)
  ? `${moveNumberOf(i, fen)}.`
  : `${moveNumberOf(i, fen)}${blackMark}`);

// A line's side to move at its start: 'w' or 'b'.
export const sideToMove = (fen) => (String(fen || START_FEN).trim().split(/\s+/)[1] === 'b' ? 'b' : 'w');
