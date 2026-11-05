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


test('a coach\'s "Quickstarter Guide" arriving: the chapters and courses it emptied go, the student\'s own stay, progress and playlists follow', () => {
  const student = {
    openings: [{
      id: 'o', name: 'Jobava London',
      courses: [{ id: 'k1', name: 'Midas Ratsma' }, { id: 'k2', name: 'My own notes' }],
      chapters: [
        { id: 'c1', name: 'Mainline', courseId: 'k1', variations: [line('a', { learned: true, srs: { level: 2, lastReview: 4 } }), line('b')] },
        { id: 'c2', name: 'Side', courseId: 'k1', variations: [line('c')] },
        { id: 'c3', name: 'Mine', courseId: 'k2', variations: [line('m')] },
        { id: 'c4', name: 'Empty, mine', courseId: null, variations: [] },
        { id: 'c5', name: 'Half mine', courseId: 'k1', variations: [line('h'), line('mine2')] },
      ],
    }],
    playlists: [{ id: 'p', name: 'Before school', items: [{ openingId: 'o', chapterId: 'c1', variationId: 'a' }, { openingId: 'o', chapterId: 'c3', variationId: 'm' }] }],
  };
  const guide = {
    openings: [{
      id: 'o', name: 'Jobava London', courses: [],
      chapters: [{ id: 'g', name: 'Quickstarter Guide', curated: true, courseId: null, variations: [line('a'), line('b'), line('c'), line('h')] }],
    }],
  };
  const merged = mergeBackup(student, guide, { structure: 'incoming' });
  const o = merged.openings[0];
  assert.deepEqual(where(merged), { c3: 'm', c4: '', c5: 'mine2', g: 'a b c h' });
  // k1 still holds the student's own line in c5, so it stays; k2 is theirs
  assert.deepEqual(o.courses.map((c) => c.id), ['k1', 'k2'], 'a course still holding the student\'s own lines stays');
  const gone = mergeBackup({ openings: [{ ...student.openings[0], chapters: student.openings[0].chapters.filter((c) => c.id !== 'c5' && c.id !== 'c3') }] }, guide, { structure: 'incoming' });
  assert.deepEqual(gone.openings[0].courses, [], 'and one it emptied goes');
  const lone = mergeBackup({ openings: [{ ...student.openings[0], courses: [], chapters: [{ id: 'z', name: 'Z', courseId: 'k9', variations: [line('z')] }] }] }, guide, { structure: 'incoming' });
  assert.equal(lone.openings[0].chapters[0].courseId, null, 'never left in a course that isn\'t there');
  assert.equal(o.chapters.find((c) => c.id === 'g').variations[0].srs.level, 2, 'progress kept');
  assert.deepEqual(merged.playlists[0].items.map((it) => it.chapterId), ['g', 'c3']);
  // an older delivery with no courses at all leaves the courses alone
  const old = mergeBackup(student, { openings: [{ id: 'o', name: 'Jobava London', chapters: [{ id: 'c1', name: 'Mainline', courseId: 'k1', variations: [line('a')] }] }] }, { structure: 'incoming' });
  assert.equal(old.openings[0].courses.length, 2);
  assert.equal(old.openings[0].chapters.length, 5);
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
