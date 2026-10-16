// The coach's "Reviews in progress" list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewKey, startReview, touchReview, endReview, listReviews, pathTo, nodeAtPath, reviewCounts,
} from '../src/lib/reviewsInProgress.js';
import { makeTree, addMove, mainLineFrom } from '../src/lib/moveTree.js';

test('a review starts once, is touched when left, and ends', () => {
  const a = startReview({}, 'p1', 'g1', 100);
  assert.deepEqual(a[reviewKey('p1', 'g1')], { playerId: 'p1', gameId: 'g1', startedAt: 100, updatedAt: 100, path: [] });
  assert.equal(startReview(a, 'p1', 'g1', 200), a, 'already there: the same map, nothing to save');
  const b = touchReview(a, 'p1', 'g1', ['e4', 'e5'], 300);
  assert.deepEqual(b['p1:g1'].path, ['e4', 'e5']);
  assert.equal(b['p1:g1'].updatedAt, 300);
  assert.equal(b['p1:g1'].startedAt, 100);
  assert.equal(touchReview(b, 'p1', 'g2', ['d4'], 400), b, 'a game only looked at stays off the list');
  assert.deepEqual(endReview(b, 'p1', 'g1'), {});
  assert.equal(endReview({}, 'p1', 'g1').constructor, Object);
});

test('the list: latest first, and games that are gone drop out', () => {
  const map = {
    'p1:g1': { playerId: 'p1', gameId: 'g1', updatedAt: 1 },
    'p1:g2': { playerId: 'p1', gameId: 'g2', updatedAt: 5 },
    'p2:g9': { playerId: 'p2', gameId: 'g9', updatedAt: 9 },
  };
  const players = [{ id: 'p1', games: [{ id: 'g1' }, { id: 'g2' }] }];
  assert.deepEqual(listReviews(map, players).map((r) => r.game.id), ['g2', 'g1']);
});

test('where you stopped is found again, variation and all', () => {
  const tree = makeTree(['e4', 'e5', 'Nf3', 'Nc6']);
  const e5 = mainLineFrom(tree)[1];
  const { tree: withVar, nodeId: d5 } = addMove(tree, mainLineFrom(tree)[0].id, 'd5');
  const path = pathTo(withVar, d5);
  assert.deepEqual(path, ['e4', 'd5']);
  // A fresh tree with new ids for the same moves still finds it.
  const again = makeTree(['e4', 'e5', 'Nf3', 'Nc6']);
  const { tree: again2, nodeId: d5b } = addMove(again, mainLineFrom(again)[0].id, 'd5');
  assert.equal(nodeAtPath(again2, path), d5b);
  // Moves since taken out: as far as they go.
  assert.equal(nodeAtPath(again, ['e4', 'e5', 'Bc4']), mainLineFrom(again)[1].id);
  assert.equal(nodeAtPath(again, []), 'root');
  assert.ok(e5);
});

test('counts for a review row', () => {
  const tree = makeTree(['e4', 'e5', 'Nf3']);
  const { tree: root } = addMove(tree, mainLineFrom(tree)[0].id, 'c5');
  assert.deepEqual(
    reviewCounts({ tree: root, notes: { a: 'x', b: 'y' }, badges: { a: 'blunder' }, annotations: { f: {} } }),
    { notes: 2, badges: 1, marked: 1, variations: 1 },
  );
});
