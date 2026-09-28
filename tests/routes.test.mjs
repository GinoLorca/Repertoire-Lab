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
