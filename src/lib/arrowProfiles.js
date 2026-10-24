// Arrow colour profiles, from Chess Arcade: what colour an arrow or a
// highlighted square takes when you draw it without holding a pen key.
//
//   default     the pen, exactly as always
//   sequential  the arrows on a position take SEQUENCE in the order you drew
//               them, the 11th starting over at green
//   strategic   by side and captures: White green, Black blue, a White
//               capture red, a Black capture yellow — following the line you
//               draw arrow by arrow on an imagined copy of the position
//
// In both, a highlight takes the colour of the arrow drawn before it (with
// none yet: Sequential's green, or Strategic's colour for the side to move).
// A held pen key still wins: in Sequential that arrow takes no step, in
// Strategic it still counts as a move of the imagined line.
//
// Chess Arcade works the colours out as it draws; here they're also what's
// saved — a game, a Lab entry or a review keeps the colours you saw, for a
// student whose own app is on Default too. So each position's marks carry a
// little bookkeeping beside them:
//
//   meta: { n, a: { e2e4: { s, p? } }, q: { e4: { s, p? } } }
//
// `s` is the draw order on that position (arrows and squares together) and
// `p`, there only on a mark drawn without a pen key, is the pen colour it
// would have in Default. Removing a mark, or switching profile, works the
// colours out again from that. Marks with no bookkeeping (drawn before this,
// imported from a PGN, carried over from elsewhere) keep their colours and
// play no part. Pure, so tests/arrowProfiles.test.mjs covers it.

export const SEQUENCE = ['#2ecc71', '#e8b339', '#3b9cff', '#e5534b', '#f97316',
  '#8b5cf6', '#f472b6', '#7dd3fc', '#8b5a2b', '#1a1a1a'];
export const SEQUENCE_NAMES = ['green', 'yellow', 'blue', 'red', 'orange',
  'purple', 'pink', 'light blue', 'brown', 'black'];
export const STRATEGIC = {
  w: '#2ecc71', b: '#3b9cff', wx: '#e5534b', bx: '#e8b339',
};
export const PROFILES = {
  default: { label: 'Default' },
  sequential: { label: 'Sequential' },
  strategic: { label: 'Strategic' },
};
export const PROFILE_ORDER = ['default', 'sequential', 'strategic'];

export const profileOf = (settings) => (PROFILE_ORDER.includes(settings?.arrowProfile) ? settings.arrowProfile : 'default');
export const nextProfile = (id) => PROFILE_ORDER[(PROFILE_ORDER.indexOf(id) + 1) % PROFILE_ORDER.length];
const profiled = (profile) => profile === 'sequential' || profile === 'strategic';

// The two darkest colours get a light halo instead of the dark one, or they
// sink into dark squares.
const LIGHT_HALO = ['#8b5a2b', '#1a1a1a'];
export const haloOf = (color) => (LIGHT_HALO.includes(String(color).toLowerCase()) ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.45)');

// A highlighted square: a wash of the colour with a ring of it round the
// edge. With a profile on the ring gets a thin halo — a profile picks
// colours without asking, so one can land on a square of its own hue — and
// the wash is stronger, so two neighbouring steps (yellow and orange, blue
// and light blue) stay apart on any theme; black a little less, so a dark
// piece standing on it doesn't vanish.
export function squareMarkStyle(color, profile) {
  if (!profiled(profile)) return { backgroundColor: `${color}66`, boxShadow: `inset 0 0 0 3px ${color}` };
  const dark = LIGHT_HALO.includes(String(color).toLowerCase());
  return {
    backgroundColor: `${color}${color.toLowerCase() === '#1a1a1a' ? '8c' : 'b3'}`,
    boxShadow: `inset 0 0 0 3px ${color}, inset 0 0 0 ${dark ? '5px' : '4.5px'} ${haloOf(color)}`,
  };
}

// ---------- The position ----------

const FILES = 'abcdefgh';
// a1 = 0, h1 = 7, a2 = 8 … h8 = 63: White moves up the rows.
const idxOf = (sq) => (FILES.indexOf(sq[0]) + (Number(sq[1]) - 1) * 8);

// Who stands where, and whose move, from a FEN. Anything else reads as an
// empty board with White to move.
export function snapshotOf(fen) {
  const colors = Array(64).fill(null);
  const types = Array(64).fill(null);
  const [place, side, , ep] = String(fen ?? '').trim().split(/\s+/);
  const rows = (place ?? '').split('/');
  if (rows.length === 8) {
    rows.forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += Number(ch); continue; }
        if (f < 8) {
          const i = (7 - r) * 8 + f;
          colors[i] = ch === ch.toUpperCase() ? 'w' : 'b';
          types[i] = ch.toLowerCase();
        }
        f += 1;
      }
    });
  }
  return {
    colors, types, turn: side === 'b' ? 'b' : 'w', ep: /^[a-h][36]$/.test(ep ?? '') ? idxOf(ep) : null,
  };
}

// ---------- The colours ----------

// Every mark's colour under `profile`: { arrows: [colour per arrow], squares:
// { sq: colour } }. Strategic walks the arrows in draw order over an imagined
// copy of the position: the mover is the piece on the from-square there; on
// an empty from-square, the other side from the previous arrow (the side to
// move, for the first). Landing on the other side's piece is a capture. Then
// the arrow is played on the copy, the mover's piece going to the to-square,
// with no legality check (arrows are ideas) — so Nf3-g5 then g5-f7 stays
// White's. Arrows are also drawn side by side, as alternatives, so a
// from-square an earlier arrow moved a piece off (with nothing landed since)
// still belongs to that piece — a fork, a bishop's two checks, a fan of
// knight hops are all one side's — and a square holding your own piece only
// because an earlier arrow of yours landed there is judged by what that
// arrow took (a battery: Bxf7, then Ng5xf7 is a capture too). En passant is
// a capture, on the position's own square or one a pawn's double step in the
// imagined line opened.
export function resolveColors(marks, fen, profile) {
  const arrows = marks?.arrows ?? [];
  const squares = marks?.squares ?? {};
  const meta = marks?.meta;
  const out = { arrows: arrows.map((a) => a[2]), squares: { ...squares } };
  if (!meta) return out;
  const items = [];
  arrows.forEach(([from, to], i) => {
    const m = meta.a?.[from + to];
    if (m) items.push({ i, from, to, seq: m.s ?? 0, auto: m.p != null, pen: m.p });
  });
  for (const sq of Object.keys(squares)) {
    const m = meta.q?.[sq];
    if (m) items.push({ sq, seq: m.s ?? 0, auto: m.p != null, pen: m.p });
  }
  if (!profiled(profile)) {
    for (const it of items) {
      if (!it.auto) continue;
      if ('sq' in it) out.squares[it.sq] = it.pen;
      else out.arrows[it.i] = it.pen;
    }
    return out;
  }
  items.sort((x, y) => x.seq - y.seq);
  const s = snapshotOf(fen);
  const B = s.colors.slice();
  const T = s.types.slice();
  const left = {};
  const landed = {};
  const under = {};
  const ep = {}; // ep[square] = the side that may take en passant there
  if (s.ep != null) ep[s.ep] = s.turn;
  let step = 0;
  let cur = null;
  let prev = null;
  for (const it of items) {
    if ('sq' in it) {
      if (it.auto) out.squares[it.sq] = cur || (profile === 'sequential' ? SEQUENCE[0] : STRATEGIC[s.turn]);
      continue;
    }
    let c;
    if (profile === 'sequential') {
      if (!it.auto) continue;
      c = SEQUENCE[step % SEQUENCE.length];
      step += 1;
    } else {
      const from = idxOf(it.from);
      const to = idxOf(it.to);
      let mover = B[from];
      let kind = T[from] || null;
      if (!mover && left[from]) { mover = left[from].c; kind = left[from].t; } // another idea for that piece
      if (!mover) { mover = prev ? (prev === 'w' ? 'b' : 'w') : s.turn; kind = null; }
      const ownLanded = B[to] === mover && landed[to];
      const victim = ownLanded ? under[to] : B[to];
      let capture = !!victim && victim !== mover;
      let epTaken = null;
      if (!B[to] && kind === 'p' && ep[to] === mover && Math.abs((from % 8) - (to % 8)) === 1
        && Math.floor(to / 8) - Math.floor(from / 8) === (mover === 'w' ? 1 : -1)) {
        const v = Math.floor(from / 8) * 8 + (to % 8);
        if (B[v] && B[v] !== mover && T[v] === 'p') { capture = true; epTaken = v; }
      }
      c = STRATEGIC[`${mover}${capture ? 'x' : ''}`];
      // Played on the imagined copy.
      if (B[from] === mover) { left[from] = { c: mover, t: kind }; B[from] = null; T[from] = null; landed[from] = false; }
      if (!ownLanded) under[to] = B[to];
      if (epTaken != null) { B[epTaken] = null; T[epTaken] = null; }
      B[to] = mover; T[to] = kind; landed[to] = true; delete left[to];
      if (kind === 'p' && from % 8 === to % 8 && Math.abs(to - from) === 16) ep[(from + to) / 2] = mover === 'w' ? 'b' : 'w';
      prev = mover;
    }
    cur = c;
    if (it.auto) out.arrows[it.i] = c;
  }
  return out;
}

// The marks with their colours worked out and written in — the same object
// when nothing changes.
export function applyColors(marks, fen, profile) {
  if (!marks?.meta) return marks;
  const c = resolveColors(marks, fen, profile);
  const changed = marks.arrows.some((a, i) => a[2] !== c.arrows[i])
    || Object.keys(marks.squares ?? {}).some((sq) => marks.squares[sq] !== c.squares[sq]);
  if (!changed) return marks;
  return { ...marks, arrows: marks.arrows.map((a, i) => [a[0], a[1], c.arrows[i]]), squares: c.squares };
}

// Every position's marks, recoloured for `profile` (a switch of profile) —
// the same object when nothing changes.
export function recolorAll(annotations, profile) {
  let out = annotations;
  for (const [fen, m] of Object.entries(annotations ?? {})) {
    const next = applyColors(m, fen, profile);
    if (next !== m) {
      if (out === annotations) out = { ...annotations };
      out[fen] = next;
    }
  }
  return out;
}

// ---------- Drawing ----------

const EMPTY = { arrows: [], squares: {} };
const metaOf = (m) => ({ n: m?.meta?.n ?? 0, a: { ...(m?.meta?.a ?? {}) }, q: { ...(m?.meta?.q ?? {}) } });
const tidy = (m) => (m.arrows.length || Object.keys(m.squares).length ? m : { arrows: [], squares: {} });

// Drawing the same mark again takes it off. In Default that's the same
// colour, as always; with a profile on a keyless mark only matches a keyless
// one, its colour being the profile's.
const sameMark = (exColor, exMeta, { held, pen, profile }) => {
  const color = held || pen;
  if (profiled(profile) && exMeta) return held ? exMeta.p == null && exColor === color : exMeta.p != null;
  return exColor === color;
};

// An arrow drawn from `from` to `to` on the position `fen`: `held` the colour
// of a pen key held (or null), `pen` the colour a keyless one is in Default.
export function drawArrow(marks, from, to, opts) {
  const m = marks ?? EMPTY;
  const meta = metaOf(m);
  const key = from + to;
  const arrows = m.arrows.slice();
  const at = arrows.findIndex((a) => a[0] === from && a[1] === to);
  let add = true;
  if (at >= 0) {
    add = !sameMark(arrows[at][2], m.meta?.a?.[key], opts);
    arrows.splice(at, 1);
    delete meta.a[key];
  }
  if (add) {
    meta.n += 1;
    arrows.push([from, to, opts.held || opts.pen]);
    meta.a[key] = opts.held ? { s: meta.n } : { s: meta.n, p: opts.pen };
  }
  return tidy(applyColors({ arrows, squares: { ...m.squares }, meta }, opts.fen, opts.profile));
}

// A square highlighted, or taken off.
export function drawSquare(marks, sq, opts) {
  const m = marks ?? EMPTY;
  const meta = metaOf(m);
  const squares = { ...m.squares };
  if (squares[sq] != null && sameMark(squares[sq], m.meta?.q?.[sq], opts)) {
    delete squares[sq];
    delete meta.q[sq];
  } else {
    meta.n += 1;
    squares[sq] = opts.held || opts.pen;
    meta.q[sq] = opts.held ? { s: meta.n } : { s: meta.n, p: opts.pen };
  }
  return tidy(applyColors({ arrows: m.arrows.slice(), squares, meta }, opts.fen, opts.profile));
}

// The colour an arrow from `from` to `to` would be drawn in now — for the
// arrow following the pointer — or null when drawing it would take it off.
export function colorOfNext(marks, from, to, opts) {
  const next = drawArrow(marks, from, to, opts);
  return next.arrows.find((a) => a[0] === from && a[1] === to)?.[2] ?? null;
}

// Marks that keep no bookkeeping (a chapter line's, saved as PGN codes): the
// colour a new arrow or square takes, worked out as if every mark already
// there had been drawn keyless, in order — arrows first.
export function colorForPlain(drawing, fen, { from, to, sq }, opts) {
  const meta = { n: 0, a: {}, q: {} };
  for (const [f, t, c] of drawing?.arrows ?? []) { meta.n += 1; meta.a[f + t] = { s: meta.n, p: c }; }
  for (const [s, c] of Object.entries(drawing?.squares ?? {})) { meta.n += 1; meta.q[s] = { s: meta.n, p: c }; }
  const marks = { arrows: drawing?.arrows ?? [], squares: drawing?.squares ?? {}, meta };
  const o = { ...opts, fen };
  if (sq) {
    const next = drawSquare(marks, sq, o);
    return next.squares[sq] ?? null;
  }
  return colorOfNext(marks, from, to, o);
}
