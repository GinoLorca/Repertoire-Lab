// Copying a collection from one repertoire to another — src/lib/collectionCopy.js.
// (The store's copyCollection: tests/sync-matrix-structure.test.mjs.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectionLines, sameLineIn, collectionPlan, missingByPlace,
} from '../src/lib/collectionCopy.js';

const line = (id, name, moves, extra = {}) => ({ id, name, moves, comments: {}, badges: {}, ...extra });

// Yours: the London with a Bishop plan on two lines and a whole chapter.
const mine = {
  id: 'o1', name: 'London System', color: 'white', ownerId: null,
  chapters: [
    { id: 'c1', name: 'Main', variations: [
      line('v1', 'Bf4 e6', ['d4', 'd5', 'Bf4', 'e6'], { tags: ['Light square bishop'] }),
      line('v2', 'Bf4 c5', ['d4', 'd5', 'Bf4', 'c5']),
      line('v3', 'Bf4 Bf5', ['d4', 'd5', 'Bf4', 'Bf5'], { tags: ['Light square bishop', 'Pawn storm'] }),
    ] },
    { id: 'c2', name: 'Kingside attack', tags: ['Light square bishop'], variations: [
      line('v4', 'h4 plan', ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'h4']),
    ] },
  ],
};
// Parker's: the same opening, some lines already there under other names.
const parkers = {
  id: 'o2', name: 'london system ', color: 'white', ownerId: 'p-parker',
  chapters: [
    { id: 'c9', name: 'Main', variations: [
      line('w1', 'Bf4 e6', ['d4', 'd5', 'Bf4', 'e6']), // the same line
      line('w2', 'Anti-Slav', ['d4', 'd5', 'Bf4', 'Bf5'], { tags: ['My favourites'] }), // the same moves
    ] },
  ],
};
const sicilian = {
  id: 'o3', name: 'Sicilian', color: 'black', ownerId: 'p-parker', tags: ['Light square bishop'],
  chapters: [{ id: 'c5', name: 'Najdorf', variations: [line('s1', 'English Attack', ['e4', 'c5', 'Nf3', 'd6'])] }],
};
const openings = [mine, parkers, sicilian];

test('a collection holds the lines tagged, the lines of a tagged chapter and of a tagged opening — in its owner only', () => {
  assert.deepEqual(collectionLines(openings, null, 'Light square bishop').map((l) => l.variation.id), ['v1', 'v3', 'v4']);
  assert.deepEqual(collectionLines(openings, 'p-parker', 'Light square bishop').map((l) => l.variation.id), ['s1']);
  assert.deepEqual(collectionLines(openings, null, 'Pawn storm').map((l) => l.variation.id), ['v3']);
  assert.deepEqual(collectionLines(openings, null, 'Nothing'), []);
});

test('the same line there: the same line, else the same moves under another name, else that name in that chapter', () => {
  const at = (v, c = mine.chapters[0]) => sameLineIn(openings, 'p-parker', mine, c, v)?.variation.id ?? null;
  assert.equal(at(mine.chapters[0].variations[0]), 'w1');
  assert.equal(at(mine.chapters[0].variations[2]), 'w2');
  assert.equal(at(mine.chapters[0].variations[1]), null);
  // A line of that name in a chapter of that name, whatever its moves.
  const renamedMoves = line('x', 'Bf4 e6', ['d4', 'd5', 'Bf4', 'e6', 'e3']);
  assert.equal(at(renamedMoves), 'w1');
  // …but not in a chapter of another name.
  assert.equal(at(renamedMoves, { name: 'Elsewhere' }), null);
  // Only in an opening of the same name, and only the target's own.
  assert.equal(sameLineIn(openings, 'p-parker', { name: 'Caro-Kann' }, mine.chapters[0], mine.chapters[0].variations[0]), null);
  assert.equal(sameLineIn(openings, 'p-other', mine, mine.chapters[0], mine.chapters[0].variations[0]), null);
});

test('a plan for yours to Parker: two there, one to add, in a chapter they don\'t have', () => {
  const plan = collectionPlan(openings, { tag: 'Light square bishop', from: null, to: 'p-parker' });
  assert.equal(plan.lines.length, 3);
  assert.equal(plan.have, 2);
  assert.equal(plan.already, 0);
  assert.equal(plan.missing, 1);
  assert.deepEqual(plan.lines.map((l) => l.there?.variation.id ?? null), ['w1', 'w2', null]);
  assert.deepEqual(missingByPlace(plan), [
    { opening: 'London System', chapter: 'Kingside attack', newOpening: false, newChapter: true, lines: ['h4 plan'] },
  ]);
});

test('a plan for Parker\'s to yours: an opening you don\'t have; a line in it already counts', () => {
  const plan = collectionPlan(openings, { tag: 'Light square bishop', from: 'p-parker', to: null });
  assert.equal(plan.missing, 1);
  assert.deepEqual(missingByPlace(plan), [
    { opening: 'Sicilian', chapter: 'Najdorf', newOpening: true, newChapter: true, lines: ['English Attack'] },
  ]);
  const back = collectionPlan(openings, { tag: 'Light square bishop', from: 'p-parker', to: 'p-parker' });
  assert.equal(back.have, 1);
  assert.equal(back.already, 1);
});

test('lines to add are grouped by where they\'d go, in order', () => {
  const plan = collectionPlan(openings, { tag: 'Light square bishop', from: null, to: 'p-new' });
  assert.deepEqual(missingByPlace(plan), [
    { opening: 'London System', chapter: 'Main', newOpening: true, newChapter: true, lines: ['Bf4 e6', 'Bf4 Bf5'] },
    { opening: 'London System', chapter: 'Kingside attack', newOpening: true, newChapter: true, lines: ['h4 plan'] },
  ]);
});
