// Picking a piece up — the rules, apart from the boards that follow them
// (components/Board.jsx, views/PracticeView.jsx, views/AnalysisView.jsx) so
// they can be tested: tests/grab.test.mjs.
//
// A grab used to fail in four ways, each of which felt like the board not
// listening:
//   · a finger that rested on a piece a third of a second before moving was
//     taken for a hold to draw (useHoldToDraw) — an arrow, and the piece
//     stayed where it was;
//   · in Learn and Practice no piece could be lifted between your move and
//     the reply to it (up to 1.6s at the slow pace);
//   · a piece let go while the reply was still sliding was thrown away by
//     the board library, and went back;
//   · nor could one be lifted during the red flash after a wrong move.

const FILES = 'abcdefgh';
const isSquare = (sq) => typeof sq === 'string' && /^[a-h][1-8]$/.test(sq);

// The piece on a square of the position a board shows — 'wP', 'bN', … — or
// null. `position`: a FEN, 'start', or react-chessboard's own object
// ({ e2: 'wP', … }).
export function pieceAt(position, square) {
  if (!isSquare(square)) return null;
  if (position && typeof position === 'object') {
    const p = position[square];
    return typeof p === 'string' && /^[wb][PNBRQK]$/.test(p) ? p : null;
  }
  if (typeof position !== 'string') return null;
  const placement = position === 'start'
    ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'
    : position.trim().split(/\s+/)[0];
  const rows = placement.split('/');
  if (rows.length !== 8) return null;
  const row = rows[8 - Number(square[1])];
  const want = FILES.indexOf(square[0]);
  let file = 0;
  for (const ch of row) {
    if (ch >= '1' && ch <= '8') {
      file += Number(ch);
      if (file > want) return null;
    } else {
      if (file === want) {
        return /^[pnbrqkPNBRQK]$/.test(ch) ? `${ch === ch.toUpperCase() ? 'w' : 'b'}${ch.toUpperCase()}` : null;
      }
      file += 1;
    }
  }
  return null;
}

// Whose move it is in a FEN ('start' is White's): 'w', 'b' or null.
export function sideToMove(position) {
  if (position === 'start') return 'w';
  if (typeof position !== 'string') return null;
  const turn = position.trim().split(/\s+/)[1];
  return turn === 'w' || turn === 'b' ? turn : null;
}

// Whether a press on a square would lift a piece: there's one there, the
// board lets pieces be dragged, and lets that one — react-chessboard's
// arePiecesDraggable and isDraggablePiece, as the board was given them. A
// finger on such a square is picking the piece up, however long it rests:
// never the start of a hold to draw.
export function liftable(square, { position, draggable = true, isDraggablePiece } = {}) {
  if (draggable === false) return false;
  const piece = pieceAt(position, square);
  if (!piece) return false;
  if (typeof isDraggablePiece !== 'function') return true;
  try {
    return Boolean(isDraggablePiece({ piece, sourceSquare: square }));
  } catch {
    return false;
  }
}

// On the analysis board every piece can be dragged, but only the side to
// move's can go anywhere: those are the ones a finger picks up when holding a
// piece to draw is switched off (Settings → Analysis).
export function movable(position, square) {
  const piece = pieceAt(position, square);
  return Boolean(piece) && piece[0] === sideToMove(position);
}

// The pieces you may lift in Learn and Practice: your own side's.
export const ownPiece = (piece, userIsWhite) => typeof piece === 'string' && (piece[0] === 'w') === Boolean(userIsWhite);

// The square of the piece a move takes — where the move lands, or for en
// passant the pawn beside it — or null. `move`: chess.js's own report of one.
// In Learn and Practice the reply that's on its way may be about to take a
// piece of yours: that one isn't lifted ahead of it (it would be taken out of
// your hand).
export function takenSquare(move) {
  if (!move?.captured || !isSquare(move.from) || !isSquare(move.to)) return null;
  return typeof move.flags === 'string' && move.flags.includes('e') ? `${move.to[0]}${move.from[1]}` : move.to;
}

// A pawn arriving on the last rank, as react-chessboard asks when a board
// gives it no question of its own — its promotion dialog then takes the drop.
export const defaultPromotionCheck = (from, to, piece) => (
  (piece === 'wP' && from[1] === '7' && to[1] === '8') || (piece === 'bP' && from[1] === '2' && to[1] === '1')
) && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) <= 1;

// Which square a drop is for, when the board library asks about one.
//
// The library goes by what's under the pointer, and a piece that's sliding
// still belongs to the square it left until it lands. So a recapture let go
// under the capturer as it arrives was asked about as a move to the square
// the capturer came from — a wrong move, counted — and with the touch
// backend then asked about again for the right one.
//
// `asked`: the square the library names. `released`: the square of the board
// under the pointer where the piece was let go, when that was seen — then
// that's the drop, whatever was asked (null: seen, but not over the board —
// the library's word stands). Not seen (undefined: the drag was ended some
// other way, by another finger coming up): `over`, the square the carrying
// pointer was last known to be on, says which of the library's questions is
// the real one — it never stands in for one. Returns the square to play to,
// or null: not a drop, the answer is no.
export function dropSquare({
  from, asked, released, over,
} = {}) {
  let to = asked;
  if (isSquare(released)) to = released;
  else if (released === undefined && over !== undefined && over !== asked) return null;
  return isSquare(to) && to !== from ? to : null;
}

// A piece let go over a square while the board was mid-slide: react-chessboard
// returns from its drop handler before asking anyone, and the piece goes
// back. The drag is over and the board was never asked (`asked` false): the
// move to ask it about after all — or null when there's nothing to rescue
// (asked already; let go where it was picked up, or off the board; a drop the
// board's own promotion dialog or premoves are taking).
//
// `released`: the piece was let go — a finger or a mouse button coming up, a
// native drag's drop. A drag that just stopped (Escape; a touch the system
// took back) was called off, and puts the piece back wherever the pointer
// happened to be: nothing is rescued unless the caller saw the letting go.
export function lateDrop({
  from, to, piece, asked = false, released = false, promotes = defaultPromotionCheck, premoves = false,
} = {}) {
  if (asked || premoves || !released) return null;
  if (!isSquare(from) || !isSquare(to) || !piece || from === to) return null;
  let promo = false;
  try { promo = Boolean(promotes(from, to, piece)); } catch { promo = false; }
  return promo ? null : { from, to, piece };
}
