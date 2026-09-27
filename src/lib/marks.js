// Arrows and highlighted squares on a line's moves.
//
// They're kept where PGN keeps them — inside the move's comment, as the
// [%cal …] (arrows) and [%csl …] (squares) commands Lichess, ChessBase and
// Chessable all write:
//
//     8.Qxf3 {The knight was the key defender. [%cal Gf3f7,Rg5f6] [%csl Ye5]}
//
// Colours: G green, R red, B blue, Y yellow (O orange and C cyan are read
// too). So a line's arrows travel wherever its comments already do — sync,
// backups, PGN export and import, lines sent to a student — with nothing
// extra to carry. The comment's words and its marks are handled apart, so
// editing one never loses the other.
//
// A comment keyed -1 belongs to the starting position, before the first
// move: a PGN's opening comment, and anything drawn there.

export const START = -1;

export const PEN = {
  G: '#2ecc71', R: '#e5534b', B: '#3b9cff', Y: '#e8b339', O: '#f0883e', C: '#39c5cf',
};
export const FILL = {
  G: 'rgba(46, 204, 113, 0.5)',
  R: 'rgba(229, 83, 75, 0.5)',
  B: 'rgba(59, 156, 255, 0.5)',
  Y: 'rgba(232, 179, 57, 0.55)',
  O: 'rgba(240, 136, 62, 0.5)',
  C: 'rgba(57, 197, 207, 0.5)',
};
export const PEN_ORDER = ['G', 'R', 'B', 'Y'];

// …and ChessBase's "[#]", which marks where a book would print a diagram:
// nothing to read, kept as it was like any other command.
const COMMAND = /\[%(\w+)\s*([^\]]*)\]|\[#\]/g;

// The comment taken apart:
//   text    — the words, with every [%…] command taken out
//   cal     — [{ c, from, to }] arrows, by colour letter
//   csl     — [{ c, sq }] squares
//   arrows  — [[from, to, colour]] ready to draw
//   squares — { sq: fill } ready to paint
//   other   — any other commands ([%clk], [%eval] …), kept as they were
export function parseMarks(raw) {
  const cal = [];
  const csl = [];
  const other = [];
  const text = String(raw ?? '').replace(COMMAND, (all, cmd, args = '') => {
    const items = args.split(/[,\s]+/).filter(Boolean);
    if (cmd === 'cal') {
      for (const it of items) {
        const m = it.match(/^([A-Za-z])?([a-h][1-8])([a-h][1-8])$/);
        if (m) cal.push({ c: (m[1] ?? 'G').toUpperCase(), from: m[2], to: m[3] });
      }
    } else if (cmd === 'csl') {
      for (const it of items) {
        const m = it.match(/^([A-Za-z])?([a-h][1-8])$/);
        if (m) csl.push({ c: (m[1] ?? 'G').toUpperCase(), sq: m[2] });
      }
    } else {
      other.push(all);
    }
    return ' ';
  })
    // Tidy the gaps the commands leave — but keep the line breaks someone
    // typed into a note.
    .replace(/[^\S\n]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
  return {
    text,
    cal,
    csl,
    other,
    arrows: cal.map((a) => [a.from, a.to, PEN[a.c] ?? PEN.Y]),
    squares: Object.fromEntries(csl.map((s) => [s.sq, FILL[s.c] ?? FILL.Y])),
  };
}

// The commands for a set of marks: "[%csl Ye5] [%cal Gf3e5,Rd8d1]".
export function encodeMarks({ cal = [], csl = [] }) {
  const parts = [];
  if (csl.length) parts.push(`[%csl ${csl.map((s) => `${s.c}${s.sq}`).join(',')}]`);
  if (cal.length) parts.push(`[%cal ${cal.map((a) => `${a.c}${a.from}${a.to}`).join(',')}]`);
  return parts.join(' ');
}

// A comment put back together: these words, these marks, and whatever other
// commands it already carried. Empty when there's nothing left.
export function compose(text, { cal = [], csl = [] }, other = []) {
  return [String(text ?? '').trim(), encodeMarks({ cal, csl }), ...other].filter(Boolean).join(' ');
}

// The same comment with new words — its marks kept.
export function withText(raw, text) {
  const m = parseMarks(raw);
  return compose(text, m, m.other);
}

// The same comment with new marks — its words kept.
export function withMarks(raw, marks) {
  const m = parseMarks(raw);
  return compose(m.text, marks, m.other);
}

// Drawing: the same arrow again (either colour) takes it away; a different
// colour on the same pair recolours it.
export function toggleArrow(marks, from, to, c) {
  const cal = marks.cal ?? [];
  const at = cal.findIndex((a) => a.from === from && a.to === to);
  if (at >= 0 && cal[at].c === c) return { ...marks, cal: cal.filter((_, i) => i !== at) };
  if (at >= 0) return { ...marks, cal: cal.map((a, i) => (i === at ? { ...a, c } : a)) };
  return { ...marks, cal: [...cal, { c, from, to }] };
}

export function toggleSquare(marks, sq, c) {
  const csl = marks.csl ?? [];
  const at = csl.findIndex((s) => s.sq === sq);
  if (at >= 0 && csl[at].c === c) return { ...marks, csl: csl.filter((_, i) => i !== at) };
  if (at >= 0) return { ...marks, csl: csl.map((s, i) => (i === at ? { ...s, c } : s)) };
  return { ...marks, csl: [...csl, { c, sq }] };
}

// The marks on the board after `ply` moves: the comment on the move just
// played, or the starting position's.
export const commentAt = (comments, ply) => comments?.[ply > 0 ? ply - 1 : START];

// How many arrows and highlighted squares a line's comments carry — shown
// when importing, so it's plain whether a PGN brought its arrows with it.
export function countMarks(comments) {
  let arrows = 0;
  let squares = 0;
  for (const raw of Object.values(comments ?? {})) {
    const m = parseMarks(raw);
    arrows += m.cal.length;
    squares += m.csl.length;
  }
  return { arrows, squares };
}

// Analysis draws per position in its own form — arrows [[from, to, hex]] and
// squares { sq: hex } in the pen colours — so a line's marks go across to it
// and come back from it through these two.
const LETTER_OF = Object.fromEntries(Object.entries(PEN).map(([c, hex]) => [hex.toLowerCase(), c]));
const letterOf = (hex) => LETTER_OF[String(hex ?? '').toLowerCase()] ?? 'G';

export function drawingOf({ cal = [], csl = [] }) {
  return {
    arrows: cal.map((a) => [a.from, a.to, PEN[a.c] ?? PEN.G]),
    squares: Object.fromEntries(csl.map((s) => [s.sq, PEN[s.c] ?? PEN.G])),
  };
}

export function marksOfDrawing(drawing) {
  return {
    cal: (drawing?.arrows ?? []).map(([from, to, hex]) => ({ c: letterOf(hex), from, to })),
    csl: Object.entries(drawing?.squares ?? {}).map(([sq, hex]) => ({ c: letterOf(hex), sq })),
  };
}

// The comment without an arrow from `from` to `to` — for a side line, whose
// copy of the move before it mustn't point at the main line's reply.
export function withoutArrow(raw, from, to) {
  const m = parseMarks(raw);
  const cal = m.cal.filter((a) => !(a.from === from && a.to === to));
  return cal.length === m.cal.length ? raw : compose(m.text, { cal, csl: m.csl }, m.other);
}
