// Material captured, chess.com style — computed straight from the current
// position rather than by replaying capture moves, so it's correct for any
// FEN (an endgame study, not just a game that started from the standard
// array). A promoted pawn reads as a "captured" pawn the same way it does
// on chess.com: this counts what's missing from a full starting set, not
// literal capture history.
import { Chess } from 'chess.js';

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1 };
// Highest value first, the way chess.com orders the captured-piece icons.
const ICON_ORDER = ['q', 'r', 'b', 'n', 'p'];

// `chess` is a chess.js Chess instance (or a FEN string).
export function materialDiff(chess) {
  const game = typeof chess === 'string' ? new Chess(chess) : chess;
  const counts = { w: {}, b: {} };
  for (const row of game.board()) {
    for (const sq of row) {
      if (!sq) continue;
      counts[sq.color][sq.type] = (counts[sq.color][sq.type] ?? 0) + 1;
    }
  }
  const missing = (side) => {
    const out = [];
    for (const type of ICON_ORDER) {
      const have = counts[side][type] ?? 0;
      const short = Math.max(0, (START_COUNTS[type] ?? 0) - have);
      for (let i = 0; i < short; i += 1) out.push(type);
    }
    return out;
  };
  const capturedByWhite = missing('b'); // black pieces missing from the board
  const capturedByBlack = missing('w'); // white pieces missing from the board
  const points = (arr) => arr.reduce((sum, t) => sum + (VALUES[t] ?? 0), 0);
  return {
    capturedByWhite,
    capturedByBlack,
    diff: points(capturedByWhite) - points(capturedByBlack), // positive = white's ahead
  };
}
