// Changes made on the analysis board, written into a game's Game Review — the
// same record Chess Arcade's review writes (lib/reviewOnBoard reads it), so a
// change on either screen is on the other: an arrow taken off on the board is
// gone in Game Review, one put back is back.
//
// Each takes the record's analysis text (an) and a ref — a main-line ply, or
// [the ply a side line leaves from, uci…] (lib/reviewOnBoard refOf) — and
// gives the new text, the record's other fields as they were: CLAMP, tactics
// and anything Chess Arcade adds later are never touched. A side line a
// change lands on is kept in the record (l); one taken out goes with every
// comment, mark, badge and colour on it or after it. Pure —
// tests/reviewEdit.test.mjs.
import { PEN_HEX, BADGE_OF_CODE, LINE_COLOR, parseAn } from './reviewOnBoard';

// Chess Arcade's own limit on one record (GN_MAX): a longer one isn't kept.
export const MAX_RECORD = 10000;

const KNOWN = ['v', 'l', 'c', 'm', 'b', 'k', 'q', 't', 'h', 'o'];
const CODE_OF_BADGE = Object.fromEntries(Object.entries(BADGE_OF_CODE).map(([c, id]) => [id, c]));
const CODE_OF_LINE = Object.fromEntries(Object.entries(LINE_COLOR).map(([c, name]) => [name, c]));
export const reviewBadge = (id) => Boolean(CODE_OF_BADGE[id]);
export const REVIEW_LINE_COLORS = Object.values(LINE_COLOR);

const isLine = (ref) => Array.isArray(ref);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// a's moves start b's (a line ref is a prefix of another)
const startsWith = (b, a) => isLine(a) && isLine(b) && a.length <= b.length && a.every((x, i) => x === b[i]);
const refOk = (ref) => (Number.isInteger(ref) && ref >= 0)
  || (isLine(ref) && ref.length >= 2 && ref.length <= 61 && Number.isInteger(ref[0]) && ref[0] >= 0
    && ref.slice(1).every((u) => typeof u === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)));

const open = (an) => {
  const A = parseAn(an) ?? {};
  return { v: 1, l: [], c: [], m: [], ...A };
};
// The fields in the order Chess Arcade writes them, then any it doesn't know;
// nothing left in it at all: ''.
function close(A) {
  const out = {};
  for (const k of KNOWN) if (k in A) out[k] = A[k];
  for (const k of Object.keys(A)) if (!KNOWN.includes(k)) out[k] = A[k];
  const empty = Object.entries(out).every(([k, v]) => k === 'v' || (Array.isArray(v) && v.length === 0));
  return empty ? '' : JSON.stringify(out);
}
const rows = (A, k) => (Array.isArray(A[k]) ? A[k] : []);
const without = (A, k, ref) => rows(A, k).filter((x) => !(Array.isArray(x) && same(x[0], ref)));

// A side line something is written on stays in the record: its moves, as far
// as that move (Chess Arcade keeps each line's end, l).
function keepLine(A, ref) {
  if (!isLine(ref)) return;
  const l = rows(A, 'l').filter(Array.isArray);
  if (l.some((x) => startsWith(x, ref))) return;
  A.l = [...l.filter((x) => !startsWith(ref, x)), ref];
}

// Chess Arcade's pen for a colour drawn here. The board's pens and arrow
// profiles draw in its very colours; a PGN comment's orange and cyan (lib/marks)
// are its orange and light blue; anything else, the nearest.
const ALIAS = { '#f0883e': 'O', '#39c5cf': 'L' };
function penOf(hex) {
  const h = String(hex ?? '').toLowerCase();
  for (const [c, v] of Object.entries(PEN_HEX)) if (v === h) return c;
  if (ALIAS[h]) return ALIAS[h];
  const rgb = (x) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(x);
    return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
  };
  const a = rgb(h);
  if (!a) return 'G';
  let best = 'G';
  let d = Infinity;
  for (const [c, v] of Object.entries(PEN_HEX)) {
    const b = rgb(v);
    const e = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    if (e < d) { d = e; best = c; }
  }
  return best;
}

// The arrows and squares drawn at a move: { arrows: [[from, to, colour]],
// squares: { sq: colour } } — all of them, as they are now.
export function setMarksAt(an, ref, marks) {
  if (!refOk(ref)) return an;
  const A = open(an);
  const arrows = (marks?.arrows ?? [])
    .filter((a) => Array.isArray(a) && /^[a-h][1-8]$/.test(a[0]) && /^[a-h][1-8]$/.test(a[1]) && a[0] !== a[1])
    .slice(0, 24).map(([f, t, c]) => `${penOf(c)}${f}${t}`);
  const squares = Object.entries(marks?.squares ?? {})
    .filter(([s]) => /^[a-h][1-8]$/.test(s)).slice(0, 32).map(([s, c]) => `${penOf(c)}${s}`);
  A.m = without(A, 'm', ref);
  if (arrows.length || squares.length) {
    A.m.push([ref, arrows.join(' '), squares.join(' ')]);
    keepLine(A, ref);
  }
  return close(A);
}

// A move's comment ('' takes it off).
export function setCommentAt(an, ref, text) {
  if (!refOk(ref)) return an;
  const A = open(an);
  const t = String(text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
  A.c = without(A, 'c', ref);
  if (t) {
    A.c.push([ref, t]);
    keepLine(A, ref);
  }
  return close(A);
}

// Your badge on a move (null takes it off; the engine's are its own). Once a
// record has had badges it keeps b, [] when they're all off — Chess Arcade's
// rule, so an older copy without b isn't read as your having taken them off.
export function setBadgeAt(an, ref, id) {
  if (!refOk(ref) || ref === 0) return an;
  if (id && !CODE_OF_BADGE[id]) return an;
  const A = open(an);
  A.b = without(A, 'b', ref);
  if (id) {
    A.b.push([ref, CODE_OF_BADGE[id]]);
    keepLine(A, ref);
  }
  return close(A);
}

// A side line's colour, on its first move (null takes it off).
export function setLineColorAt(an, ref, color) {
  if (!isLine(ref) || !refOk(ref)) return an;
  if (color && !CODE_OF_LINE[color]) return an;
  const A = open(an);
  A.h = without(A, 'h', ref);
  if (color) {
    A.h.push([ref, CODE_OF_LINE[color]]);
    keepLine(A, ref);
  }
  return close(A);
}

// Whether the record has anything on this side line, from this move on.
export function hasLineFrom(an, ref) {
  if (!isLine(ref)) return false;
  const A = parseAn(an);
  if (!A) return false;
  if (rows(A, 'l').some((x) => startsWith(x, ref))) return true;
  return ['c', 'm', 'b', 'h'].some((k) => rows(A, k).some((x) => Array.isArray(x) && startsWith(x[0], ref)));
}

// A side line taken out from this move on: its moves (what came before stays),
// and every comment, mark, badge and colour on them.
export function removeLineFrom(an, ref) {
  if (!isLine(ref) || !refOk(ref)) return an;
  const A = open(an);
  const before = ref.length > 2 ? ref.slice(0, -1) : null;
  const l = [];
  for (const x of rows(A, 'l')) {
    if (!startsWith(x, ref)) l.push(x);
    else if (before && !l.some((y) => same(y, before))) l.push(before);
  }
  A.l = l.filter((x, i) => !l.some((y, j) => j !== i && startsWith(y, x) && !same(y, x)));
  for (const k of ['c', 'm', 'b', 'h']) {
    if (k in A) A[k] = rows(A, k).filter((x) => !(Array.isArray(x) && startsWith(x[0], ref)));
  }
  return close(A);
}

// Whether a record's text fits (Chess Arcade keeps one up to MAX_RECORD).
export const fits = (an) => typeof an === 'string' && an.length <= MAX_RECORD;
