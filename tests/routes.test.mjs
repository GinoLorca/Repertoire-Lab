// Addresses: every screen worth linking to, and back again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, pathFor } from '../src/lib/routes.js';

test('sections and their sub-modes round-trip', () => {
  assert.deepEqual(parsePath('/analysis/editor'), { view: 'analysis', sub: 'editor' });
  assert.equal(pathFor({ view: 'analysis', sub: 'editor' }), '/analysis/editor');
  assert.deepEqual(parsePath('/chapter/o1/c2'), { view: 'chapter', chapterNav: { openingId: 'o1', chapterId: 'c2' } });
  assert.deepEqual(parsePath('/'), { view: 'library' });
  assert.deepEqual(parsePath('/nowhere'), { view: 'library' });
});

test('one person\'s page has an address: /coaches/<card>, /games/<card>, /…/games for the games tab', () => {
  assert.deepEqual(parsePath('/coaches/k3j9x2m1'), { view: 'coaches', sub: null, player: { id: 'k3j9x2m1', tab: null } });
  assert.deepEqual(parsePath('/coaches/k3j9x2m1/games'), { view: 'coaches', sub: null, player: { id: 'k3j9x2m1', tab: 'games' } });
  assert.deepEqual(parsePath('/games/me01'), { view: 'games', sub: null, player: { id: 'me01', tab: null } });
  assert.equal(pathFor({ view: 'coaches', player: { id: 'k3j9x2m1', tab: null } }), '/coaches/k3j9x2m1');
  assert.equal(pathFor({ view: 'coaches', player: { id: 'k3j9x2m1', tab: 'games' } }), '/coaches/k3j9x2m1/games');
  assert.equal(pathFor({ view: 'games', player: { id: 'me01', tab: 'dashboard' } }), '/games/me01');
  // Anything that isn't a card id is ignored, and other sections don't take one.
  assert.deepEqual(parsePath('/coaches/%3Cscript%3E'), { view: 'coaches', sub: null });
  assert.equal(pathFor({ view: 'library', player: { id: 'k3j9x2m1' } }), '/library');
  assert.equal(pathFor({ view: 'coaches', player: { id: '../x' } }), '/coaches');
  assert.equal(pathFor({ view: 'coaches' }), '/coaches');
});

test('a saved Board Editor position has an address: /analysis/editor/<position>', () => {
  assert.deepEqual(parsePath('/analysis/editor/p7x2k9q1'), { view: 'analysis', sub: 'editor', position: 'p7x2k9q1' });
  assert.equal(pathFor({ view: 'analysis', sub: 'editor', position: 'p7x2k9q1' }), '/analysis/editor/p7x2k9q1');
  // Only the editor takes one, and only an id-shaped one.
  assert.equal(pathFor({ view: 'analysis', sub: 'engine', position: 'p7x2k9q1' }), '/analysis/engine');
  assert.equal(pathFor({ view: 'analysis', sub: 'editor', position: '../x' }), '/analysis/editor');
  assert.deepEqual(parsePath('/analysis/editor/%3Cb%3E'), { view: 'analysis', sub: 'editor' });
  assert.deepEqual(parsePath('/analysis/engine/p7x2k9q1'), { view: 'analysis', sub: 'engine' });
});

test('a quick setup has an address: /analysis/editor/setup/<slug>', () => {
  assert.deepEqual(parsePath('/analysis/editor/setup/tom-and-jerry'), { view: 'analysis', sub: 'editor', setup: 'tom-and-jerry' });
  assert.equal(pathFor({ view: 'analysis', sub: 'editor', setup: 'tom-and-jerry' }), '/analysis/editor/setup/tom-and-jerry');
  // "setup" is never read as a saved position's id, and a bad slug is dropped.
  assert.deepEqual(parsePath('/analysis/editor/setup'), { view: 'analysis', sub: 'editor' });
  assert.deepEqual(parsePath('/analysis/editor/setup/Bad%20Slug'), { view: 'analysis', sub: 'editor' });
  assert.equal(pathFor({ view: 'analysis', sub: 'editor', setup: '../x' }), '/analysis/editor');
  // A saved position wins if both are somehow set.
  assert.equal(pathFor({ view: 'analysis', sub: 'editor', position: 'p7x2k9q1', setup: 'pawn-race' }), '/analysis/editor/p7x2k9q1');
});
