// A game's analysis as one self-contained document: the shape a coach's
// review of a student's game is kept and sent in, and what the review reader
// reads — for a game with the analysis in its own fields too (docFromGame).
//
//   { v: 1,
//     moves: [san],                 the game line it was written against
//     startFen?: fen,               only when that isn't the normal start
//     tree: node,                   the game line as the main line, variations
//                                   off it; node = { id, san, children,
//                                   note?, badge? }. root.note is the summary.
//     annotations: { fen: { arrows: [[from, to, colour]], squares: { sq: colour } } },
//     variationHighlights: { branchRootId: 'green' | 'blue' | 'yellow' } }
//
// Everything is pure, so tests/analysisDoc.test.mjs covers it.
import { Chess } from 'chess.js';
import { START_FEN, isStandardStart } from './startPos';
import { BADGE_BY_ID } from './badges';
import { START } from './marks';
import {
  trunkTree, anchorToGame, gameLineOf, notesOnNodes, withNotesOnNodes, hasVariations, mainLineFrom,
} from './moveTree';
import { stableStringify } from './cloud/gameLink';

export const DOC_VERSION = 1;
export const MAX_NOTE = 5000;
// A review lives inside one Firestore document with the rest of a section's
// games (1 MiB, counted in bytes) — on the coach's card and in the student's
// games — so it's kept well short of that.
export const MAX_REVIEW_BYTES = 150000;
const MAX_NODES = 4000;
const MAX_DEPTH = 600;
const MAX_MARKS = 64;
const SLOTS = ['green', 'blue', 'yellow'];

const SQ = /^[a-h][1-8]$/;
const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]{5,40}\))$/i;
// Node ids are map keys (variationHighlights) wherever a tree is stored as an
// object, and Firestore refuses keys like "__x__" — so ids start with a letter
// or digit.
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const FEN_KEY = /^[1-8pnbrqkPNBRQK/]{15,90} [wb] (?:[KQkq]{1,4}|-) (?:[a-h][36]|-)(?: \d{1,4} \d{1,4})?$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v.slice(0, MAX_NOTE) : '');

export const serializeDoc = (doc) => stableStringify(doc);
export const docBytes = (json) => new TextEncoder().encode(json).length;

// Arrows and squares, kept only where there's something drawn.
export function pruneAnnotations(annotations) {
  const out = {};
  for (const [fen, m] of Object.entries(annotations ?? {})) {
    if ((m?.arrows?.length ?? 0) > 0 || Object.keys(m?.squares ?? {}).length > 0) out[fen] = m;
  }
  return out;
}

// A game's own analysis fields, as a document. The game line's notes and
// badges are the game's comments and badges by move (what every other reader
// of a game uses); a saved tree carries the rest on its nodes.
export function docFromGame(game) {
  const moves = Array.isArray(game?.moves) ? game.moves : [];
  const saved = isObj(game?.tree) ? game.tree : null;
  const tree = anchorToGame(saved ?? trunkTree(moves), moves);
  const line = gameLineOf(tree, moves.length);
  const { notes, badges } = notesOnNodes(tree);
  delete notes.root;
  delete badges.root;
  line.forEach((n, i) => {
    delete notes[n.id];
    delete badges[n.id];
    const c = game?.comments?.[i];
    if (typeof c === 'string' && c) notes[n.id] = c;
    const b = game?.badges?.[i];
    if (typeof b === 'string' && b) badges[n.id] = b;
  });
  const intro = game?.comments?.[START];
  if (typeof intro === 'string' && intro) notes.root = intro;
  return {
    v: DOC_VERSION,
    moves,
    tree: withNotesOnNodes(tree, notes, badges),
    annotations: pruneAnnotations(game?.annotations),
    variationHighlights: isObj(game?.variationHighlights) ? game.variationHighlights : {},
  };
}

// And back: what goes in the game's own fields. The tree is kept only when it
// holds more than the game line — a variation, a move past the end, a note
// off the line, a coloured branch — so removing all of that and saving again
// drops it rather than leaving a stale copy behind.
export function gameFieldsFromDoc(doc) {
  const { moves, tree } = doc;
  const line = gameLineOf(tree, moves.length);
  const onLine = new Set(['root', ...line.map((n) => n.id)]);
  const { notes, badges } = notesOnNodes(tree);
  const comments = {};
  const byMove = {};
  line.forEach((n, i) => {
    if (notes[n.id]) comments[i] = notes[n.id];
    if (badges[n.id]) byMove[i] = badges[n.id];
  });
  if (notes.root) comments[START] = notes.root;
  const offLine = Object.keys(notes).some((id) => !onLine.has(id)) || Object.keys(badges).some((id) => !onLine.has(id));
  const highlights = isObj(doc.variationHighlights) ? doc.variationHighlights : {};
  const keep = hasVariations(tree) || mainLineFrom(tree).length > moves.length
    || offLine || Object.keys(highlights).length > 0;
  return {
    comments,
    badges: byMove,
    annotations: pruneAnnotations(doc.annotations),
    tree: keep ? withNotesOnNodes(tree, notes, badges, onLine) : undefined,
    variationHighlights: keep && Object.keys(highlights).length ? highlights : undefined,
  };
}

// What a save has to write to a game: only what changed since the board
// opened, entry by entry — so a note the student changed meanwhile on a move
// the coach never touched is left as the student has it.
export function diffGameFields(before, after) {
  const set = { comments: {}, badges: {}, annotations: {} };
  const del = { comments: [], badges: [], annotations: [] };
  let changes = 0;
  for (const k of ['comments', 'badges', 'annotations']) {
    const a = before?.[k] ?? {};
    const b = after?.[k] ?? {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (stableStringify(a[key] ?? null) === stableStringify(b[key] ?? null)) continue;
      changes += 1;
      if (b[key] == null) del[k].push(key); else set[k][key] = b[key];
    }
  }
  const tb = stableStringify({ t: before?.tree ?? null, h: before?.variationHighlights ?? null });
  const ta = stableStringify({ t: after?.tree ?? null, h: after?.variationHighlights ?? null });
  const tree = tb === ta ? undefined : { tree: after?.tree ?? null, variationHighlights: after?.variationHighlights ?? null };
  if (tree) changes += 1;
  return { set, del, tree, changes };
}

// Nothing in it worth sending: no note, badge, drawing, variation or colour.
export function docIsEmpty(doc) {
  if (!doc) return true;
  const { notes, badges } = notesOnNodes(doc.tree);
  return Object.keys(notes).length === 0 && Object.keys(badges).length === 0
    && Object.keys(pruneAnnotations(doc.annotations)).length === 0
    && !hasVariations(doc.tree) && mainLineFrom(doc.tree).length <= doc.moves.length
    && Object.keys(doc.variationHighlights ?? {}).length === 0;
}

function cleanMarks(m) {
  if (!isObj(m)) return null;
  const arrows = (Array.isArray(m.arrows) ? m.arrows : []).slice(0, MAX_MARKS)
    .filter((a) => Array.isArray(a) && SQ.test(a[0]) && SQ.test(a[1]) && COLOUR.test(String(a[2] ?? '')))
    .map((a) => [a[0], a[1], a[2]]);
  const squares = {};
  if (isObj(m.squares)) {
    for (const [sq, c] of Object.entries(m.squares).slice(0, MAX_MARKS)) {
      if (SQ.test(sq) && COLOUR.test(String(c ?? ''))) squares[sq] = c;
    }
  }
  return arrows.length || Object.keys(squares).length ? { arrows, squares } : null;
}

// A document from somewhere else — another account, or storage — rebuilt from
// what's allowed and nothing more: the sender's object is never kept as it
// came. Every move is replayed (an illegal one drops its whole subtree), notes
// are cut to length, unknown badges and anything malformed are dropped one by
// one rather than failing the whole thing, and the game line is made the main
// line. Null only for something that isn't a document at all.
export function sanitizeDoc(raw) {
  if (!isObj(raw)) return null;
  let startFen = START_FEN;
  if (typeof raw.startFen === 'string' && raw.startFen.length <= 100) {
    try { startFen = new Chess(raw.startFen).fen(); } catch { return null; }
  }
  const moves = [];
  if (Array.isArray(raw.moves)) {
    const g = new Chess(startFen);
    for (const m of raw.moves.slice(0, 1000)) {
      if (typeof m !== 'string' || m.length > 12) break;
      try { moves.push(g.move(m).san); } catch { break; }
    }
  }

  const ids = new Set(['root']);
  let fresh = 0;
  const idFor = (id) => {
    if (typeof id === 'string' && ID.test(id) && !ids.has(id)) { ids.add(id); return id; }
    let n;
    do { fresh += 1; n = `x${fresh}`; } while (ids.has(n));
    ids.add(n);
    return n;
  };
  const annotate = (out, from) => {
    const note = text(from?.note).trim();
    if (note) out.note = note;
    if (typeof from?.badge === 'string' && BADGE_BY_ID[from.badge]) out.badge = from.badge;
    return out;
  };
  const root = annotate({ id: 'root', san: null, children: [] }, isObj(raw.tree) ? raw.tree : null);
  let count = 0;
  const stack = [[isObj(raw.tree) ? raw.tree : { children: [] }, root, startFen, 0]];
  while (stack.length) {
    const [from, to, fen, depth] = stack.pop();
    if (depth >= MAX_DEPTH || !Array.isArray(from.children)) continue;
    for (const c of from.children.slice(0, 64)) {
      if (count >= MAX_NODES) break;
      if (!isObj(c) || typeof c.san !== 'string' || c.san.length > 12) continue;
      const g = new Chess(fen);
      let san;
      try { san = g.move(c.san).san; } catch { continue; }
      if (to.children.some((x) => x.san === san)) continue;
      const node = annotate({ id: idFor(c.id), san, children: [] }, c);
      to.children.push(node);
      count += 1;
      stack.push([c, node, g.fen(), depth + 1]);
    }
  }
  const tree = anchorToGame(root, moves);

  const variationHighlights = {};
  if (isObj(raw.variationHighlights)) {
    for (const [id, c] of Object.entries(raw.variationHighlights)) {
      if (ids.has(id) && SLOTS.includes(c)) variationHighlights[id] = c;
    }
  }
  const annotations = {};
  if (isObj(raw.annotations)) {
    for (const [fen, m] of Object.entries(raw.annotations).slice(0, MAX_NODES)) {
      if (fen.length > 100 || !FEN_KEY.test(fen)) continue;
      const clean = cleanMarks(m);
      if (clean) annotations[fen] = clean;
    }
  }
  return {
    v: DOC_VERSION,
    moves,
    ...(isStandardStart(startFen) ? {} : { startFen }),
    tree,
    annotations,
    variationHighlights,
  };
}

// A stored or sent document, read back. Anything unreadable reads as nothing.
export function parseDoc(json) {
  if (typeof json !== 'string' || json.length > 4 * MAX_REVIEW_BYTES) return null;
  try { return sanitizeDoc(JSON.parse(json)); } catch { return null; }
}
