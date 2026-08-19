// Square name -> board coordinates in "cells from the top-left", honouring
// which way the board is facing. Shared by the arrow and dot overlays.
export function squareCell(square, orientation) {
  const file = square.charCodeAt(0) - 97; // a..h -> 0..7
  const rank = Number(square[1]) - 1; // 1..8 -> 0..7
  return orientation === 'black'
    ? { x: 7 - file, y: rank }
    : { x: file, y: 7 - rank };
}

// The square of the king that's in check, if any — so every board in the app
// can mark it the same way.
export function checkedKingSquare(game) {
  if (!game) return null;
  try {
    if (!game.inCheck()) return null;
    const turn = game.turn();
    for (const row of game.board()) {
      for (const piece of row) {
        if (piece && piece.type === 'k' && piece.color === turn) return piece.square;
      }
    }
  } catch { /* an empty or invalid position simply has no check */ }
  return null;
}

// The pale yellow chess.com leaves on the square a piece came from and the one
// it landed on. Light enough to read the piece through it on either colour.
//
// backgroundColor, not the background shorthand: a badge's own highlight at
// this same square (the move's destination, almost always) adds
// backgroundImage/backgroundPosition/backgroundSize longhands on top of this.
// The background shorthand implicitly resets every one of those sub-properties
// even when it's declared first and they come after — so this square would
// render the plain yellow wash with the badge's glyph silently erased. A
// longhand can't do that; only the specific property it names is ever touched.
export const LAST_MOVE_STYLE = { backgroundColor: 'rgba(245, 205, 78, 0.42)' };

// The from/to of the move that produced the position at `ply` in a line of SAN
// moves, for boards that want to mark it. `ply` counts moves played.
export function lastMoveOf(Chess, moves, ply, startFen) {
  if (!moves?.length || !ply) return null;
  try {
    const board = startFen ? new Chess(startFen) : new Chess();
    for (let i = 0; i < ply - 1; i += 1) board.move(moves[i]);
    const mv = board.move(moves[ply - 1]);
    return mv ? { from: mv.from, to: mv.to } : null;
  } catch {
    return null;
  }
}

// A red glow under the king in check, in the style chess.com uses.
export const CHECK_STYLE = {
  background: 'radial-gradient(circle at center, rgba(226, 74, 74, 0.95) 12%, rgba(226, 74, 74, 0.55) 46%, transparent 72%)',
};

// Square styles marking every legal destination for the piece on `square` —
// a dot on empty squares, a ring on ones holding something to capture.
export function legalMoveStyles(game, square) {
  if (!game || !square) return {};
  let moves = [];
  try { moves = game.moves({ square, verbose: true }); } catch { return {}; }
  const styles = {};
  for (const mv of moves) {
    const capture = !!mv.captured;
    styles[mv.to] = capture
      ? {
        background: 'radial-gradient(circle, transparent 56%, rgba(20,23,29,0.28) 57%)',
        borderRadius: '50%',
      }
      : {
        background: 'radial-gradient(circle, rgba(20,23,29,0.28) 22%, transparent 23%)',
      };
  }
  return styles;
}
