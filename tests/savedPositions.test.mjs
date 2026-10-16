// Saved Board Editor positions: folders and order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  folderNames, groupPositions, addPosition, renamePosition, setFolder,
  canMove, movePosition, renameFolder, renameFolderInOrder,
  ownerOf, positionsFor, folderOrderFor, withFolderOrder,
  recycledCopy, recyclePosition, recyclePositions, alreadyIn, nextLessonName, lessonNamed,
  listsBytes, LISTS_BYTES_WARN,
} from '../src/lib/savedPositions.js';

const P = (id, folder, ownerId) => ({
  id, name: id.toUpperCase(), fen: '8/8/8/8/8/8/8/8 w - - 0 1', ...(folder ? { folder } : {}), ...(ownerId ? { ownerId } : {}),
});
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

test('numbers in folder names read in order: Lesson 2 before Lesson 10', () => {
  const list = [P('a', 'Lesson 10'), P('b', 'Lesson 2'), P('c', 'Lesson 1')];
  assert.deepEqual(folderNames(list), ['Lesson 1', 'Lesson 2', 'Lesson 10']);
});

// ---------------------------------------------------------------------------
// Whose a position is: the coach's own, or a student's lesson.
// ---------------------------------------------------------------------------

const W = 'card-wavy';
const B = 'card-bo';
// The coach and Wavy both have a "Lesson 1"; they're two different folders.
const mixed = () => [P('a', 'Lesson 1'), P('w1', 'Lesson 1', W), P('b', 'Lesson 1'), P('w2', 'Lesson 1', W), P('c')];
const shapeOf = (list, owner) => shape(positionsFor(list, owner));

test('each owner sees their own positions; no owner is the coach\'s', () => {
  const list = mixed();
  assert.equal(ids(positionsFor(list, null)), 'abc');
  assert.equal(ids(positionsFor(list, W)), 'w1w2');
  assert.equal(ids(positionsFor(list, B)), '');
  assert.equal(ownerOf(P('x')), null);
  assert.equal(ownerOf({ id: 'x', ownerId: '' }), null, 'a blank owner is nobody\'s, so the coach\'s');
});

test('filing into a folder lands at the bottom of that owner\'s folder, not a same-named one', () => {
  const list = [P('w1', 'Lesson 1', W), P('a', 'Lesson 1'), P('x')];
  const out = setFolder(list, 'x', 'Lesson 1');
  assert.equal(ids(out), 'w1ax', 'after the coach\'s own Lesson 1, not Wavy\'s');
  const wavy = setFolder([P('w1', 'Lesson 1', W), P('a', 'Lesson 1'), P('w9', '', W)], 'w9', 'Lesson 1');
  assert.equal(ids(wavy), 'w1w9a', 'and a student\'s straight after their own');
});

test('move up and down stays inside one owner\'s folder', () => {
  const list = mixed();
  assert.equal(canMove(list, 'a', 1), true);
  assert.equal(ids(movePosition(list, 'a', 1)), 'bw1aw2c', 'a swaps with b — Wavy\'s w1 in between is skipped');
  assert.equal(canMove(list, 'w1', -1), false, 'the coach\'s a, above it, is someone else\'s folder');
  assert.equal(ids(movePosition(list, 'w2', -1)), 'aw2bw1c');
});

test('renaming the coach\'s folder leaves a student\'s of the same name alone, and the other way round', () => {
  const list = mixed();
  const mine = renameFolder(list, 'Lesson 1', 'Openings', 9);
  assert.equal(shapeOf(mine, null), 'Openings:ab -:c');
  assert.equal(shapeOf(mine, W), 'Lesson 1:w1w2');
  assert.equal(mine.find((p) => p.id === 'w1'), list.find((p) => p.id === 'w1'), 'Wavy\'s untouched, not even re-dated');
  const theirs = renameFolder(list, 'Lesson 1', 'Forks', 9, W);
  assert.equal(shapeOf(theirs, W), 'Forks:w1w2');
  assert.equal(shapeOf(theirs, null), 'Lesson 1:ab -:c');
});

test('each owner\'s folders keep an order of their own', () => {
  const settings = { positionFolderOrder: ['B', 'A'], positionFolderOrders: { [B]: ['Lesson 2', 'Lesson 1'] } };
  assert.deepEqual(folderOrderFor(settings, null), ['B', 'A']);
  assert.deepEqual(folderOrderFor(settings, B), ['Lesson 2', 'Lesson 1']);
  assert.deepEqual(folderOrderFor(settings, W), [], 'never arranged: A–Z');
  assert.deepEqual(folderOrderFor({}, null), []);
  assert.deepEqual(withFolderOrder(settings, null, ['A', 'B']), { positionFolderOrder: ['A', 'B'] });
  assert.deepEqual(
    withFolderOrder(settings, W, ['Lesson 3']),
    { positionFolderOrders: { [B]: ['Lesson 2', 'Lesson 1'], [W]: ['Lesson 3'] } },
    'arranging Wavy\'s keeps Bo\'s',
  );
});

// ---------------------------------------------------------------------------
// Recycle
// ---------------------------------------------------------------------------

const lucena = () => ({
  id: 'luc', name: 'Lucena', fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', folder: 'Rook endgames',
  arrows: [['c1', 'c4', '#15781B']], squares: { b7: '#882020' }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: 5,
});

test('a recycled copy is a new position; the original is untouched', () => {
  const src = lucena();
  const list = [src, P('w1', 'Lesson 1', W)];
  const before = JSON.stringify(list);
  const out = recyclePosition(list, 'luc', {
    ownerId: W, folder: 'Lesson 1', id: 'copy1', now: Date.UTC(2026, 9, 16),
  });
  assert.equal(JSON.stringify(list), before, 'the list it was given is unchanged');
  assert.equal(out.length, 3);
  assert.equal(out[0], src, 'the original is the same object, where it was');
  const copy = out.find((p) => p.id === 'copy1');
  assert.equal(copy.name, 'Lucena');
  assert.equal(copy.fen, src.fen);
  assert.equal(copy.ownerId, W);
  assert.equal(copy.folder, 'Lesson 1');
  assert.equal(copy.recycledFrom, 'luc');
  assert.equal(copy.createdAt, '2026-10-16T00:00:00.000Z', 'made now');
  assert.equal('updatedAt' in copy, false, 'a new position has no edits yet');
});

test('the copy is a deep copy: redrawing it never redraws the original', () => {
  const src = lucena();
  const out = recyclePosition([src], 'luc', { ownerId: W, folder: 'Lesson 1', id: 'copy1' });
  const copy = out.find((p) => p.id === 'copy1');
  assert.notEqual(copy.arrows, src.arrows);
  copy.arrows[0][2] = '#000';
  copy.arrows.push(['a1', 'a8', '#000']);
  copy.squares.h8 = '#000';
  assert.deepEqual(src.arrows, [['c1', 'c4', '#15781B']]);
  assert.deepEqual(src.squares, { b7: '#882020' });
});

test('it lands at the bottom of the student\'s lesson, not the coach\'s folder of the same name', () => {
  const list = [P('w1', 'Lesson 1', W), P('a', 'Lesson 1'), P('w2', 'Lesson 1', W), P('b', 'Lesson 1'), lucena()];
  const out = recyclePosition(list, 'luc', { ownerId: W, folder: 'Lesson 1', id: 'cp' });
  assert.equal(ids(out), 'w1aw2cpbluc', 'straight after Wavy\'s last one');
  assert.equal(shapeOf(out, W), 'Lesson 1:w1w2cp');
  assert.equal(shapeOf(out, null), 'Lesson 1:ab Rook endgames:luc', 'the coach\'s Lesson 1 has nothing new in it');
});

test('a new lesson is made by recycling into it', () => {
  const list = [P('w1', 'Lesson 1', W), lucena()];
  const out = recyclePosition(list, 'luc', { ownerId: W, folder: '  Lesson 2 ', id: 'cp' });
  assert.deepEqual(folderNames(positionsFor(out, W)), ['Lesson 1', 'Lesson 2']);
  assert.equal(out[out.length - 1].id, 'cp', 'the first in a folder goes at the end of the list');
  // Recycled into your own positions: no owner at all, not a null one.
  const mine = recyclePosition(list, 'luc', { ownerId: null, folder: 'Teaching', id: 'cp2' });
  assert.equal('ownerId' in mine.find((p) => p.id === 'cp2'), false);
});

test('a source that isn\'t there, or an id already taken, changes nothing', () => {
  const list = [lucena()];
  assert.equal(recyclePosition(list, 'gone', { ownerId: W, folder: 'Lesson 1', id: 'cp' }), list);
  assert.equal(recyclePosition(list, 'luc', { ownerId: W, folder: 'Lesson 1', id: 'luc' }), list);
  assert.equal(recyclePosition(list, 'luc', { ownerId: W, folder: 'Lesson 1' }), list, 'no id given');
  assert.equal(recyclePosition(undefined, 'luc', { id: 'cp' }).length, 0);
});

test('a whole lesson recycles in the order it\'s taught in', () => {
  const list = [P('a', 'Forks'), P('x'), P('b', 'Forks'), P('c', 'Forks'), P('w1', 'Lesson 1', W)];
  const items = ['a', 'b', 'c'].map((srcId) => ({ srcId, id: `${srcId}2` }));
  const out = recyclePositions(list, items, { ownerId: W, folder: 'Lesson 1' });
  assert.equal(shapeOf(out, W), 'Lesson 1:w1a2b2c2');
  assert.equal(shapeOf(out, null), 'Forks:abc -:x', 'the coach\'s lesson as it was');
  // A missing one is skipped; the rest still arrive.
  const some = recyclePositions(list, [{ srcId: 'a', id: 'a3' }, { srcId: 'gone', id: 'g3' }, { srcId: 'c', id: 'c3' }], { ownerId: B, folder: 'Lesson 1' });
  assert.equal(shapeOf(some, B), 'Lesson 1:a3c3');
});

test('Recycle can tell a lesson already holds the position', () => {
  const src = lucena();
  const copy = recycledCopy(src, { ownerId: W, folder: 'Lesson 4', id: 'cp' });
  const list = [src, copy, P('w1', 'Lesson 3', W)];
  assert.equal(alreadyIn(list, src, { ownerId: W, folder: 'Lesson 4' })?.id, 'cp', 'a copy of it is there');
  assert.equal(alreadyIn(list, src, { ownerId: W, folder: 'Lesson 3' }), null);
  assert.equal(alreadyIn(list, src, { ownerId: B, folder: 'Lesson 4' }), null, 'Bo has no Lesson 4');
  assert.equal(alreadyIn(list, src, { ownerId: null, folder: 'Rook endgames' })?.id, 'luc', 'the original itself');
  // Recycling Wavy's copy on to the coach's Rook endgames finds the original there.
  assert.equal(alreadyIn(list, copy, { ownerId: null, folder: 'Rook endgames' })?.id, 'luc');
  // Another copy of the same original counts too.
  const sibling = recycledCopy(src, { ownerId: B, folder: 'Lesson 1', id: 'cp2' });
  assert.equal(alreadyIn([...list, sibling], copy, { ownerId: B, folder: 'Lesson 1' })?.id, 'cp2');
});

test('a new lesson is offered as Lesson N, one more than that owner has', () => {
  const list = [P('a', 'Endgames'), P('w1', 'Lesson 1', W), P('w2', 'Lesson 2', W), P('w3', 'Lesson 2', W)];
  assert.equal(nextLessonName(list, W), 'Lesson 3');
  assert.equal(nextLessonName(list, null), 'Lesson 2', 'the coach has one folder of their own');
  assert.equal(nextLessonName(list, B), 'Lesson 1');
  assert.equal(nextLessonName([P('b1', 'Lesson 2', B)], B), 'Lesson 3', 'never one they already have');
});

test('a typed lesson name: blank is the one offered, an existing name files into it', () => {
  const list = [P('w1', 'Lesson 1', W), P('a', 'Forks')];
  assert.equal(lessonNamed(list, W, '   '), 'Lesson 2');
  assert.equal(lessonNamed(list, W, 'lesson 1'), 'Lesson 1', 'Wavy\'s own spelling');
  assert.equal(lessonNamed(list, W, 'forks'), 'forks', 'the coach\'s Forks isn\'t one of Wavy\'s');
  assert.equal(lessonNamed(list, W, ' Knight forks '), 'Knight forks');
});

test('a position that arrived in a coach\'s lesson, recycled, is a copy of the account\'s own', () => {
  const arrived = {
    ...lucena(), folder: 'Lesson 4', received: { from: 'coach1', lesson: 'Lesson 4', stamp: 1000 },
  };
  const copy = recycledCopy(arrived, { folder: 'Endgames', id: 'copy1', now: 5 });
  assert.equal('received' in copy, false, 'the coach\'s next send can\'t reach it');
  assert.equal(copy.recycledFrom, 'luc');
});

test('the room every saved position syncs in is measured, so Recycle can warn before it runs out', () => {
  const empty = listsBytes({});
  const one = listsBytes({ savedPositions: [lucena()] });
  assert.ok(one > empty);
  // Accents count as Firestore counts them: by UTF-8 byte, not by letter.
  assert.equal(listsBytes({ savedPositions: [{ name: 'é' }] }) - listsBytes({ savedPositions: [{ name: 'e' }] }), 1);
  assert.equal(listsBytes({ openings: [{ id: 'o1' }] }) - listsBytes({}), 2 + 1, 'the openings\' order rides in it too');
  // An arrow is boxed on the way up, and Firestore counts that too.
  const arrow = listsBytes({ savedPositions: [{ arrows: [['c1', 'c4', '#15781B']] }] }) - listsBytes({ savedPositions: [{ arrows: [] }] });
  assert.equal(arrow, (2 + 1) * 2 + (7 + 1) + (5 + 1), 'three strings and the box\'s key');
  const many = (n) => Array.from({ length: n }, (_, i) => ({
    ...lucena(), id: `p${String(i).padStart(19, '0')}`, folder: 'Lesson 1', ownerId: W, recycledFrom: 'luc',
  }));
  assert.ok(listsBytes({ savedPositions: many(1000) }) < LISTS_BYTES_WARN, 'a thousand is nowhere near');
  assert.ok(listsBytes({ savedPositions: many(4000) }) > LISTS_BYTES_WARN, 'a few thousand copies is where it starts to matter');
});
