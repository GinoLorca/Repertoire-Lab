// Arranging chapter cards by hand: folders and loose chapters in a course's
// grid, and sub-variations inside a folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  topItems, arrangeTop, arrangeFolder, stepKey, placeKey, dropOrder, legacyOrder, folderSubKeys,
  gatherIntoFolder, keepFoldersTogether,
} from '../src/lib/chapterOrder.js';

const ch = (id, extra = {}) => ({ id, name: id, section: null, subsection: null, courseId: null, variations: [], ...extra });
// The Caro-Kann from the screenshot, in the order its chapters were added.
const caro = () => ({
  id: 'o',
  chapters: [
    ch('adv'),
    ch('ex', { section: 'Exchange' }),
    ch('knights'),
    ch('tart', { section: 'Classical', subsection: 'Tartakower' }),
    ch('panov', { section: 'Exchange', subsection: 'Panov' }),
    ch('karpov', { section: 'Classical', subsection: 'Karpov' }),
    ch('fantasy'),
  ],
});
const ids = (o) => o.chapters.map((c) => c.id).join(' ');

test('until arranged by hand, folders show first, as they always have', () => {
  assert.deepEqual(topItems(caro()), ['s:Exchange', 's:Classical', 'c:adv', 'c:knights', 'c:fantasy']);
});

test('the first arrangement starts from what was on screen, and from then on folders sit where they\'re put', () => {
  const o = caro();
  // Drag Advance to the front.
  const keys = placeKey(topItems(o), 'c:adv', 's:Exchange');
  const next = arrangeTop(o, null, keys);
  assert.equal(next.freeChapterOrder, true);
  assert.deepEqual(topItems(next), ['c:adv', 's:Exchange', 's:Classical', 'c:knights', 'c:fantasy']);
  assert.equal(ids(next), 'adv ex panov tart karpov knights fantasy', 'each folder\'s chapters together, in their own order');
});

test('▲▼ step one item; a drop moves one before another or to the end', () => {
  const keys = ['a', 'b', 'c'];
  assert.deepEqual(stepKey(keys, 'b', -1), ['b', 'a', 'c']);
  assert.equal(stepKey(keys, 'a', -1), keys, 'nothing before the first');
  assert.deepEqual(placeKey(keys, 'a', null), ['b', 'c', 'a']);
  assert.deepEqual(placeKey(keys, 'c', 'a'), ['c', 'a', 'b']);
  assert.equal(placeKey(keys, 'a', 'b'), keys, 'already there');
});

test('other courses\' chapters keep their places', () => {
  const o = {
    id: 'o',
    chapters: [ch('a', { courseId: 'k1' }), ch('x', { courseId: 'k2' }), ch('b', { courseId: 'k1' }), ch('y', { courseId: 'k2' })],
  };
  const next = arrangeTop(o, 'k1', ['c:b', 'c:a']);
  assert.equal(ids(next), 'b x a y');
});

test('a chapter the drop didn\'t know about (added elsewhere meanwhile) goes after', () => {
  const next = arrangeTop(caro(), null, ['c:fantasy', 's:Exchange']);
  assert.deepEqual(topItems(next).slice(0, 2), ['c:fantasy', 's:Exchange']);
  assert.equal(next.chapters.length, 7);
});

test('sub-variations in a new order inside their folder; the chapter it\'s of stays first', () => {
  const o = caro();
  o.chapters.push(ch('carlsbad', { section: 'Exchange', subsection: 'Carlsbad' }));
  const next = arrangeFolder(o, null, 'Exchange', ['Carlsbad', 'Panov']);
  const exchange = next.chapters.filter((c) => c.section === 'Exchange').map((c) => c.id);
  assert.deepEqual(exchange, ['ex', 'carlsbad', 'panov']);
  assert.equal(next.chapters.filter((c) => c.section !== 'Exchange').map((c) => c.id).join(' '),
    o.chapters.filter((c) => c.section !== 'Exchange').map((c) => c.id).join(' '), 'nothing else moves');
  assert.equal(arrangeFolder(next, null, 'Exchange', ['Carlsbad', 'Panov']), next, 'same order: unchanged');
});

test('a drop before or after a card', () => {
  const keys = ['a', 'b', 'c', 'd'];
  assert.deepEqual(dropOrder(keys, 'a', { key: 'c', where: 'after' }), ['b', 'c', 'a', 'd']);
  assert.deepEqual(dropOrder(keys, 'd', { key: 'b', where: 'before' }), ['a', 'd', 'b', 'c']);
  assert.deepEqual(dropOrder(keys, 'a', { key: 'd', where: 'after' }), ['b', 'c', 'd', 'a']);
  assert.equal(dropOrder(keys, 'b', { key: 'a', where: 'after' }), keys, 'where it already is');
});

// ---------- From the review ----------

test('arranging one course leaves every other course looking exactly as it did', () => {
  const o = {
    id: 'o',
    chapters: [
      ch('a1', { courseId: 'k1' }), ch('f1', { courseId: 'k1', section: 'Exchange' }),
      ch('a2', { courseId: 'k2' }), ch('b2', { courseId: 'k2' }),
      ch('loose0'), ch('f0', { section: 'Classical' }),
    ],
  };
  const before = { k1: topItems(o, 'k1'), none: topItems(o, null) };
  const next = arrangeTop(o, 'k2', ['c:b2', 'c:a2']);
  assert.deepEqual(topItems(next, 'k2'), ['c:b2', 'c:a2']);
  assert.deepEqual(topItems(next, 'k1'), before.k1);
  assert.deepEqual(topItems(next, null), before.none);
});

test('a press that changes nothing changes nothing — not even "arranged"', () => {
  const o = caro();
  assert.equal(arrangeTop(o, null, topItems(o)), o);
  assert.equal(arrangeTop(o, null, stepKey(topItems(o), 's:Exchange', -1)), o);
});

test('the old order, as the screen showed it, is deterministic and leaves an arranged opening alone', () => {
  const o = caro();
  const n = legacyOrder(o);
  assert.deepEqual(topItems({ ...n, freeChapterOrder: true }), topItems(o), 'reads the way the screen did');
  assert.equal(legacyOrder(n), n);
  const arranged = { ...o, freeChapterOrder: true };
  assert.equal(legacyOrder(arranged), arranged);
});

test('a folder with loose chapters but no head: drags keep the loose chapters where they are shown (first)', () => {
  const o = {
    id: 'o',
    chapters: [
      ch('t', { section: 'C', subsection: 'Tartakower' }), ch('k', { section: 'C', subsection: 'Karpov' }),
      ch('m1', { section: 'C' }), ch('m2', { section: 'C' }),
    ],
  };
  assert.deepEqual(folderSubKeys(o, null, 'C'), ['sub:Tartakower', 'sub:Karpov']);
  const next = arrangeFolder(o, null, 'C', ['Karpov', 'Tartakower']);
  assert.equal(ids(next), 'm1 m2 k t');
});

test('into a folder that\'s already there: in behind its chapters, so the folder keeps its place', () => {
  const chapters = [ch('side', { section: 'Exchange', subsection: 'Sidelines' }), ch('adv'), ch('ex', { section: 'Exchange' }), ch('panov', { section: 'Exchange', subsection: 'Panov' })];
  assert.equal(gatherIntoFolder(chapters, ['side']).map((c) => c.id).join(' '), 'adv ex panov side');
});

test('after a sync, a sub-variation new on one device joins its folder where the other device moved it', () => {
  const arranged = {
    id: 'o',
    freeChapterOrder: true,
    chapters: [ch('cl', { section: 'Classical' }), ch('carlsbad', { section: 'Exchange', subsection: 'Carlsbad' }), ch('adv'), ch('ex', { section: 'Exchange' }), ch('panov', { section: 'Exchange', subsection: 'Panov' })],
  };
  const next = keepFoldersTogether(arranged, new Set(['cl', 'adv', 'ex', 'panov']));
  assert.equal(ids(next), 'cl adv ex panov carlsbad');
});

