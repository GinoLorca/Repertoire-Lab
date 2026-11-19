// A game's Game Review, on the analysis board.
//
// Game Review is Chess Arcade's review in a frame (views/GameReviewView); what
// it writes is kept on the game as its records (lib/gameReviewBridge): the
// Notes card (note), the analysis on the board (an, one JSON text), a Larry
// Review (lr) and the engine's review (rv). This reads them into what the
// analysis board draws, by its own move tree's node ids:
//
//   · side lines, added to the tree (a move already there is followed)
//   · comments under their moves
//   · arrows and square highlights at each move
//   · badges: the ones set by hand, and the engine's on the game's moves
//   · side lines' highlight colours
//   · CLAMP letters, yours and their slips (punished, missed), with their
//     notes and squares
//   · tactics: their names, whose chance and how it went, a note, and their
//     arrows and pieces on the board
//   · the Notes card, a Larry Review, the engine's accuracy
//
// Read only: the review is changed in Game Review (Edit in Game Review); what
// the board's own tools add is the board's, kept on the game as before. Pure —
// tests/reviewOnBoard.test.mjs. The record's shape is Chess Arcade's
// (hvAnnText): { v:1, l:[side lines' ends], c:[[ref, text]], m:[[ref, arrows,
// squares]], b:[[ref, code]], k:[[ply, letter, note?]], q:[[ply, letter,
// square]], t:[tactic rows], h:[[ref, colour]], o:[their CLAMP slips] }; a ref
// is a main-line ply (0: the start) or [the ply it leaves from, uci…].
import { Chess } from 'chess.js';
import { START_FEN } from './startPos';
import { mainLineFrom, addMove, nodePath } from './moveTree';

// Chess Arcade's pens (NB_CODES): the colours its arrows and squares are kept in.
export const PEN_HEX = {
  G: '#2ecc71', Y: '#e8b339', B: '#3b9cff', R: '#e5534b', O: '#f97316', P: '#8b5cf6',
  K: '#f472b6', L: '#7dd3fc', N: '#8b5a2b', X: '#1a1a1a', W: '#ffffff',
};
// Its badges' one-letter codes (HR_BADGES), as this app's badge ids (lib/badges).
export const BADGE_OF_CODE = {
  r: 'brilliant', t: 'great', s: 'best', e: 'excellent', g: 'good', k: 'book',
  i: 'inaccuracy', m: 'mistake', w: 'miss', x: 'blunder',
};
// A side line's highlight (HV_HL), as this app's line colours.
export const LINE_COLOR = { y: 'yellow', g: 'green', b: 'blue', p: 'purple', w: 'white', r: 'red' };
// CLAMP (Checks, Loose pieces, Alignments, Mobility, Passed pawns), as Chess Arcade colours them.
export const CLAMP = {
  C: { name: 'Checks', color: '#d73b33' },
  L: { name: 'Loose pieces & loose squares', color: '#be570d' },
  A: { name: 'Alignments', color: '#2675cd' },
  M: { name: 'Mobility restrictions', color: '#845cdc' },
  P: { name: 'Passed pawns', color: '#1b864a' },
};
const CLAMP_ORDER = 'CLAMP';
// Tactics: Chess Arcade's 31, by their Lichess puzzle theme names.
export const TACTIC_NAMES = {
  fork: 'Fork', sacrifice: 'Sacrifice', pin: 'Pin', defensiveMove: 'Defensive move', discoveredAttack: 'Discovered attack',
  deflection: 'Deflection', quietMove: 'Quiet move', hangingPiece: 'Hanging piece', attraction: 'Attraction', skewer: 'Skewer',
  discoveredCheck: 'Discovered check', clearance: 'Clearance', intermezzo: 'Intermezzo', trappedPiece: 'Trapped piece',
  zugzwang: 'Zugzwang', capturingDefender: 'Capture the defender', doubleCheck: 'Double check', interference: 'Interference',
  collinearMove: 'Collinear move', mate: 'Checkmate', mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3',
  mateIn4: 'Mate in 4', mateIn5: 'Mate in 5 or more', anastasiaMate: 'Anastasia’s mate', kingsideAttack: 'Kingside attack',
  advancedPawn: 'Advanced pawn', exposedKing: 'Exposed king', queensideAttack: 'Queenside attack', attackingF2F7: 'Attacking f2 or f7',
};
export const TACTIC_COLOR = '#c2187a'; // Chess Arcade's (TAC_COLOR)

const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn]?)$/;
const SQ = /^[a-h][1-8]$/;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const text = (v, n = 2000) => (typeof v === 'string' ? v.slice(0, n) : '');

// The analysis record (an), or null.
export function parseAn(an) {
  if (typeof an !== 'string' || !an.trim()) return null;
  try {
    const A = JSON.parse(an);
    return isObj(A) ? A : null;
  } catch {
    return null;
  }
}

// FNV-1a over the moves (Chess Arcade's gnFnv): which moves an engine review is of.
export function movesSig(moves) {
  let h = 0x811c9dc5;
  const s = (moves ?? []).join(' ');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// The engine's review (rv), when it's of these very moves: { badges (one a move,
// or null), evals (before each move and after the last: { type, value }),
// accuracy: { white, black }, depth, at } — else null.
export function parseEngineReview(rv, moves) {
  if (typeof rv !== 'string' || !rv.trim()) return null;
  let e;
  try { e = JSON.parse(rv); } catch { return null; }
  const n = (moves ?? []).length;
  if (!isObj(e) || e.n !== n || !n || e.h !== movesSig(moves)) return null;
  if (typeof e.b !== 'string' || e.b.length !== n || typeof e.e !== 'string') return null;
  const evals = e.e.split(',').map((t) => {
    const m = /^M(-?\d+)$/.exec(t);
    return m ? { type: 'mate', value: Number(m[1]) } : { type: 'cp', value: Number(t) };
  });
  if (evals.length !== n + 1 || evals.some((s) => !Number.isFinite(s.value))) return null;
  const acc = (v) => (typeof v === 'number' && v >= 0 && v <= 100 ? v : null);
  return {
    badges: [...e.b].map((c) => BADGE_OF_CODE[c] ?? null),
    evals,
    accuracy: { white: acc(e.a?.[0]), black: acc(e.a?.[1]) },
    depth: Number.isInteger(e.d) ? e.d : null,
    at: typeof e.at === 'number' ? e.at : null,
  };
}

// ---------- The tree ----------

// A position after `san` from `fen`, or null.
function play(fen, move) {
  try {
    const g = new Chess(fen);
    const m = typeof move === 'string' && UCI.test(move)
      ? g.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] || undefined })
      : g.move(move);
    return m ? { fen: g.fen(), san: m.san } : null;
  } catch {
    return null;
  }
}

// The analysis board's tree with the review read onto it: a walker that finds
// (or adds) the node a ref names. Main-line plies are the game's own moves.
function treeWalker(tree, startFen) {
  let root = tree;
  const fenOf = new Map(); // node id -> position after it
  const trunk = () => mainLineFrom(root);
  let main = trunk();
  fenOf.set('root', new Chess(startFen).fen());
  {
    let fen = fenOf.get('root');
    for (const n of main) {
      const next = play(fen, n.san);
      if (!next) break;
      fen = next.fen;
      fenOf.set(n.id, fen);
    }
  }
  const nodeAtPly = (p) => (p === 0 ? root : main[p - 1] ?? null);
  const childBySan = (id, san) => {
    const find = (n) => (n.id === id ? n : n.children.map(find).find(Boolean) ?? null);
    return find(root)?.children.find((c) => c.san === san) ?? null;
  };
  // The node a ref names: a ply, or [ply, uci…] (added when it isn't there).
  const resolve = (ref) => {
    if (Number.isInteger(ref)) {
      const n = ref >= 0 ? nodeAtPly(ref) : null;
      return n && fenOf.has(n.id) ? n.id : null;
    }
    if (!Array.isArray(ref) || ref.length < 2 || ref.length > 61 || !Number.isInteger(ref[0])) return null;
    const from = nodeAtPly(ref[0]);
    if (!from || !fenOf.has(from.id)) return null;
    let id = from.id;
    let fen = fenOf.get(id);
    for (const u of ref.slice(1)) {
      if (typeof u !== 'string' || !UCI.test(u)) return null;
      const next = play(fen, u);
      if (!next) return null;
      const there = childBySan(id, next.san);
      if (there) id = there.id;
      else {
        const added = addMove(root, id, next.san);
        root = added.tree;
        main = trunk();
        id = added.nodeId;
      }
      fen = next.fen;
      fenOf.set(id, fen);
    }
    return id;
  };
  return { resolve, nodeAtPly: (p) => nodeAtPly(p)?.id ?? null, tree: () => root, fenOf };
}

// The node a side-line node's line starts at (the first move off the game).
function branchRoot(root, id) {
  const path = [];
  const walk = (n, trail) => {
    if (n.id === id) { path.push(...trail, n); return true; }
    return n.children.some((c) => walk(c, [...trail, n]));
  };
  walk(root, []);
  // path: root … node. The first node that isn't its parent's first child.
  for (let i = 1; i < path.length; i += 1) {
    if (path[i - 1].children[0]?.id !== path[i].id) return path[i].id;
  }
  return null;
}

// ---------- The review ----------

const tacticRow = (x) => {
  if (!Array.isArray(x)) return null;
  const plies = (Array.isArray(x[0]) ? x[0] : [x[0]]).filter((p) => Number.isInteger(p) && p >= 1 && p <= 3000);
  if (!plies.length) return null;
  const keys = typeof x[1] === 'string' ? [...new Set(x[1].split(' ').filter((k) => TACTIC_NAMES[k]))].slice(0, 3) : [];
  if (!keys.length || (x[2] !== 'w' && x[2] !== 'b') || !['p', 'm', 'e'].includes(x[3])) return null;
  const arrows = (typeof x[4] === 'string' ? x[4].split(' ') : [])
    .map((u) => UCI.exec(u)).filter((m) => m && m[1] !== m[2]).slice(0, 6).map((m) => [m[1], m[2]]);
  const squares = [...new Set((typeof x[5] === 'string' ? x[5].split(' ') : []).filter((s) => SQ.test(s)))].slice(0, 6);
  return { plies, keys, side: x[2], out: x[3], arrows, squares, note: text(x[6], 140) };
};

// Everything the analysis board shows of a game's Game Review. `tree`: the
// board's tree for the game (its trunk the game's moves); `side`: whose game it
// is ('white' | 'black'), for "yours" and "theirs". Null when there's nothing.
export function reviewOnBoard({ tree, moves = [], startFen = null, records, side = null }) {
  const A = parseAn(records?.an) ?? {};
  const engine = parseEngineReview(records?.rv, moves);
  const note = text(records?.note, 10000).trim();
  const larry = text(records?.lr, 10000).trim();
  const W = treeWalker(tree, startFen || START_FEN);
  const me = side === 'white' ? 'w' : side === 'black' ? 'b' : null;

  const notes = {};
  const ownBadges = {};
  const engineBadges = {};
  const marks = {};
  const drawn = {}; // the arrows and squares drawn (m) alone — what the board edits
  const lineColors = {};
  const clamp = {};
  const tactics = {};
  const mark = (id) => { marks[id] ??= { arrows: [], squares: {} }; return marks[id]; };
  const list = (k) => (Array.isArray(A[k]) ? A[k] : []);

  // Side lines first, so every ref below finds its node.
  for (const L of list('l')) W.resolve(L);
  for (const x of list('c')) {
    const id = Array.isArray(x) ? W.resolve(x[0]) : null;
    const t = Array.isArray(x) ? text(x[1]).trim() : '';
    if (id && t) notes[id] = t;
  }
  for (const x of list('m')) {
    const id = Array.isArray(x) ? W.resolve(x[0]) : null;
    if (!id) continue;
    for (const t of String(x[1] ?? '').split(' ')) {
      const m = /^([A-Z])([a-h][1-8])([a-h][1-8])$/.exec(t);
      if (m && PEN_HEX[m[1]] && m[2] !== m[3] && mark(id).arrows.length < 24) mark(id).arrows.push([m[2], m[3], PEN_HEX[m[1]]]);
    }
    for (const t of String(x[2] ?? '').split(' ')) {
      const m = /^([A-Z])([a-h][1-8])$/.exec(t);
      if (m && PEN_HEX[m[1]]) mark(id).squares[m[2]] = PEN_HEX[m[1]];
    }
    if (marks[id]) drawn[id] = { arrows: [...marks[id].arrows], squares: { ...marks[id].squares } };
  }
  for (const x of list('b')) {
    const id = Array.isArray(x) && x[0] !== 0 ? W.resolve(x[0]) : null;
    if (id && id !== 'root' && BADGE_OF_CODE[x[1]]) ownBadges[id] = BADGE_OF_CODE[x[1]];
  }
  if (engine) {
    engine.badges.forEach((b, i) => {
      const id = W.nodeAtPly(i + 1);
      if (b && id) engineBadges[id] = b;
    });
  }
  for (const x of list('h')) {
    const id = Array.isArray(x) && Array.isArray(x[0]) ? W.resolve(x[0]) : null;
    const root = id ? branchRoot(W.tree(), id) : null;
    if (root && LINE_COLOR[x[1]]) lineColors[root] = LINE_COLOR[x[1]];
  }

  // CLAMP: yours (k, with their squares q) and their slips (o); yours wins a move and letter.
  const clampAt = (ply, letter, entry) => {
    const id = W.nodeAtPly(ply);
    if (!id || !CLAMP[letter]) return;
    clamp[id] ??= [];
    if (clamp[id].some((c) => c.letter === letter)) return;
    clamp[id].push({ letter, ...CLAMP[letter], ...entry });
  };
  const sqOf = new Map();
  for (const x of list('q')) {
    if (Array.isArray(x) && Number.isInteger(x[0]) && CLAMP[x[1]] && SQ.test(x[2])) {
      const k = `${x[0]}${x[1]}`;
      sqOf.set(k, [...new Set([...(sqOf.get(k) ?? []), x[2]])].slice(0, 4));
    }
  }
  for (const x of list('k')) {
    if (Array.isArray(x) && Number.isInteger(x[0])) {
      clampAt(x[0], x[1], { theirs: false, note: text(x[2], 140), out: '', squares: sqOf.get(`${x[0]}${x[1]}`) ?? [] });
    }
  }
  for (const x of list('o')) {
    if (Array.isArray(x) && Number.isInteger(x[0])) {
      const squares = [...new Set(String(x[4] ?? '').split(' ').filter((s) => SQ.test(s)))].slice(0, 4);
      clampAt(x[0], x[1], { theirs: true, note: text(x[2], 140), out: x[3] === 'p' || x[3] === 'm' ? x[3] : '', squares });
    }
  }
  for (const id of Object.keys(clamp)) {
    clamp[id].sort((a, b) => CLAMP_ORDER.indexOf(a.letter) - CLAMP_ORDER.indexOf(b.letter));
    for (const c of clamp[id]) for (const s of c.squares) mark(id).squares[s] ??= c.color;
  }

  // Tactics: on each move of the chance, its arrows and pieces in the position after it.
  const taken = new Set();
  for (const x of list('t')) {
    const c = tacticRow(x);
    if (!c || c.plies.some((p) => taken.has(p))) continue;
    c.plies.forEach((p) => taken.add(p));
    const mine = me ? c.side === me : null;
    const names = c.keys.map((k) => TACTIC_NAMES[k]);
    c.plies.forEach((p, i) => {
      const id = W.nodeAtPly(p);
      if (!id) return;
      const last = i === c.plies.length - 1;
      (tactics[id] ??= []).push({ ...c, names, mine, last, words: tacticWords(c, mine) });
      for (const [f, t] of c.arrows) if (mark(id).arrows.length < 24) mark(id).arrows.push([f, t, TACTIC_COLOR]);
      for (const s of c.squares) mark(id).squares[s] ??= TACTIC_COLOR;
    });
  }

  const any = Object.keys(notes).length || Object.keys(ownBadges).length || Object.keys(engineBadges).length
    || Object.keys(marks).length || Object.keys(lineColors).length || Object.keys(clamp).length
    || Object.keys(tactics).length || note || larry;
  if (!any) return null;
  return {
    tree: W.tree(),
    notes,
    ownBadges,
    engineBadges,
    marks,
    drawn,
    lineColors,
    clamp,
    tactics,
    note,
    larry,
    accuracy: engine?.accuracy ?? null,
    depth: engine?.depth ?? null,
  };
}

// A chance in words, the way Chess Arcade's card says it.
export function tacticWords(c, mine) {
  const col = c.side === 'w' ? 'White' : 'Black';
  const how = c.out === 'p' ? 'played it' : c.out === 'e' ? 'the game ended here' : 'missed it';
  if (mine == null) return c.out === 'e' ? `${col} had it; the game ended here.` : `${col} had it and ${how}.`;
  if (mine) return c.out === 'e' ? `You (${col}) had it; the game ended here.` : `You (${col}) had it and ${how}.`;
  return c.out === 'e' ? 'Your move allowed it; the game ended here.' : `Your move allowed it. They (${col}) ${how}.`;
}

// The badge a move shows: the board's own, else one set in Game Review, else the engine's.
export const badgeShown = (nodeId, own, review) => own?.[nodeId] ?? review?.ownBadges?.[nodeId] ?? review?.engineBadges?.[nodeId] ?? null;

// The marks at a node: the board's own and the review's, together (the board's win a square).
export function marksWith(own, reviewMarks) {
  if (!reviewMarks) return own;
  const arrows = [...(own?.arrows ?? [])];
  for (const a of reviewMarks.arrows) if (!arrows.some((b) => b[0] === a[0] && b[1] === a[1])) arrows.push(a);
  return { arrows, squares: { ...reviewMarks.squares, ...(own?.squares ?? {}) } };
}

// The move list's marks on each move (MoveTree's chips): CLAMP letters (theirs
// hollow) and a dot for a tactic, what each says in its title.
export function chipsOf(review) {
  if (!review) return null;
  const out = {};
  for (const [id, list] of Object.entries(review.clamp ?? {})) {
    out[id] = list.map((c) => ({
      key: `c${c.letter}${c.theirs ? 't' : ''}`,
      text: c.letter,
      color: c.color,
      hollow: c.theirs,
      title: `${c.name}${c.theirs ? ` — their slip${c.out === 'p' ? ', punished' : c.out === 'm' ? ', missed' : ''}` : ''}${c.note ? `: ${c.note}` : ''}`,
    }));
  }
  for (const [id, list] of Object.entries(review.tactics ?? {})) {
    for (const t of list) {
      const done = t.last && t.mine && (t.out === 'p' || t.out === 'm');
      (out[id] ??= []).push({
        key: `t${t.plies[0]}`,
        text: done ? (t.out === 'p' ? '✓' : '✕') : 'T',
        color: TACTIC_COLOR,
        hollow: false,
        title: `${t.names.join(', ')} — ${t.words}${t.note ? ` ${t.note}` : ''}`,
      });
    }
  }
  return out;
}

// Where a node is, the way Game Review opens at a move (Chess Arcade's refs):
// { ply } on the game, or { line: [the ply it leaves from, uci…] }; null when
// the tree doesn't have it.
export function refOf(tree, nodeId, startFen = null) {
  if (!nodeId || nodeId === 'root') return { ply: 0 };
  const path = nodePath(tree, nodeId);
  if (!path.length) return null;
  let parent = tree;
  let i = 0;
  while (i < path.length && parent.children[0]?.id === path[i].id) { parent = path[i]; i += 1; }
  if (i === path.length) return { ply: i };
  let g;
  try { g = new Chess(startFen || START_FEN); } catch { return null; }
  const ucis = [];
  for (let k = 0; k < path.length; k += 1) {
    let m = null;
    try { m = g.move(path[k].san); } catch { m = null; }
    if (!m) return null;
    if (k >= i) ucis.push(`${m.from}${m.to}${m.promotion ?? ''}`);
  }
  return ucis.length <= 60 ? { line: [i, ...ucis] } : null;
}
