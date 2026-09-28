// The reviewed game as the student reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewModel, reviewBlocks, marksAtNode, lineMovesThrough, drawnSquareStyle,
} from '../src/lib/reviewText.js';
import { docFromGame } from '../src/lib/analysisDoc.js';
import { makeTree, addMove, gameLineOf, withNotesOnNodes } from '../src/lib/moveTree.js';

const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'];

function sample() {
  let t = makeTree(moves);
  const line = gameLineOf(t, moves.length);
  // 2.Nc3 instead of 2.Nf3, and 2...Nf6 in reply inside it; 1...c5 instead of 1...e5.
  const alt = addMove(t, line[1].id, 'Nc3'); t = alt.tree;
  const inner = addMove(t, alt.nodeId, 'Nf6'); t = inner.tree;
  const sic = addMove(t, line[0].id, 'c5'); t = sic.tree;
  const notes = { root: 'A Ruy Lopez.', [line[2].id]: 'The main move [%cal Gf3e5]', [alt.nodeId]: 'The Vienna.' };
  const doc = docFromGame({ moves });
  doc.tree = withNotesOnNodes(t, notes, { [line[4].id]: 'good' });
  return { doc, line, alt, sic };
}

test('each move knows its position, number and place', () => {
  const { doc, line, alt } = sample();
  const m = reviewModel(doc);
  assert.equal(m.info[line[2].id].number, '2.');
  assert.equal(m.info[line[3].id].number, '2…');
  assert.equal(m.info[alt.nodeId].number, '2.');
  assert.equal(m.info[line[0].id].fen.split(' ')[0], 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
  assert.deepEqual(m.info[line[0].id].lastMove, { from: 'e2', to: 'e4' });
  assert.ok(m.gameIds.has(line[4].id));
  assert.ok(!m.gameIds.has(alt.nodeId));
  assert.equal(m.badges[line[4].id], 'good');
  assert.deepEqual(lineMovesThrough(m, alt.nodeId), ['e4', 'e5', 'Nc3', 'Nf6']);
});

test('the prose: summary, runs of moves, notes, and variations where they branch', () => {
  const { doc, line, alt, sic } = sample();
  const blocks = reviewBlocks(reviewModel(doc));
  assert.deepEqual(blocks[0], { kind: 'note', id: 'root' });
  // 1.e4 e5 — then 1...c5 as an alternative to 1...e5
  const kinds = blocks.map((b) => b.kind);
  assert.deepEqual(kinds, ['note', 'moves', 'line', 'moves', 'note', 'line', 'moves']);
  assert.deepEqual(blocks[1].ids, [line[0].id, line[1].id]);
  assert.equal(blocks[2].rootId, sic.nodeId);
  assert.deepEqual(blocks[3].ids, [line[2].id]); // 2.Nf3, then its note
  assert.equal(blocks[5].rootId, alt.nodeId);
  // Inside the 2.Nc3 line: the move, its note, then 2...Nf6.
  assert.deepEqual(blocks[5].blocks.map((b) => b.kind), ['moves', 'note', 'moves']);
  assert.deepEqual(blocks[6].ids, [line[3].id, line[4].id]);
});

test('drawn on the board: the coach’s drawing first, else the note’s own arrows', () => {
  const { doc, line } = sample();
  let m = reviewModel(doc);
  assert.deepEqual(m && marksAtNode(m, line[2].id).arrows.map((a) => a.slice(0, 2)), [['f3', 'e5']]);
  const fen = m.info[line[2].id].fen;
  doc.annotations = { [fen]: { arrows: [['b1', 'c3', '#e5534b']], squares: { e5: '#2ecc71' } } };
  m = reviewModel(doc);
  assert.deepEqual(marksAtNode(m, line[2].id), { arrows: [['b1', 'c3', '#e5534b']], squares: { e5: '#2ecc71' } });
  assert.deepEqual(marksAtNode(m, line[0].id), { arrows: [], squares: {} });
  assert.equal(drawnSquareStyle('#2ecc71').backgroundColor, '#2ecc7166');
});

test('the same game read twice is the same tree; clock readings aren’t paragraphs', () => {
  const g = { moves, comments: { 0: '[%clk 0:03:00]', 1: '[%clk 0:02:59]', 2: 'Develops. [%clk 0:02:58]' } };
  const a = reviewModel(docFromGame(g));
  const b = reviewModel(docFromGame(g));
  assert.deepEqual(a.trunk.map((n) => n.id), b.trunk.map((n) => n.id));
  const blocks = reviewBlocks(a);
  assert.deepEqual(blocks.map((x) => x.kind), ['moves', 'note', 'moves']);
});
