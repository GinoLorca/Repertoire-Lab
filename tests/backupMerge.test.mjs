// Merging a restored backup or a coach's delivery after lines were sent to a
// sub-variation on one side: each line ends up once, with its progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBackup } from '../src/lib/backup.js';

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
