// Saved Board Editor positions: folders and order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  folderNames, groupPositions, addPosition, renamePosition, setFolder,
  canMove, movePosition, renameFolder, renameFolderInOrder,
} from '../src/lib/savedPositions.js';

const P = (id, folder) => ({ id, name: id.toUpperCase(), fen: '8/8/8/8/8/8/8/8 w - - 0 1', ...(folder ? { folder } : {}) });
const ids = (list) => list.map((p) => p.id).join('');
const shape = (list) => groupPositions(list).map((g) => `${g.folder || '-'}:${ids(g.items)}`).join(' ');

test('folders read A–Z with the unfiled ones last; positions keep the list order inside', () => {
  const list = [P('a'), P('b', 'Rook endgames'), P('c', 'pawn endgames'), P('d', 'Rook endgames'), P('e')];
  assert.deepEqual(folderNames(list), ['pawn endgames', 'Rook endgames']);
  assert.equal(shape(list), 'pawn endgames:c Rook endgames:bd -:ae');
  assert.equal(shape([P('a'), P('b')]), '-:ab', 'no folders at all: one plain group');
  assert.equal(shape([]), '');
});

test('a new position goes to the bottom', () => {
  assert.equal(ids(addPosition([P('a'), P('b')], P('c'))), 'abc');
});

test('rename keeps the id and ignores a blank name', () => {
  const list = [P('a'), P('b')];
  const out = renamePosition(list, 'b', '  Lucena  ', 5);
  assert.equal(out[1].name, 'Lucena');
  assert.equal(out[1].id, 'b');
  assert.equal(out[1].updatedAt, 5);
  assert.equal(renamePosition(list, 'b', '   '), list);
});

test('moving to a folder lands at the bottom of that folder', () => {
  const list = [P('a', 'R'), P('b'), P('c', 'R'), P('d')];
  const out = setFolder(list, 'd', 'R', 7);
  assert.equal(ids(out), 'abcd', 'right after the last one already in it');
  assert.equal(shape(out), 'R:acd -:b');
  assert.equal(out[3].updatedAt, 7);
  assert.equal(shape(setFolder(list, 'a', '')), 'R:c -:bda', 'out of a folder: bottom of the unfiled');
  assert.equal(shape(setFolder(list, 'b', 'New')), 'New:b R:ac -:d', 'a new folder is made by filing into it');
  assert.equal(setFolder(list, 'a', 'R'), list, 'same folder: nothing changes');
});

test('move up and down step over positions in other folders', () => {
  const list = [P('a', 'R'), P('b'), P('c', 'R'), P('d', 'R')];
  assert.equal(shape(movePosition(list, 'c', -1)), 'R:cad -:b');
  assert.equal(shape(movePosition(list, 'c', 1)), 'R:adc -:b');
  assert.equal(canMove(list, 'a', -1), false);
  assert.equal(canMove(list, 'd', 1), false);
  assert.equal(canMove(list, 'b', -1), false, 'alone in the unfiled group');
  assert.equal(movePosition(list, 'a', -1), list);
});

test('renaming a folder renames it on everything inside, and can merge two', () => {
  const list = [P('a', 'R'), P('b', 'Pawns'), P('c', 'R')];
  assert.equal(shape(renameFolder(list, 'R', 'Rook endgames')), 'Pawns:b Rook endgames:ac');
  assert.equal(shape(renameFolder(list, 'R', 'Pawns')), 'Pawns:abc');
  assert.equal(renameFolder(list, 'R', ' '), list);
});

test('folders follow the arranged order; ones it does not name follow A–Z', () => {
  const list = [P('a', 'Tactics'), P('b', 'Basic Checkmates'), P('c', 'Endgames'), P('d'), P('e', 'Opening')];
  assert.deepEqual(folderNames(list), ['Basic Checkmates', 'Endgames', 'Opening', 'Tactics'], 'never arranged: A–Z');
  assert.deepEqual(
    folderNames(list, ['Opening', 'Tactics', 'Basic Checkmates', 'Endgames']),
    ['Opening', 'Tactics', 'Basic Checkmates', 'Endgames'],
  );
  // A folder made since joins after the arranged ones; a folder that's gone is skipped.
  assert.deepEqual(folderNames(list, ['Tactics', 'Gone']), ['Tactics', 'Basic Checkmates', 'Endgames', 'Opening']);
  assert.equal(
    groupPositions(list, ['Opening', 'Tactics']).map((g) => g.folder || '-').join(),
    'Opening,Tactics,Basic Checkmates,Endgames,-',
    'no folder stays last',
  );
});

test('a renamed folder keeps its place in the order', () => {
  assert.deepEqual(renameFolderInOrder(['A', 'B', 'C'], 'B', 'Bee'), ['A', 'Bee', 'C']);
  assert.deepEqual(renameFolderInOrder(['A', 'B', 'C'], 'B', 'C'), ['A', 'C'], 'merged into C, in C\'s place');
  assert.deepEqual(renameFolderInOrder([], 'B', 'Bee'), []);
});
