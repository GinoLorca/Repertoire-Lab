// Merging a restored backup or a coach's delivery after lines were sent to a
// sub-variation on one side: each line ends up once, with its progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBackup, fullBackup, studyPack } from '../src/lib/backup.js';

const line = (id, extra = {}) => ({ id, name: id, moves: ['e4', 'c6'], ...extra });
const where = (state) => Object.fromEntries(state.openings[0].chapters.map((c) => [c.id, c.variations.map((v) => v.id).join(' ')]));

// Before: Exchange holds x1 and the Panov line p1.
const before = () => ({
  openings: [{ id: 'o', name: 'Caro-Kann', chapters: [{ id: 'c-ex', name: 'Exchange', section: null, subsection: null, variations: [line('x1'), line('p1')] }] }],
});
// After: p1 sent to its own sub-variation.
const after = () => ({
  openings: [{
    id: 'o',
    name: 'Caro-Kann',
    chapters: [
      { id: 'c-ex', name: 'Exchange', section: 'Exchange', subsection: null, variations: [line('x1')] },
      { id: 'c-panov', name: 'Panov Attack', section: 'Exchange', subsection: 'Panov Attack', variations: [line('p1')] },
    ],
  }],
});

test('restoring an older backup onto a device that has since made the sub-variation: the line stays where it is now, with the backup\'s progress', () => {
  const now = after();
  const file = before();
  file.openings[0].chapters[0].variations[1] = line('p1', { learned: true, srs: { level: 4, lastReview: 9 } });
  const merged = mergeBackup(now, file);
  assert.deepEqual(where(merged), { 'c-ex': 'x1', 'c-panov': 'p1' });
  const p1 = merged.openings[0].chapters[1].variations[0];
  assert.equal(p1.srs.level, 4);
  assert.equal(merged.openings[0].chapters[0].section, 'Exchange', 'the head stays in its folder');
});

test('a coach\'s delivery after they made the sub-variation: the student gets the line in its new place, once, keeping their progress', () => {
  const student = before();
  student.openings[0].chapters[0].variations[1] = line('p1', { learned: true, srs: { level: 3, lastReview: 5 } });
  const merged = mergeBackup(student, after(), { structure: 'incoming' });
  assert.deepEqual(where(merged), { 'c-ex': 'x1', 'c-panov': 'p1' });
  assert.equal(merged.openings[0].chapters.find((c) => c.id === 'c-panov').variations[0].srs.level, 3);
  assert.equal(merged.openings[0].chapters[0].section, 'Exchange', 'the coach\'s folder arrives');
});

test('"arranged by hand" travels only with its order: a coach\'s arranged opening arrives in the coach\'s order; a restore keeps this device\'s', () => {
  const plain = () => ({ openings: [{ id: 'o', name: 'O', chapters: [{ id: 'a', variations: [] }, { id: 'b', variations: [] }, { id: 'c', variations: [] }] }] });
  const arranged = () => ({ openings: [{ id: 'o', name: 'O', freeChapterOrder: true, chapters: [{ id: 'c', variations: [] }, { id: 'a', variations: [] }, { id: 'b', variations: [] }] }] });
  const order = (st) => st.openings[0].chapters.map((c) => c.id).join('');
  const delivered = mergeBackup(plain(), arranged(), { structure: 'incoming' });
  assert.equal(order(delivered), 'cab');
  assert.equal(delivered.openings[0].freeChapterOrder, true);
  const restored = mergeBackup(plain(), arranged());
  assert.equal(order(restored), 'abc');
  assert.equal(restored.openings[0].freeChapterOrder, undefined, 'not the file\'s setting without its order');
  assert.equal(mergeBackup(arranged(), plain()).openings[0].freeChapterOrder, true, 'and not lost either');
});


test('a restore keeps whose a saved position is, and what it was recycled from', () => {
  const copy = {
    id: 'cp', name: 'Lucena', fen: '8/8/8/8/8/8/8/8 w - - 0 1', folder: 'Lesson 4', ownerId: 'card-wavy', recycledFrom: 'luc',
  };
  const merged = mergeBackup({ openings: [], savedPositions: [] }, { openings: [], savedPositions: [copy] });
  assert.deepEqual(merged.savedPositions, [copy]);
});

test('Back up everything keeps the Board Editor\'s positions — a student\'s lessons too — and Lab sessions', () => {
  const copy = {
    id: 'cp', name: 'Lucena', fen: '8/8/8/8/8/8/8/8 w - - 0 1', folder: 'Lesson 4', ownerId: 'card-wavy', recycledFrom: 'luc',
  };
  const lab = { id: 'lab1', name: 'Rook ending', baseFen: '8/8/8/8/8/8/8/8 w - - 0 1', moves: [] };
  const file = JSON.parse(fullBackup({
    openings: [], players: [], savedPositions: [copy], labEntries: [lab], settings: {},
  }).text);
  assert.deepEqual(file.savedPositions, [copy]);
  assert.deepEqual(file.labEntries, [lab]);
  // Replace everything from it brings them back, as Merge does.
  assert.deepEqual(mergeBackup({ openings: [], savedPositions: [] }, file).savedPositions, [copy]);
});

test('a study pack carries that student\'s lessons as their own, and nobody else\'s', () => {
  const pos = (id, ownerId, folder) => ({
    id, name: id, fen: '8/8/8/8/8/8/8/8 w - - 0 1', folder, ...(ownerId ? { ownerId, recycledFrom: 'src' } : {}),
  });
  const state = {
    openings: [],
    savedPositions: [pos('mine', null, 'Mine'), pos('w1', 'card-wavy', 'Lesson 4'), pos('b1', 'card-bo', 'Lesson 1')],
  };
  const pack = studyPack(state, { id: 'card-wavy', name: 'Wavy' });
  assert.deepEqual(pack.savedPositions, [{
    id: 'w1', name: 'w1', fen: '8/8/8/8/8/8/8/8 w - - 0 1', folder: 'Lesson 4',
  }]);
  assert.deepEqual(JSON.parse(pack.text).savedPositions, pack.savedPositions);
});
