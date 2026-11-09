// Curated chapters for a student — src/lib/curate.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  curateInto, guidePlan, reorganise, coachLines, GUIDE_NAME,
} from '../src/lib/curate.js';

let n = 0;
const newId = () => `new${(n += 1)}`;
const line = (id, name, moves, extra = {}) => ({ id, name, moves, comments: { 1: 'note' }, badges: {}, learned: true, srs: { due: 5 }, ...extra });

const coach = {
  id: 'jl', name: 'Jobava London System', color: 'white', ownerId: null,
  courses: [{ id: 'cA', name: 'Midas Ratsma' }, { id: 'cB', name: 'Simon Williams' }],
  chapters: [
    { id: 'ch1', name: 'Mainline 3.e6', courseId: 'cA', variations: [line('v1', 'Main', ['d4', 'd5']), line('v2', 'Side', ['d4', 'Nf6'])] },
    { id: 'ch2', name: 'Kings Indian setup', courseId: 'cB', variations: [line('v3', 'KID', ['d4', 'Nf6', 'Nc3', 'g6'])] },
  ],
};
const studentOpening = {
  id: 'sjl', name: 'Jobava London System', color: 'white', ownerId: 'myla',
  courses: [{ id: 'scA', name: 'Midas Ratsma' }],
  chapters: [
    { id: 'sch1', name: 'Mainline 3.e6', courseId: 'scA', tags: ['basics'], starred: true, video: { id: 'vid1' }, variations: [line('s1', 'Main', ['d4', 'd5'], { learned: true, srs: { due: 9 } })] },
    { id: 'sch2', name: 'Empty one', courseId: null, variations: [] },
  ],
};
const guide = { id: 'sg', name: 'My guide', curated: true, courseId: null, variations: [] };

test('lines from different chapters and courses of the coach’s go into one curated chapter, fresh, never twice', () => {
  const st = { ...studentOpening, chapters: [...studentOpening.chapters, guide] };
  const out = curateInto([coach, st], { toOpeningId: 'sjl', toChapterId: 'sg', variationIds: ['v1', 'v3', 'v2', 'nope'] }, newId);
  const g = out.openings[1].chapters.find((c) => c.id === 'sg');
  // v1 is the same line the student already has (Main, d4 d5): not copied again
  assert.deepEqual(g.variations.map((v) => v.name), ['KID', 'Side']);
  assert.equal(out.added, 2);
  assert.deepEqual(out.skipped, ['Main']);
  const kid = g.variations[0];
  assert.notEqual(kid.id, 'v3', 'a copy, with an id of its own');
  assert.equal(kid.learned, false);
  assert.equal(kid.srs, null);
  assert.deepEqual(kid.comments, { 1: 'note' });
  kid.comments[1] = 'changed';
  assert.equal(coach.chapters[1].variations[0].comments[1], 'note', 'editing the copy never reaches the coach’s line');
  // nothing into the coach's own repertoire, or a chapter that isn't there
  assert.equal(curateInto([coach, st], { toOpeningId: 'jl', toChapterId: 'ch1', variationIds: ['v3'] }, newId).added, 0);
  assert.equal(curateInto([coach, st], { toOpeningId: 'sjl', toChapterId: 'zz', variationIds: ['v3'] }, newId).added, 0);
  assert.equal(coachLines([coach, st]).get('v3').course.name, 'Simon Williams');
});

test('the plan says what will change; the change keeps every line and its progress', () => {
  const plan = guidePlan([coach, studentOpening], [{ id: 'myla', name: 'Myla Walavalkar' }]);
  assert.equal(plan.length, 1, 'the coach’s own openings are never touched');
  assert.deepEqual(plan[0], {
    openingId: 'sjl', opening: 'Jobava London System', ownerId: 'myla', student: 'Myla Walavalkar',
    courses: ['Midas Ratsma'], guide: GUIDE_NAME,
    chapters: [{ name: 'Mainline 3.e6', course: 'Midas Ratsma', lines: 1, video: true }, { name: 'Empty one', course: null, lines: 0, video: false }],
    lines: 1, videos: ['Mainline 3.e6'],
  });

  const { openings, moved } = reorganise([coach, studentOpening], {}, () => 'guide1');
  const o = openings[1];
  assert.deepEqual(o.courses, []);
  assert.equal(o.chapters.length, 1);
  const g = o.chapters[0];
  assert.equal(g.name, GUIDE_NAME);
  assert.equal(g.curated, true);
  assert.deepEqual(g.video, { id: 'vid1' }, 'the chapter’s video stays');
  assert.equal(g.variations[0].id, 's1', 'the same line, the same id');
  assert.deepEqual(g.variations[0].srs, { due: 9 }, 'and its progress');
  assert.deepEqual(g.variations[0].tags, ['basics'], 'what it took from its chapter goes onto it');
  assert.equal(g.variations[0].starred, true);
  assert.equal(moved.get('sch1|s1'), 'guide1');
  assert.equal(openings[0], coach);

  // two chapters with videos: the first video stays, and lines from the other
  // lose their moment in a video that's no longer theirs
  const two = {
    ...studentOpening,
    chapters: [
      { ...studentOpening.chapters[0], variations: [{ ...studentOpening.chapters[0].variations[0], videoTimestamp: 30 }] },
      { id: 'sch3', name: 'Other', video: { id: 'vid2' }, variations: [line('s3', 'X', ['e4'], { videoTimestamp: 12 })] },
    ],
  };
  assert.deepEqual(guidePlan([two])[0].videos, ['Mainline 3.e6', 'Other']);
  const g2 = reorganise([two], {}, () => 'g2').openings[0].chapters[0];
  assert.deepEqual(g2.video, { id: 'vid1' });
  assert.equal(g2.variations[0].videoTimestamp, 30);
  assert.equal('videoTimestamp' in g2.variations[1], false);

  // done once: an opening already curated isn't planned or changed again
  assert.equal(guidePlan(openings).length, 0);
  assert.equal(reorganise(openings, {}, () => 'again').openings[1], o);
  // a curated chapter already started becomes the guide: its name, its id, its lines first
  const begun = { ...studentOpening, chapters: [...studentOpening.chapters, { ...guide, name: 'Myla’s start', variations: [line('s9', 'Z', ['c4'])] }] };
  const r = reorganise([begun], {}, () => 'unused');
  assert.deepEqual(r.openings[0].chapters.map((c) => [c.id, c.name]), [['sg', 'Myla’s start']]);
  assert.deepEqual(r.openings[0].chapters[0].variations.map((v) => v.id), ['s9', 's1']);
  assert.equal(r.moved.get('sg|s9'), undefined, 'its own lines don’t move');
  assert.equal(r.moved.get('sch1|s1'), 'sg');

  // only the openings asked for
  assert.equal(reorganise([coach, studentOpening], { openingIds: ['other'] }, newId).openings[1], studentOpening);
});

test('the analysis board checks a student’s game against their lines and the coach’s whole library, by default', async () => {
  const { bookOpenings, bookName } = await import('../src/lib/repertoire.js');
  const all = [coach, studentOpening, { id: 'x', name: 'Other student', ownerId: 'zed', chapters: [] }];
  const ids = (list) => list.map((o) => o.id);
  assert.deepEqual(ids(bookOpenings(all, { studentId: 'myla' })), ['sjl', 'jl'], 'the student’s first, then yours');
  assert.deepEqual(ids(bookOpenings(all, { studentId: 'myla', source: 'mine' })), ['jl']);
  assert.deepEqual(ids(bookOpenings(all, { studentId: 'myla', source: 'student' })), ['sjl']);
  assert.deepEqual(bookOpenings(all, { studentId: 'myla', source: 'none' }), []);
  assert.deepEqual(ids(bookOpenings(all, {})), ['jl'], 'your own game: yours');
  assert.deepEqual(ids(bookOpenings(all, { source: 'student' })), ['jl']);
  assert.equal(bookName('both', 'Myla'), "Myla's + yours");
  assert.equal(bookName('both', null), 'Your repertoire');
  assert.equal(bookName('none', 'Myla'), 'No repertoire');
});

test('giving lines: where a student already has one, where it lands, and from another student’s repertoire too', async () => {
  const { whereHas, curatedTarget } = await import('../src/lib/curate.js');
  const parker = {
    id: 'pjl', name: 'Jobava London System', color: 'white', ownerId: 'parker', courses: [],
    chapters: [{ id: 'pg', name: GUIDE_NAME, curated: true, variations: [line('p1', 'Main', ['d4', 'd5'])] }],
  };
  const myla = { ...studentOpening, chapters: [...studentOpening.chapters, { ...guide, variations: [line('m9', 'Myla only', ['d4', 'f5'])] }] };
  const all = [coach, myla, parker];
  // Parker has "Main" (d4 d5) in his guide: that's where
  const w = whereHas(all, 'parker', 'jobava london system', 'Mainline 3.e6', coach.chapters[0].variations[0]);
  assert.equal(w.chapter.id, 'pg');
  assert.equal(whereHas(all, 'parker', 'Jobava London System', 'Mainline 3.e6', coach.chapters[0].variations[1]), null);
  // a curated opening takes given lines into its guide
  assert.deepEqual(curatedTarget(all, 'parker', 'Jobava London System').chapters.map((c) => c.id), ['pg']);
  assert.equal(curatedTarget(all, 'zed', 'Jobava London System'), null);
  assert.equal(curatedTarget([coach, studentOpening], 'myla', 'Jobava London System'), null, 'no curated chapter: the usual copy');
  // from Myla's guide into Parker's: copied fresh; never from Parker's own
  const out = curateInto(all, { toOpeningId: 'pjl', toChapterId: 'pg', variationIds: ['m9', 'p1'] }, newId);
  const pg = out.openings.find((o) => o.id === 'pjl').chapters[0];
  assert.deepEqual(pg.variations.map((v) => v.name), ['Main', 'Myla only']);
  assert.equal(out.added, 1);
  assert.notEqual(pg.variations[1].id, 'm9');
  assert.equal(pg.variations[1].learned, false);
});

test('a game’s identified line opens in the player’s own copy when they have it, else yours', async () => {
  const { lineFor } = await import('../src/lib/curate.js');
  const all = [coach, studentOpening];
  const [o, c] = [coach, coach.chapters[0]];
  // Myla has "Main" (d4 d5): hers
  assert.deepEqual(lineFor(all, 'myla', o, c, c.variations[0]), { openingId: 'sjl', chapterId: 'sch1', variationId: 's1' });
  // she hasn't got "Side": yours
  assert.deepEqual(lineFor(all, 'myla', o, c, c.variations[1]), { openingId: 'jl', chapterId: 'ch1', variationId: 'v2' });
  // your own card: yours
  assert.deepEqual(lineFor(all, null, o, c, c.variations[0]), { openingId: 'jl', chapterId: 'ch1', variationId: 'v1' });
});
