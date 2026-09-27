import { Chess } from 'chess.js';

// Study mode reads a line the way a course book does (and the way Chessable's
// "read" mode shows it): runs of moves, and after the move a note belongs to,
// the note itself. The board beside it follows along — and draws what the
// note draws: the arrows and highlighted squares a Lichess or Chessable
// export carries inside its comments as [%cal …] and [%csl …].
//
// Everything here is plain data in, plain data out, so it's tested directly.

// ---------- Arrows and squares written inside a comment ----------

// The pens Lichess (and PGN exports generally) use, in the app's own colours
// so an imported arrow looks like one drawn here.
const PEN = {
  G: '#2ecc71', R: '#e5534b', B: '#3b9cff', Y: '#e8b339', O: '#f0883e', C: '#39c5cf',
};
const FILL = {
  G: 'rgba(46, 204, 113, 0.5)',
  R: 'rgba(229, 83, 75, 0.5)',
  B: 'rgba(59, 156, 255, 0.5)',
  Y: 'rgba(232, 179, 57, 0.55)',
  O: 'rgba(240, 136, 62, 0.5)',
  C: 'rgba(57, 197, 207, 0.5)',
};

// { text, arrows: [[from, to, colour]], squares: { sq: fill } } — the text
// with every [%…] command taken out ([%clk], [%eval] and the rest mean
// nothing to a reader either).
export function parseMarks(raw) {
  const arrows = [];
  const squares = {};
  const text = String(raw ?? '').replace(/\[%(\w+)\s*([^\]]*)\]/g, (all, cmd, args) => {
    const items = args.split(/[,\s]+/).filter(Boolean);
    if (cmd === 'cal') {
      for (const it of items) {
        const m = it.match(/^([A-Z])?([a-h][1-8])([a-h][1-8])$/);
        if (m) arrows.push([m[2], m[3], PEN[m[1] ?? 'G'] ?? PEN.Y]);
      }
    } else if (cmd === 'csl') {
      for (const it of items) {
        const m = it.match(/^([A-Z])?([a-h][1-8])$/);
        if (m) squares[m[2]] = FILL[m[1] ?? 'G'] ?? FILL.Y;
      }
    }
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  return { text, arrows, squares };
}

// ---------- The line, as a reader sees it ----------

// "4." for White's move, "4..." for Black's.
export const moveNumber = (i) => `${Math.floor(i / 2) + 1}${i % 2 === 0 ? '.' : '...'}`;

// [{ kind: 'moves', moves: [{ i, san, number }] }, { kind: 'note', i, text }]
// — a run of moves up to and including one with something to say, then what
// it says. A move's number shows on White's moves, and on Black's when it
// opens a run ("3... cxd5 4.Nf3"), as in a book.
export function studySegments(moves, comments = {}) {
  const out = [];
  let run = [];
  moves.forEach((san, i) => {
    run.push({ i, san, number: i % 2 === 0 || run.length === 0 ? moveNumber(i) : null });
    const note = comments?.[i] ? parseMarks(comments[i]).text : '';
    if (note) {
      out.push({ kind: 'moves', moves: run });
      out.push({ kind: 'note', i, text: note });
      run = [];
    }
  });
  if (run.length) out.push({ kind: 'moves', moves: run });
  return out;
}

// What the board shows at `ply` (moves played): the marks of the note on the
// move just played — a note's arrows are about the position it's written at.
export function marksAt(comments, ply) {
  if (!comments || ply <= 0 || !comments[ply - 1]) return { arrows: [], squares: {} };
  const { arrows, squares } = parseMarks(comments[ply - 1]);
  return { arrows, squares };
}

// ---------- Moves mentioned inside a note ----------

// Castling written with zeros too, and a promotion with or without its "=".
const SAN = '(?:O-O-O|O-O|0-0-0|0-0|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h](?:x[a-h])?[1-8](?:=?[QRBN])?)[+#]?(?:[!?]{1,2})?';
// Black's move written every way books do: "12...Rxc6", "12…Rxc6",
// "12. ... Rxc6", "12..Rxc6". Longest first.
const DOTS = '(\\.\\s*\\.\\.\\.|\\.\\s*…|\\.\\.\\.|…|\\.\\.|\\.)';
// A numbered move: "12.Bxc6+", "11...a6?", "3… cxd5", "12. Bxc6+".
const NUMBERED = new RegExp(`(\\d+)\\s*${DOTS}\\s*(${SAN})(?![\\w-])`, 'y');
// What may carry a sequence on: another numbered move, or a bare one.
const NEXT = new RegExp(`\\s+(?:(\\d+)\\s*${DOTS}\\s*)?(${SAN})(?![\\w-])`, 'y');
// A piece move on its own, with no number to place it: "Nxd5", "Bf4-e3".
const LOOSE = new RegExp('(?:O-O-O|O-O|0-0-0|0-0|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?(?:-[a-h][1-8])?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?)(?![\\w])', 'y');

const plyOf = (n, dots) => (Number(n) - 1) * 2 + (dots === '.' ? 0 : 1);
// As chess.js wants it: the glyph off, castling with letters, promotion with "=".
const cleanSan = (san) => san
  .replace(/[!?]+$/, '')
  .replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O')
  .replace(/^([a-h](?:x[a-h])?[18])([QRBN])/, '$1=$2');
const bare = (san) => cleanSan(san).replace(/[+#]+$/, '');

// The note, split into plain text and the move references in it:
//   { kind: 'text', text }
//   { kind: 'seq', moves: [{ san, ply, text }], depth } — a numbered
//     sequence, each move with the exact text it had, e.g. "12.Bxc6+ Rxc6
//     13.Bxf6"; `depth` is how many brackets it sits inside
//   { kind: 'loose', text, square } — a move with no number ("Nxd5 ideas"):
//     only where it lands can be shown
export function noteParts(text) {
  const parts = [];
  let plain = '';
  let depth = 0;
  let i = 0;
  const flush = () => { if (plain) parts.push({ kind: 'text', text: plain }); plain = ''; };
  // A reference only starts at a word boundary: "a4" inside "Qa4" is not one.
  const boundary = (at) => at === 0 || /[\s(,;:"'“‘—–\-/[.…]/.test(text[at - 1]);
  while (i < text.length) {
    NUMBERED.lastIndex = i;
    const m = /\d/.test(text[i]) && boundary(i) ? NUMBERED.exec(text) : null;
    if (m) {
      flush();
      const moves = [{ san: m[3], ply: plyOf(m[1], m[2]), text: m[0] }];
      i += m[0].length;
      for (;;) {
        NEXT.lastIndex = i;
        const n = NEXT.exec(text);
        if (!n) break;
        const expected = moves[moves.length - 1].ply + 1;
        const ply = n[1] ? plyOf(n[1], n[2]) : expected;
        if (ply !== expected) break;
        moves.push({ san: n[3], ply, text: n[0].trimStart() });
        i += n[0].length;
      }
      parts.push({ kind: 'seq', moves, depth });
      continue;
    }
    LOOSE.lastIndex = i;
    const l = boundary(i) ? LOOSE.exec(text) : null;
    if (l) {
      flush();
      const squares = l[0].match(/[a-h][1-8]/g);
      const castle = /^[O0]-[O0]/.test(l[0]);
      parts.push({ kind: 'loose', text: l[0], square: castle ? null : squares?.[squares.length - 1] ?? null, castle: castle ? l[0] : null });
      i += l[0].length;
      continue;
    }
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth = Math.max(0, depth - 1);
    plain += text[i];
    i += 1;
  }
  flush();
  return parts;
}

// Where a sequence in a note is played from, and as much of it as is legal:
// { base, path, playable } — `path` the legal moves in order, `playable` how
// many there are — or null if not even its first move can be played.
//
// `bases` are the positions to try, best first; the one that lets the most
// of the sequence be played wins, and a sequence played to the end beats any
// partial one. One slip in the text (an author's typo, a word read as a
// move) then only stops the moves after it, not the good ones before.
export function resolveSequence(lineMoves, seq, previous = null, bases = null) {
  const start = seq[0].ply;
  const tries = bases ?? [
    ...(previous && previous.base.length + previous.path.length === start ? [[...previous.base, ...previous.path]] : []),
    ...(lineMoves.length >= start ? [lineMoves.slice(0, start)] : []),
  ];
  let best = null;
  for (const base of tries) {
    if (base.length !== start) continue;
    const game = new Chess();
    if (!playAll(game, base)) continue;
    const path = [];
    for (const m of seq) {
      const played = tryMove(game, cleanSan(m.san));
      if (!played) break;
      path.push(played.san);
    }
    if (path.length && (!best || path.length > best.path.length)) best = { base, path, playable: path.length };
    if (best?.playable === seq.length) break;
  }
  return best;
}

// Every sequence in a note, each played from the right place:
//   · one in brackets branches off the sequence the bracket interrupts, at
//     its own move — "11...a6 12.Bxc6+ (12.Bd3 b5)"
//   · after the bracket, the interrupted sequence carries on — "… 12...Rxc6"
//   · otherwise, off the latest sequence it fits into ("Instead 12.Bd3"),
//     and failing that, off the line itself
//   · a sequence that simply restates the line is played on the line
export function resolveNote(lineMoves, parts) {
  const done = [];
  const lead = (x) => (x.line ? [...x.line.base, ...x.line.path] : null);
  const covers = (x, at) => x.line && at >= x.line.base.length && at <= lead(x).length;
  return parts.map((p) => {
    if (p.kind !== 'seq') return p;
    const at = p.moves[0].ply;
    const bases = [];
    const add = (b) => { if (b && b.length === at && !bases.some((o) => o.join(' ') === b.join(' '))) bases.push(b); };
    if (lineMoves.length > at && bare(p.moves[0].san) === bare(lineMoves[at])) add(lineMoves.slice(0, at));
    const recent = [...done].reverse();
    const outer = recent.find((x) => x.depth < p.depth);
    if (outer && covers(outer, at)) add(lead(outer).slice(0, at));
    for (const x of recent) if (x.depth === p.depth && covers(x, at)) add(lead(x).slice(0, at));
    for (const x of recent) if (covers(x, at)) add(lead(x).slice(0, at));
    if (lineMoves.length >= at) add(lineMoves.slice(0, at));
    const out = { ...p, line: resolveSequence(lineMoves, p.moves, null, bases) };
    done.push(out);
    return out;
  });
}

// The position after these moves, from the start — or null if one isn't legal.
export function fenAfter(moves) {
  const game = new Chess();
  return playAll(game, moves) ? game.fen() : null;
}

// { from, to } of the last of these moves, for the board's last-move squares.
export function lastMoveAfter(moves) {
  if (!moves.length) return null;
  const game = new Chess();
  if (!playAll(game, moves.slice(0, -1))) return null;
  const mv = tryMove(game, moves[moves.length - 1]);
  return mv ? { from: mv.from, to: mv.to } : null;
}

function playAll(game, moves) {
  for (const m of moves) if (!tryMove(game, m)) return false;
  return true;
}

// chess.js throws on an illegal move in some versions and returns null in
// others.
function tryMove(game, san) {
  try { return game.move(san) ?? null; } catch { return null; }
}
