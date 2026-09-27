// Browse tree: moves played on the board, matched against the chapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { mergeVariations, treeMove, treeTargets } from '../src/lib/repertoireTree.js';

const v = (id, moves) => ({ id, name: id, moves });
const tree = mergeVariations([
  v('a', ['e4', 'c6', 'd4', 'd5']),
  v('b', ['e4', 'e5', 'Nf3']),
  v('c', ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5', 'Nb3', 'Be6', 'f3', 'Be7', 'Qd2', 'O-O', 'O-O-O']),
]);
const START = new Chess().fen();
const after = (moves) => { const g = new Chess(); moves.forEach((m) => g.move(m)); return g.fen(); };

test('after 1.e4, Black\'s moves play: the ones in the chapter go down the tree', () => {
  const e4 = treeMove(Chess, tree, START, 0, 'e2', 'e4').child;
  assert.equal(e4.san, 'e4');
  const fen = after(['e4']);
  assert.equal(treeMove(Chess, e4, fen, 1, 'c7', 'c6').child.san, 'c6');
  assert.equal(treeMove(Chess, e4, fen, 1, 'e7', 'e5').child.san, 'e5');
});

test('a legal move the chapter doesn\'t have says what it plays instead; an illegal one is nothing', () => {
  const e4 = tree.children[0];
  const off = treeMove(Chess, e4, after(['e4']), 1, 'g8', 'f6');
  assert.deepEqual(off.offBook, { san: '1…Nf6', theirs: ['1…c6', '1…e5', '1…c5'] });
  assert.equal(treeMove(Chess, e4, after(['e4']), 1, 'c7', 'c4'), null);
});

test('castling by moving the king two squares, and the rings for a picked piece', () => {
  const moves = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5', 'Nb3', 'Be6', 'f3', 'Be7', 'Qd2', 'O-O'];
  let node = tree;
  for (const m of moves) node = node.children.find((c) => c.san === m);
  assert.equal(treeMove(Chess, node, after(moves), moves.length, 'e1', 'c1').child.san, 'O-O-O');
  assert.deepEqual(treeTargets(Chess, tree, START, 'e2'), ['e4']);
  assert.deepEqual(treeTargets(Chess, tree, START, 'd2'), []);
});
