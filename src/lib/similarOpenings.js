import { Chess } from 'chess.js';
import { startFenOf, moveNumberLabel } from './startPos';

// Similar openings: the lines in a repertoire whose positions most resemble
// the one on the board — for when a game has left book, or reached a book
// position by a road the book doesn't take.
//
// Three kinds of match, closest first, and nothing looser:
//   same  — this very position is in a line (a transposition, any move order)
//   pawns — every pawn on the same square; a few pieces stand elsewhere
//   pawn  — one pawn not yet pushed as far as the line has it
// Material must be the same: a position with a piece traded off isn't the
// same opening. Each piece out of place costs 1, or ½ if it's one move from
// its square in the line — a piece that's still to go there. One that's
// gone somewhere the line hasn't sent it yet (developed here, at home in
// the line) can't come back, so it costs 1 whatever: the line is behind the
// board. A pawn can't go back either: one pawn not yet pushed as far as the
// line has it is ½; one pushed further than the line's (another structure,
// another opening) is no match at all. Castling counts as one move, the
// other side to move as one too. Past
// MAX_COST nothing is offered — no match is better than a weak one. A line's
// first few moves are left out, where every position looks alike, and so is
// the board's own until it's that far in.
//
// Among matches as close, a line with something to say comes first: one
// whose next move can be played on the board, then one that goes on at all,
// then one from the side being played (when the board knows it). At most
// MAX_DIFFS things out of place, and at most one the line is behind on.
//
// Pure, apart from chess.js for the line's next moves: tests/similarOpenings
// covers it. The Stockfish check is the board's (AnalysisView).

export const MAX_COST = 3;
export const MAX_COST_PAWN = 2; // with a pawn already different, fewer pieces
export const MIN_PLY = 6;
// A match ranked past this (closeness, plus what makes a line less useful
// here) isn't offered. Past it are three things out of place with the other
// side to move, whose next move can't be played: a likeness on paper only.
export const MAX_RANK = 3;
// More things out of place than this, and it isn't nearly the same position.
export const MAX_DIFFS = 3;

const FILES = 'abcdefgh';
export const squareName = (i) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}`;
const PIECE_NAME = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};
// Where each piece starts: a piece on one of its own here hasn't moved yet.
const HOME = {
  N: [57, 62], B: [58, 61], R: [56, 63], Q: [59], K: [60],
  n: [1, 6], b: [2, 5], r: [0, 7], q: [3], k: [4],
};
const atHome = (ch, i) => (HOME[ch] ?? []).includes(i);

// A position key (fen4: placement, side to move, castling, en passant).
function parse(key) {
  const [placement, turn = 'w', castling = '-'] = key.split(' ');
  const board = new Array(64).fill(null);
  let i = 0;
  for (const ch of placement) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') i += Number(ch);
    else { board[i] = ch; i += 1; }
  }
  return { board, turn, castling };
}

const materialOf = (board) => {
  const n = {};
  for (const p of board) if (p) n[p] = (n[p] ?? 0) + 1;
  return Object.keys(n).sort().map((p) => `${p}${n[p]}`).join('');
};

// Every position in the repertoire (lib/repertoire's position index), once,
// grouped by material — a board is only ever compared with its own group.
export function buildSimilarIndex(positionIndex) {
  const byMaterial = new Map();
  for (const [key, hits] of positionIndex) {
    const minPly = Math.min(...hits.map((h) => h.ply));
    const p = parse(key);
    const entry = {
      key, ...p, hits, minPly,
    };
    const m = materialOf(p.board);
    if (!byMaterial.has(m)) byMaterial.set(m, []);
    byMaterial.get(m).push(entry);
  }
  return { byMaterial, positionIndex };
}

// Can the piece on `from` reach `to` in one move on this board? Geometry and
// what stands in the way; checks aren't looked at.
function oneMove(board, from, to) {
  const piece = board[from];
  if (!piece || from === to) return false;
  const target = board[to];
  if (target && (target === target.toUpperCase()) === (piece === piece.toUpperCase())) return false;
  const fr = Math.floor(from / 8); const fc = from % 8;
  const tr = Math.floor(to / 8); const tc = to % 8;
  const dr = tr - fr; const dc = tc - fc;
  const type = piece.toLowerCase();
  if (type === 'n') return (Math.abs(dr) === 1 && Math.abs(dc) === 2) || (Math.abs(dr) === 2 && Math.abs(dc) === 1);
  if (type === 'k') return Math.max(Math.abs(dr), Math.abs(dc)) === 1;
  const straight = dr === 0 || dc === 0;
  const diagonal = Math.abs(dr) === Math.abs(dc);
  if (type === 'r' && !straight) return false;
  if (type === 'b' && !diagonal) return false;
  if (type === 'q' && !straight && !diagonal) return false;
  if (type === 'p') return false;
  const sr = Math.sign(dr); const sc = Math.sign(dc);
  for (let r = fr + sr, c = fc + sc; r !== tr || c !== tc; r += sr, c += sc) {
    if (board[r * 8 + c]) return false;
  }
  return true;
}

// The cheapest way to pair up `a` (squares here) with `b` (squares in the
// line), for pieces of one kind: there are never more than a few.
function pairUp(a, b, cost) {
  if (a.length <= 1) return a.length ? { total: cost(a[0], b[0]), pairs: [[a[0], b[0]]] } : { total: 0, pairs: [] };
  let best = null;
  const permute = (rest, chosen) => {
    if (!rest.length) {
      const pairs = a.map((x, i) => [x, chosen[i]]);
      const total = pairs.reduce((s, [x, y]) => s + cost(x, y), 0);
      if (!best || total < best.total) best = { total, pairs };
      return;
    }
    rest.forEach((y, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...chosen, y]));
  };
  permute(b, []);
  return best;
}

// Castling, either way round: one side castled here and not in the line (or
// the reverse) is one difference, not a king and a rook out of place.
const CASTLES = [
  { color: 'w', side: 'short', king: [60, 62], rook: [63, 61] },
  { color: 'w', side: 'long', king: [60, 58], rook: [56, 59] },
  { color: 'b', side: 'short', king: [4, 6], rook: [7, 5] },
  { color: 'b', side: 'long', king: [4, 2], rook: [0, 3] },
];

// How the board differs from a position in the line: { pawnDiffs, cost,
// diffs } — or null when it isn't close (other pawns, more than one moved).
export function compare(here, line) {
  const diffs = [];
  let pawnDiffs = 0;
  let cost = 0;
  for (const white of [true, false]) {
    const color = white ? 'w' : 'b';
    for (const t of ['p', 'n', 'b', 'r', 'q', 'k']) {
      const ch = white ? t.toUpperCase() : t;
      const a = []; const b = [];
      for (let i = 0; i < 64; i += 1) {
        if (here.board[i] === ch && line.board[i] !== ch) a.push(i);
        if (line.board[i] === ch && here.board[i] !== ch) b.push(i);
      }
      if (!a.length) continue;
      if (t === 'p') {
        // One pawn, on its own file, not yet as far on as in the line.
        if (a.length > 1 || a[0] % 8 !== b[0] % 8) return null;
        // Rows count down the board: White's pawns go up it, Black's down.
        if (white ? a[0] < b[0] : a[0] > b[0]) return null;
        pawnDiffs += 1;
        cost += 0.5;
        diffs.push({
          kind: 'pawn', color, here: a[0], line: b[0],
        });
        continue;
      }
      // Gone where the line hasn't sent it: 1. Still to go, one move: ½.
      const price = (x, y) => {
        if (atHome(ch, y) && !atHome(ch, x)) return 1;
        return oneMove(here.board, x, y) ? 0.5 : 1;
      };
      const { total, pairs } = pairUp(a, b, price);
      cost += total;
      for (const [x, y] of pairs) {
        diffs.push({
          kind: 'piece', color, type: t, here: x, line: y,
          near: price(x, y) === 0.5, ahead: atHome(ch, y) && !atHome(ch, x), home: atHome(ch, x),
        });
      }
    }
  }
  if (pawnDiffs > 1) return null;
  // A king and rook that moved as one castling are one difference.
  for (const c of CASTLES) {
    for (const [hereKing, lineKing, hereRook, lineRook, castledHere] of [
      [c.king[0], c.king[1], c.rook[0], c.rook[1], false],
      [c.king[1], c.king[0], c.rook[1], c.rook[0], true],
    ]) {
      const k = diffs.findIndex((d) => d.kind === 'piece' && d.color === c.color && d.type === 'k' && d.here === hereKing && d.line === lineKing);
      const r = diffs.findIndex((d) => d.kind === 'piece' && d.color === c.color && d.type === 'r' && d.here === hereRook && d.line === lineRook);
      if (k < 0 || r < 0) continue;
      const pieceCost = (d) => (d.near && !d.ahead ? 0.5 : 1);
      cost -= pieceCost(diffs[k]) + pieceCost(diffs[r]) - 1;
      const castle = {
        kind: 'castle', color: c.color, side: c.side, castledHere,
      };
      diffs.splice(Math.max(k, r), 1);
      diffs.splice(Math.min(k, r), 1, castle);
    }
  }
  if (here.turn !== line.turn) {
    cost += 1;
    diffs.push({ kind: 'turn', here: here.turn, line: line.turn });
  }
  return { pawnDiffs, cost, diffs };
}

// The squares two positions have different things on: what to ring when
// they're shown side by side.
export function differingSquares(fenA, fenB) {
  const a = parse(fenA).board;
  const b = parse(fenB).board;
  const out = [];
  for (let i = 0; i < 64; i += 1) if (a[i] !== b[i]) out.push(squareName(i));
  return out;
}

const sideName = (c) => (c === 'w' ? 'White' : 'Black');

// One difference, said plainly.
export function describeDiff(d) {
  if (d.kind === 'pawn') {
    return `${sideName(d.color)}’s ${FILES[d.here % 8]}-pawn is still on ${squareName(d.here)} (the line has it on ${squareName(d.line)})`;
  }
  if (d.kind === 'piece') {
    const piece = `${sideName(d.color)}’s ${PIECE_NAME[d.type]}`;
    if (d.ahead) return `${piece} is already on ${squareName(d.here)} (still on ${squareName(d.line)} in the line)`;
    if (d.home) return `${piece} is still on ${squareName(d.here)} (the line has it on ${squareName(d.line)}${d.near ? ', one move away' : ''})`;
    return `${piece} is on ${squareName(d.here)} (the line has it on ${squareName(d.line)}${d.near ? ', one move away' : ''})`;
  }
  if (d.kind === 'castle') {
    const how = d.side === 'short' ? 'short' : 'long';
    return d.castledHere
      ? `${sideName(d.color)} has castled ${how} here (not yet in the line)`
      : `${sideName(d.color)} hasn’t castled yet here (the line castles ${how})`;
  }
  if (d.kind === 'turn') return `${sideName(d.here)} to move here (${sideName(d.line)} in the line)`;
  return '';
}

// Where a line is at a position: the move that reached it, "after 5…Nf6".
export function afterLabel(variation, ply) {
  if (ply <= 0) return 'at the start';
  return `after ${moveNumberLabel(ply - 1, startFenOf(variation), '…')}${variation.moves[ply - 1]}`;
}

// The line's next moves from that position, most-played first, and whether
// each can be played on the board as it stands.
function nextMoves(hits, fen) {
  const count = new Map();
  for (const h of hits) {
    const san = h.variation.moves[h.ply];
    if (san) count.set(san, (count.get(san) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([san, lines]) => {
    let move = null;
    try { move = new Chess(fen).move(san); } catch { move = null; }
    return {
      san, lines, legal: Boolean(move), uci: move ? `${move.from}${move.to}${move.promotion ?? ''}` : null,
    };
  });
}

// How a line is reached from here when it's one move away: "5.d4".
function moveLabelAt(fen, san) {
  const [, turn = 'w', , , , full = '1'] = fen.split(' ');
  return `${full}${turn === 'w' ? '.' : '…'}${san}`;
}

// Up to `max` suggestions for the position `fen`, each from a different
// line, closest first: this position in a line (`same`); one move from one
// (`move`, with `via`: the move, which `next` holds too); then a resemblance
// (`pawns`, `pawn`), with `diffs`. Each: { tier, key, fen, hits, opening,
// chapter, variation, ply, after, cost, diffs, lines, next, via }.
// `gamePly`: moves played to reach the board from the standard start (null
// for a set-up position); `side`: 'white'/'black' when it's known which side
// is being played here.
export function similarOpenings(index, fen, { max = 3, gamePly = null, side = null } = {}) {
  if (!index || !fen) return [];
  const key = fen.split(' ').slice(0, 4).join(' ');
  const here = parse(key);
  const early = gamePly != null && gamePly < MIN_PLY;
  const found = [];

  const exact = index.positionIndex.get(key);
  if (exact) {
    found.push({
      entry: { key, ...here, hits: exact, minPly: Math.min(...exact.map((h) => h.ply)) }, tier: 'same', cost: 0, diffs: [],
    });
  } else {
    // One move away: a move from here that lands in a line — never a guess.
    let moves = [];
    try { moves = new Chess(fen).moves({ verbose: true }); } catch { moves = []; }
    for (const m of moves) {
      const to = m.after.split(' ').slice(0, 4).join(' ');
      const hits = index.positionIndex.get(to);
      if (!hits) continue;
      found.push({
        entry: {
          key: to, ...parse(to), hits, minPly: Math.min(...hits.map((h) => h.ply)),
        },
        tier: 'move',
        cost: 0.5,
        diffs: [],
        via: {
          san: m.san, label: moveLabelAt(fen, m.san), lines: hits.length, legal: true, uci: `${m.from}${m.to}${m.promotion ?? ''}`,
        },
      });
    }
  }

  if (!early) {
    for (const entry of index.byMaterial.get(materialOf(here.board)) ?? []) {
      if (entry.key === key || entry.minPly < MIN_PLY) continue;
      const c = compare(here, entry);
      if (!c) continue;
      if (c.diffs.filter((d) => d.ahead).length > 1) continue; // the line is a stage behind
      if (c.diffs.filter((d) => d.kind !== 'turn').length > MAX_DIFFS) continue; // not "almost" any more
      const tier = c.pawnDiffs ? 'pawn' : (c.cost === 0 ? 'same' : 'pawns');
      if (c.pawnDiffs ? c.cost > MAX_COST_PAWN + 1 : c.cost > MAX_COST) continue;
      if (found.some((f) => f.entry.key === entry.key)) continue;
      found.push({
        entry, tier, cost: c.cost, diffs: c.diffs,
      });
    }
  }

  // This very position first, then one move away, then by closeness — a
  // line with something to say ahead of one without (see the top) — and
  // then the line that's further on, the more particular.
  for (const f of found) {
    f.next = f.via ? [{ san: f.via.san, lines: f.via.lines, legal: true, uci: f.via.uci }] : nextMoves(f.entry.hits, fen);
    const ownSide = !side || f.entry.hits.some((h) => h.opening?.color === side);
    const goesOn = f.via || f.entry.hits.some((h) => h.variation.moves[h.ply]);
    f.rank = (f.tier === 'same' && !f.diffs.length ? -2 : 0) + (f.tier === 'move' ? -1 : 0)
      + f.cost
      + (goesOn ? 0 : 0.5)
      + (f.next.some((m) => m.legal) ? 0 : 0.5)
      + (ownSide ? 0 : 1);
  }
  found.sort((a, b) => a.rank - b.rank || (b.entry.minPly - a.entry.minPly));

  // Each from a line of its own: a position on a line already shown — before
  // or after the one shown — would be the same suggestion again.
  const shownLines = new Set();
  const out = [];
  for (const f of found) {
    if (out.length >= max) break;
    if (f.rank > MAX_RANK) break;
    const ids = f.entry.hits.map((h) => h.variation);
    if (ids.some((v) => shownLines.has(v))) continue;
    ids.forEach((v) => shownLines.add(v));
    // The line it's named by: from the side being played, if there's one;
    // going on with the most-played next move; the shortest of those (the
    // main line, usually).
    const lineNext = nextMoves(f.entry.hits, f.via ? `${f.entry.key} 0 1` : fen);
    const mine = (h) => (side && h.opening?.color === side ? 0 : 1);
    const pick = [...f.entry.hits]
      .filter((h) => !lineNext.length || h.variation.moves[h.ply] === lineNext[0].san)
      .sort((a, b) => mine(a) - mine(b) || a.variation.moves.length - b.variation.moves.length)[0] ?? f.entry.hits[0];
    out.push({
      tier: f.tier,
      key: f.entry.key,
      fen: `${f.entry.key} 0 1`,
      hits: f.entry.hits,
      opening: pick.opening,
      chapter: pick.chapter,
      variation: pick.variation,
      ply: pick.ply,
      after: afterLabel(pick.variation, pick.ply),
      cost: f.cost,
      diffs: f.diffs,
      lines: new Set(ids).size,
      next: f.next,
      // One move away: the move, and how the line goes on after it.
      via: f.via ?? null,
      then: f.via ? lineNext : [],
    });
  }
  return out;
}
