// A reviewed game, read like a book: the student's reader (ReviewReader)
// renders only what this module derives from an analysis document
// (lib/analysisDoc) — positions, move numbers, the prose with the coach's
// notes and the variations woven in where they branch, and what to draw on
// the board at each move. Pure: tests/reviewText.test.mjs.
import { Chess } from 'chess.js';
import { START_FEN, moveNumberLabel } from './startPos';
import { parseMarks } from './marks';
import {
  walkNodes, mainLineFrom, gameLineOf, notesOnNodes, nodePath,
} from './moveTree';

// Everything the reader needs to know about each move, by node id.
export function reviewModel(doc) {
  const startFen = doc.startFen ?? START_FEN;
  const tree = doc.tree;
  const info = { root: { id: 'root', parentId: null, fen: new Chess(startFen).fen(), depth: 0, san: null } };
  walkNodes(tree, (n, parent) => {
    if (!parent) return;
    const from = info[parent.id];
    const g = new Chess(from.fen);
    let mv = null;
    try { mv = g.move(n.san); } catch { /* sanitized already; a bad move just ends here */ }
    info[n.id] = {
      id: n.id,
      parentId: parent.id,
      san: n.san,
      depth: from.depth + 1,
      fen: mv ? g.fen() : from.fen,
      lastMove: mv ? { from: mv.from, to: mv.to } : null,
      number: moveNumberLabel(from.depth, startFen, '…'),
    };
  });
  const { notes, badges } = notesOnNodes(tree);
  const gameLine = gameLineOf(tree, doc.moves.length);
  return {
    startFen,
    tree,
    moves: doc.moves,
    info,
    notes,
    badges,
    gameIds: new Set(gameLine.map((n) => n.id)),
    trunk: mainLineFrom(tree),
    annotations: doc.annotations ?? {},
    highlights: doc.variationHighlights ?? {},
  };
}

// The SAN from the start to a node, then on down its main continuation — the
// line a note on that node talks about (what its move references resolve
// against).
export function lineMovesThrough(model, id) {
  const node = id === 'root' ? model.tree : null;
  const path = node ? [] : nodePath(model.tree, id);
  const tail = mainLineFrom(path.length ? path[path.length - 1] : model.tree);
  return [...path, ...tail].map((n) => n.san);
}

// The prose, as blocks:
//   { kind: 'note', id }                   a note (id 'root' = the summary)
//   { kind: 'moves', ids: [id] }           a run of moves
//   { kind: 'line', rootId, depth, blocks } a variation, set in like a book
// A variation follows the move it's an alternative to, as MoveTree lists it.
export function reviewBlocks(model, { maxDepth = 6 } = {}) {
  const out = [];
  // A note is only a paragraph if it has words: an imported game's clock and
  // eval readings ([%clk] …) on every move would otherwise break the text
  // into one move per line. Its arrows still draw (marksAtNode).
  const says = (id) => Boolean(noteText(model.notes[id] ?? ''));
  if (says('root')) out.push({ kind: 'note', id: 'root' });
  const lineFrom = (start, depth) => {
    const blocks = [];
    let run = [];
    const flush = () => { if (run.length) blocks.push({ kind: 'moves', ids: run }); run = []; };
    let parent = start.parent;
    let n = start.node;
    while (n) {
      run.push(n.id);
      if (says(n.id)) { flush(); blocks.push({ kind: 'note', id: n.id }); }
      // The other moves that could have been played instead of this one.
      const alts = parent ? parent.children.slice(1) : [];
      if (parent && parent.children[0] === n && alts.length) {
        flush();
        for (const alt of alts) {
          const inner = depth + 1 > maxDepth
            ? [{ kind: 'moves', ids: mainLineFrom({ children: [alt] }).map((x) => x.id) }]
            : lineFrom({ parent, node: alt }, depth + 1);
          blocks.push({
            kind: 'line', rootId: alt.id, depth: depth + 1, blocks: inner,
          });
        }
      }
      parent = n;
      [n] = n.children;
    }
    flush();
    return blocks;
  };
  const first = model.tree.children[0];
  if (first) out.push(...lineFrom({ parent: model.tree, node: first }, 0));
  return out;
}

// Studio's style for a drawn square — see AnalysisView — as backgroundColor
// (the shorthand would wipe the move badge the board draws on that square).
export const drawnSquareStyle = (colour) => (String(colour).startsWith('#')
  ? { backgroundColor: `${colour}66`, boxShadow: `inset 0 0 0 3px ${colour}` }
  : { backgroundColor: colour });

// What's drawn on the board at a move: the coach's own drawing of that
// position if there is one, else the arrows and squares written into the
// move's note ([%cal] / [%csl]). One or the other — the same arrow never
// twice.
export function marksAtNode(model, id) {
  const fen = model.info[id]?.fen;
  const drawing = fen ? model.annotations[fen] : null;
  if (drawing && (drawing.arrows?.length || Object.keys(drawing.squares ?? {}).length)) {
    return { arrows: drawing.arrows ?? [], squares: drawing.squares ?? {} };
  }
  const note = model.notes[id];
  if (!note) return { arrows: [], squares: {} };
  const { arrows, squares } = parseMarks(note);
  const seen = new Set();
  return {
    arrows: arrows.filter(([f, t]) => (seen.has(`${f}${t}`) ? false : seen.add(`${f}${t}`))),
    squares,
  };
}

// A note's words, without its drawing commands.
export const noteText = (raw) => parseMarks(raw).text;
