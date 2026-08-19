// Move badges — the little glyph on a move that says what kind of move it was.
//
// The vocabulary chess players already read: chess.com's set, whose symbols are
// the standard PGN annotation glyphs, so a badge written here survives a round
// trip through a PGN as !!, !, ?!, ? or ??.
//
// Stored on a variation as { [ply]: id }, alongside its comments.
export const BADGES = [
  { id: 'brilliant', symbol: '!!', label: 'Brilliant', color: '#1aada6', nag: 3 },
  { id: 'great', symbol: '!', label: 'Great move', color: '#5b8bd6', nag: 1 },
  { id: 'best', symbol: '★', label: 'Best move', color: '#7bab5a', nag: null },
  { id: 'excellent', symbol: '✓', label: 'Excellent', color: '#8fbc6a', nag: null },
  { id: 'good', symbol: '✓', label: 'Good', color: '#9db77f', nag: null },
  { id: 'book', symbol: '📖', label: 'Book move', color: '#a88a6a', nag: null },
  { id: 'interesting', symbol: '!?', label: 'Interesting', color: '#9b7fd4', nag: 5 },
  { id: 'inaccuracy', symbol: '?!', label: 'Inaccuracy', color: '#e6a23c', nag: 6 },
  { id: 'mistake', symbol: '?', label: 'Mistake', color: '#e08331', nag: 2 },
  { id: 'blunder', symbol: '??', label: 'Blunder', color: '#d4504a', nag: 4 },
];

export const BADGE_BY_ID = Object.fromEntries(BADGES.map((b) => [b.id, b]));

export const badgeAt = (badges, ply) => (badges ? BADGE_BY_ID[badges[ply]] ?? null : null);

// The suffix a badge contributes to a move in exported PGN. Only the ones with
// a standard glyph — a "Book move" has no notation of its own.
export const badgeSuffix = (badge) => {
  if (!badge) return '';
  return ['brilliant', 'great', 'interesting', 'inaccuracy', 'mistake', 'blunder'].includes(badge.id)
    ? badge.symbol
    : '';
};

// The read side of the same round trip: only the six badges with a real PGN
// notation ever had a chance of surviving export in the first place — "Best"/
// "Excellent"/"Good"/"Book move" are this app's own vocabulary, with nothing
// standard to write or read back.
const BADGE_ID_BY_NAG = Object.fromEntries(BADGES.filter((b) => b.nag != null).map((b) => [b.nag, b.id]));
const BADGE_ID_BY_GLYPH = Object.fromEntries(BADGES.filter((b) => b.nag != null).map((b) => [b.symbol, b.id]));

export const badgeIdForNag = (n) => BADGE_ID_BY_NAG[n] ?? null;
export const badgeIdForGlyph = (g) => BADGE_ID_BY_GLYPH[g] ?? null;

// A badge, drawn straight onto the board — the way chess.com's game review
// does it: the square the move landed on tinted in the badge's own colour,
// with its glyph in a small disc over the corner. Built as a
// customSquareStyles entry (a plain CSS object keyed to one square) so it
// drops into the exact mechanism every board already uses for the last-move
// wash and the check glow, wherever a board is showing a badged position —
// there's no separate overlay layer to keep in sync.
const badgeStyleCache = new Map();
export function boardBadgeStyle(id) {
  const badge = BADGE_BY_ID[id];
  if (!badge) return null;
  if (badgeStyleCache.has(id)) return badgeStyleCache.get(id);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>`
    + `<circle cx='12' cy='12' r='10.5' fill='${badge.color}' stroke='white' stroke-width='1.6'/>`
    + `<text x='12' y='16.3' font-family='system-ui,-apple-system,sans-serif' font-size='11' `
    + `font-weight='800' text-anchor='middle' fill='#fff'>${badge.symbol}</text></svg>`;
  const style = {
    // A real longhand rather than the `background` shorthand: the shorthand
    // resets backgroundImage/-repeat/-position on any property that follows
    // it in the same style object, which would silently erase the glyph.
    backgroundColor: `color-mix(in srgb, ${badge.color} 34%, transparent)`,
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'top right',
    backgroundSize: '38% 38%',
  };
  badgeStyleCache.set(id, style);
  return style;
}
