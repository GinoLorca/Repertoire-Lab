// A collection played as a playlist — src/lib/collectionRun.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCollectionRun, collectionName, collectionLines, collectionRun, collectionQueue,
} from '../src/lib/collectionRun.js';

const line = (id, extra = {}) => ({ id, name: id, moves: ['d4'], ...extra });
const ids = (items) => items.map((it) => it.variation.id);

// Yours: two openings. A theme, "Traps", on single lines in three chapters;
// one chapter starred whole, and single stars elsewhere.
const mine = [
  {
    id: 'jobava', name: 'Jobava London', ownerId: null,
    chapters: [
      { id: 'c5', name: '3...c5', variations: [line('a1', { tags: ['Traps'], starred: true }), line('a2'), line('a3', { tags: ['Traps'] })] },
      { id: 'bf5', name: '3...Bf5', starred: true, variations: [line('b1'), line('b2', { starred: true, tags: ['Traps'] })] },
    ],
  },
  {
    id: 'caro', name: 'Caro-Kann', ownerId: null,
    chapters: [
      { id: 'adv', name: 'Advance', variations: [line('k1', { starred: true }), line('k2', { tags: ['Traps', 'Endgames'] })] },
    ],
  },
];
// A student's, with the same theme name on a line of their own.
const students = [
  { id: 's-jobava', name: 'Jobava London', ownerId: 'myla', chapters: [{ id: 'sc', name: 'Guide', variations: [line('m1', { tags: ['Traps'], starred: true })] }] },
];
const library = [...mine, ...students];

test('which scopes are a collection played from a line', () => {
  assert.equal(isCollectionRun({ tag: 'Traps', startAt: 'a3', mode: 'learn' }), true);
  assert.equal(isCollectionRun({ starred: true, startAt: 'a1' }), true);
  assert.equal(isCollectionRun({ tag: 'Traps', mode: 'practice' }), false, '"Practice all": the collection’s own rule, as before');
  assert.equal(isCollectionRun({ openingId: 'jobava', chapterId: 'c5', variationId: 'a1' }), false, 'a line from its chapter’s page');
  assert.equal(isCollectionRun({ startAt: 'a1' }), false, 'no collection named');
  assert.equal(isCollectionRun(undefined), false);
  assert.equal(collectionName({ starred: true }), 'Favorites');
  assert.equal(collectionName({ tag: 'Traps' }), 'Traps');
  assert.equal(collectionName({}), null);
});

test('a theme’s lines: every line it’s on, wherever it lives, in the order the collection lists them', () => {
  assert.deepEqual(ids(collectionLines(mine, { tag: 'Traps' })), ['a1', 'a3', 'b2', 'k2']);
  assert.deepEqual(ids(collectionLines(mine, { tag: 'Endgames' })), ['k2']);
  assert.deepEqual(collectionLines(mine, { tag: 'Nothing' }), []);
  assert.deepEqual(collectionLines(mine, {}), [], 'no collection named: no lines');
  const [first] = collectionLines(mine, { tag: 'Traps' });
  assert.equal(first.opening, mine[0]);
  assert.equal(first.chapter, mine[0].chapters[0], 'each comes with where it lives');
});

test('what whole openings and chapters cover comes first, as the page lists it; nothing twice', () => {
  // Favorites: the starred chapter's lines (both, the starred one once), then the single stars.
  assert.deepEqual(ids(collectionLines(mine, { starred: true })), ['b1', 'b2', 'a1', 'k1']);
  // A theme on a whole opening, a chapter of another, and a line.
  const themed = [
    { ...mine[0], chapters: [mine[0].chapters[0], { ...mine[0].chapters[1], tags: ['Plans'] }] },
    { ...mine[1], tags: ['Plans'] },
  ];
  themed[0].chapters[0] = { ...themed[0].chapters[0], variations: [line('a1', { tags: ['Plans'] }), line('a2')] };
  assert.deepEqual(ids(collectionLines(themed, { tag: 'Plans' })), ['k1', 'k2', 'b1', 'b2', 'a1'], 'openings, then chapters, then lines');
});

test('Learn or Practice on a line: that line first, then the rest of the collection, round to the ones before it', () => {
  const lines = collectionLines(mine, { tag: 'Traps' });
  const fromThird = collectionRun(lines, 'b2', 'learn');
  assert.deepEqual(ids(fromThird), ['b2', 'k2', 'a1', 'a3']);
  assert.ok(fromThird.every((it) => it.kind === 'learn'), 'every line the way you asked for the first');
  assert.deepEqual(ids(collectionRun(lines, 'a1', 'practice')), ['a1', 'a3', 'b2', 'k2'], 'from the top: as listed');
  assert.deepEqual(ids(collectionRun(lines, 'k2', 'practice')), ['k2', 'a1', 'a3', 'b2'], 'from the last: round to the first');
  assert.ok(collectionRun(lines, 'k2').every((it) => it.kind === 'practice'));
  assert.deepEqual(ids(collectionRun(lines, 'gone', 'learn')), ['a1', 'a3', 'b2', 'k2'], 'a line no longer in it: from the top');
  assert.deepEqual(collectionRun([], 'a1', 'learn'), []);
  assert.equal(lines[0].kind, undefined, 'the lines themselves aren’t touched');
});

test('the session never leaves the collection for the line’s chapter', () => {
  const run = collectionQueue(library, { tag: 'Traps', ownerId: null, startAt: 'a1', mode: 'learn' });
  assert.deepEqual(ids(run), ['a1', 'a3', 'b2', 'k2']);
  assert.equal(ids(run).includes('a2'), false, 'the chapter’s other line isn’t in the theme');
  assert.ok(run.every((it) => it.kind === 'learn'));
  const fav = collectionQueue(library, { starred: true, ownerId: null, startAt: 'k1', mode: 'practice' });
  assert.deepEqual(ids(fav), ['k1', 'b1', 'b2', 'a1']);
  assert.ok(fav.every((it) => it.kind === 'practice'));
});

test('yours and a student’s collections of the same name stay apart', () => {
  assert.deepEqual(ids(collectionQueue(library, { tag: 'Traps', ownerId: 'myla', startAt: 'm1', mode: 'learn' })), ['m1']);
  assert.equal(ids(collectionQueue(library, { tag: 'Traps', startAt: 'a1' })).includes('m1'), false);
  assert.deepEqual(ids(collectionQueue(library, { starred: true, ownerId: 'myla', startAt: 'm1' })), ['m1']);
  assert.deepEqual(collectionQueue(library, { tag: 'Traps', ownerId: 'nobody', startAt: 'a1' }), []);
  assert.deepEqual(collectionQueue(undefined, { tag: 'Traps', startAt: 'a1' }), []);
});
