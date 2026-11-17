// Court Cards' suit-engraved square highlights, from Chess Arcade (2026-11-16).
//
// Only Court Cards shows them, and only Court Cards works them out: a view
// asks for a pick's marks (suitPick) when that theme is on, so every other
// theme draws, and does, exactly what it did before.
//
// · The picked square: a thin gilt card frame, and the suit its piece wears
//   pressed faintly into the card under the piece. PICKED_STYLE is unchanged:
//   the square's own style names the suit (--shl-em) and the stylesheet
//   paints it (styles.css, inside @cards:board).
// · A quiet move: a small pip of that suit, drawn by LegalDots (above the
//   arrows, where its dots are).
// · A capture, en passant too: the pip in two corners, top left and bottom
//   right (that one upside down), the way a card prints its indices. The
//   capture square's own style names them (--shl-c, --shl-d) and the
//   stylesheet paints them on the square, under the piece, so the piece is
//   never covered (this board's pieces fill their squares: an overlay's
//   corners would sit on a queen's crown).
//
// The marks ride on the squares' own styles (Board adds them), not on the
// element round the board: a pick restyles only the squares it marks. Named
// on the board's holder instead, every pick and put-down made the browser
// restyle most of the board.
//
// The suits are the Court Cards set's own: White's king and queen hearts,
// rook and knight diamonds; Black's spades and clubs; both bishops the Joker's
// star; pawns their army's suit (the spot cards: hearts, spades). Chess Arcade
// also lets the suit fade in and the gilt glow once; here they're still.

export const SUIT_OF = {
  wK: 'heart', wQ: 'heart', wP: 'heart', wR: 'diamond', wN: 'diamond', wB: 'star',
  bK: 'spade', bQ: 'spade', bP: 'spade', bR: 'club', bN: 'club', bB: 'star',
};

export const suitOf = (code) => SUIT_OF[code] ?? null;

// The piece on `square` as its code ('wQ'), or null for an empty square, no
// game, or no square at all.
export function pieceCode(game, square) {
  if (!game || !square) return null;
  let piece = null;
  try { piece = game.get(square); } catch { return null; }
  if (!piece) return null;
  const code = piece.color + piece.type.toUpperCase();
  return SUIT_OF[code] ? code : null;
}

// Where the piece on `square` captures: every legal destination with a piece
// to take, and the en passant square (chess.js marks it captured too).
export function captureSquares(game, square) {
  if (!game || !square) return [];
  let moves = [];
  try { moves = game.moves({ square, verbose: true }); } catch { return []; }
  return [...new Set(moves.filter((mv) => mv.captured).map((mv) => mv.to))];
}

// A pick, for Court Cards' marks: the piece's code, its square and, when its
// legal moves are shown, the squares it captures on. null when nothing (or
// nothing that wears a suit) is picked.
export function suitPick(game, square, { captures = true } = {}) {
  const code = pieceCode(game, square);
  if (!code) return null;
  return { code, square, caps: captures ? captureSquares(game, square) : [] };
}

// A dark square (a card back on this board): a1, c1, b2 ...
export const isDarkSquare = (sq) => (sq.charCodeAt(0) - 97 + Number(sq[1])) % 2 === 1;

// Whether react-chessboard prints one of its coordinates on `sq`: a number
// (top left) down the file on the left-hand edge, a letter (bottom right)
// along the rank at the bottom — a and 1 for White, h and 8 on a flipped
// board.
export function hasCoordinate(sq, orientation = 'white') {
  return orientation === 'black'
    ? sq[0] === 'h' || sq[1] === '8'
    : sq[0] === 'a' || sq[1] === '1';
}

// What a pick adds to the squares' own styles, as custom properties the
// stylesheet reads in Court Cards (styles.css):
// · the picked square: --shl-em, its suit pressed into a card face or back;
// · each capture square: --shl-c and --shl-d, the top left pip and the
//   upside-down bottom right one. A square that carries a coordinate takes
//   them on the other diagonal (--shl-alt), top right and bottom left, clear
//   of the number or letter; when the coach's badge sits in its top right
//   corner too, that pip is left out and the bottom left one stays.
// `badge` is the square with a badge on it (the last move's), if any.
export function suitSquareStyles(pick, { orientation = 'white', notation = true, badge = null } = {}) {
  const suit = suitOf(pick?.code);
  if (!suit) return {};
  const side = pick.code[0];
  const out = { [pick.square]: { '--shl-em': `var(--shl-e${isDarkSquare(pick.square) ? 'b' : 'f'}-${suit})` } };
  const pip = suit === 'star' ? `star${side}` : suit;
  for (const sq of pick.caps ?? []) {
    const style = { '--shl-c': `var(--shl-c-${pip})`, '--shl-d': `var(--shl-d-${pip})` };
    if (notation && hasCoordinate(sq, orientation)) {
      style['--shl-alt'] = '1';
      if (sq === badge) style['--shl-c'] = 'none';
    }
    out[sq] = style;
  }
  return out;
}

// The deck's pips, in a 20-unit box (Chess Arcade's art.py PIP), and how far
// each reaches from the box's center.
export const PIP = {
  heart: 'M10 17.6C6.2 14.6 1.6 11.2 1.6 6.9 1.6 4.2 3.6 2.3 6 2.3c1.8 0 3.2 1 4 2.6.8-1.6 2.2-2.6 4-2.6 2.4 0 4.4 1.9 4.4 4.6 0 4.3-4.6 7.7-8.4 10.7z',
  diamond: 'M10 1.4C11.9 4.6 14.3 7.6 17.2 10 14.3 12.4 11.9 15.4 10 18.6 8.1 15.4 5.7 12.4 2.8 10 5.7 7.6 8.1 4.6 10 1.4z',
  spade: 'M10 1.6C8.2 4.6 2 7.7 2 11.8c0 2.3 1.8 3.9 3.9 3.9 1.4 0 2.6-.7 3.3-1.8-.2 1.9-1 3.4-2.7 4.5h7c-1.7-1.1-2.5-2.6-2.7-4.5.7 1.1 1.9 1.8 3.3 1.8 2.1 0 3.9-1.6 3.9-3.9C18 7.7 11.8 4.6 10 1.6z',
  club: 'M10 1.9a3.7 3.7 0 0 0-2.6 6.3A3.7 3.7 0 1 0 9.1 14c-.2 1.9-1 3.3-2.6 4.4h7c-1.6-1.1-2.4-2.5-2.6-4.4a3.7 3.7 0 1 0 1.7-5.8A3.7 3.7 0 0 0 10 1.9z',
  star: 'M10 .4C10.7 6.6 12.3 8.9 19.6 10 12.3 11.1 10.7 13.4 10 19.6 9.3 13.4 7.7 11.1 .4 10 7.7 8.9 9.3 6.6 10 .4z',
};

const round = (v) => Math.round(v * 10000) / 10000;

// The quiet move's pip, as Chess Arcade draws it: the suit in its ink over an
// ivory halo (a round-joined stroke under the fill; the Joker's star inked
// heavier, with an outline of its own ink, or its thin points read as a
// glint), centered on the square at 34% of it, from 11 to 30 px. The box is
// the 20-unit pip plus its halo, so the pip itself is a little smaller.
// Returns what LegalDots draws: the path, the transform that places it, and
// the halo's width in the pip's own units.
export function quietPip(suit, size, cx, cy) {
  const d = PIP[suit];
  if (!d) return null;
  const star = suit === 'star';
  const fat = star ? 1.7 : 0;
  const halo = star ? 2.6 : 2.4;
  const pad = halo + fat / 2 + 0.2;
  const box = Math.min(30, Math.max(11, 0.34 * size));
  const k = box / (20 + 2 * pad);
  return {
    d,
    star,
    halo: round(halo * 2 + fat),
    transform: `translate(${round(cx - box / 2 + pad * k)} ${round(cy - box / 2 + pad * k)}) scale(${round(k)})`,
  };
}
