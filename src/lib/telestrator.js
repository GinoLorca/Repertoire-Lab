// Reading a finger's stroke on the board the way a broadcast telestrator
// would, but for chess: a clean line from one square to another is an arrow,
// a small loop around one square (or a tap on it) marks that square, and
// anything else stays as the ink it was drawn as — a ring round a group of
// pieces, a squiggle under a pawn chain.
//
// Points are in square units from the board's top-left corner as it's shown
// (0–8 across and down), so the same rules hold at any board size; the
// orientation turns a point into the square printed under it.

const FILES = 'abcdefgh';

export function squareAt(x, y, orientation = 'white') {
  const col = Math.floor(x);
  const row = Math.floor(y);
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return orientation === 'white'
    ? `${FILES[col]}${8 - row}`
    : `${FILES[7 - col]}${row + 1}`;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i += 1) len += dist(points[i - 1], points[i]);
  return len;
}

const isKnightHop = (from, to) => {
  const dx = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
  const dy = Math.abs(Number(from[1]) - Number(to[1]));
  return (dx === 1 && dy === 2) || (dx === 2 && dy === 1);
};

// How far a stroke may wander from a straight line and still read as an
// arrow: its length over the straight distance between its ends. A knight's
// L — two squares then one — runs about 1.34 of its straight distance.
const STRAIGHT = 1.25;
const KNIGHT_BEND = 1.7;

// { type: 'arrow', from, to } | { type: 'square', square } | { type: 'ink' }
export function classifyStroke(points, orientation = 'white') {
  if (!points?.length) return { type: 'ink' };
  const first = points[0];
  const last = points[points.length - 1];
  const len = pathLength(points);
  const chord = dist(first, last);

  // A tap, or a press that barely moved: mark the square under it.
  if (len < 0.45) {
    const square = squareAt(first.x, first.y, orientation);
    return square ? { type: 'square', square } : { type: 'ink' };
  }

  // A small closed loop: ends close together, the whole thing about one
  // square across. It marks the square its middle sits on.
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (chord < 0.6 && len > 1.2 && w <= 1.6 && h <= 1.6 && w >= 0.35 && h >= 0.35) {
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const square = squareAt(cx, cy, orientation);
    if (square) return { type: 'square', square };
  }

  // From one square to another, near enough in a straight line (or in a
  // knight's L): an arrow.
  const from = squareAt(first.x, first.y, orientation);
  const to = squareAt(last.x, last.y, orientation);
  if (from && to && from !== to && chord >= 0.6) {
    const ratio = len / chord;
    if (ratio <= STRAIGHT || (isKnightHop(from, to) && ratio <= KNIGHT_BEND)) {
      return { type: 'arrow', from, to };
    }
  }
  return { type: 'ink' };
}
