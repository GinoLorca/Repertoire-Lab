// The square a piece is being pressed on, by board — set the instant a piece
// that can be lifted is pressed (components/useCarry), gone when the press is
// over.
//
// A press is answered by the board itself: the square marked, the piece with
// the pointer (useCarry). What the piece can do — its dots, its rings, in
// Court Cards its pips — was drawn by the view, which heard of the pick only
// when the pointer was let go (a redraw of the whole screen as a piece is
// pressed is felt); so the dots came a tenth of a second after a quick click,
// and after a slow press not until it ended. On lichess they're there with
// the press. The small parts that draw them (components/LegalDots; Board's
// suit marks) read this instead, and redraw alone.
//
// Pure, so tests/pressed.test.mjs covers it; lib/usePressed is the hook.
const pressed = new Map();
const subs = new Set();

export const pressedOn = (id) => (id == null ? null : pressed.get(String(id)) ?? null);

// `square`: the square pressed, or null when the press is over. Says nothing
// when nothing changed.
export function setPressed(id, square) {
  if (id == null) return;
  const key = String(id);
  const next = typeof square === 'string' && /^[a-h][1-8]$/.test(square) ? square : null;
  if ((pressed.get(key) ?? null) === next) return;
  if (next) pressed.set(key, next); else pressed.delete(key);
  [...subs].forEach((fn) => fn());
}

export function subscribePressed(fn) {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

// What a part shows its moves for: the square being pressed if there is one,
// else the one the view has picked.
export const shownPick = (pressedSquare, picked) => pressedSquare ?? picked ?? null;
