// Sub-variations of a chapter, as the Library shows them: a folder (section)
// holding sub-variations (sub-sections), each its own chapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sendLines, makeSub, leaveFolder, subVariationsOf, branchOf, familyOf, suggestName, suggestParent, stemOf,
  headOf, isHead, destinationsFor, mergeLine, withFolderMates,
} from '../src/lib/subVariations.js';

const EX = ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5'];
const line = (id, name, moves, extra = {}) => ({ id, name, moves, ...extra });
const exchange = () => ({
  id: 'c-ex',
  name: 'Caro-Kann: Exchange Variation',
  section: null,
  subsection: null,
  courseId: null,
  variations: [
    line('x1', 'Caro-Kann Exchange Variation: 4.Nf3 #1', [...EX, 'Nf3', 'Nc6'], { learned: true, srs: { level: 3 } }),
    line('p1', 'Caro-Kann Exchange Variation Panov Attack: 5.Nc3 #1', [...EX, 'c4', 'Nf6', 'Nc3'], { comments: { 6: 'Panov!' } }),
    line('x2', 'Caro-Kann Exchange Variation: 4.Bd3 #2', [...EX, 'Bd3', 'Nc6']),
    line('p2', 'Caro-Kann Exchange Variation Panov Attack: 5.Nf3', [...EX, 'c4', 'Nf6', 'Nf3']),
  ],
});
const opening = (...chapters) => ({ id: 'o-caro', name: 'Caro-Kann', chapters });
const other = (id, name, extra = {}) => ({ id, name, section: null, subsection: null, courseId: null, variations: [], ...extra });
const shape = (o) => o.chapters.map((c) => [c.name, c.section ?? '', c.subsection ?? '', c.variations.map((v) => v.id).join(' ')]);

test('lines sent to a new sub-variation: the chapter heads a folder named after it, the lines move with everything they carry', () => {
  const o = opening(other('c-adv', 'Advance'), exchange(), other('c-cl', 'Classical'));
  const next = sendLines(o, { fromId: 'c-ex', ids: ['p1', 'p2'], newId: 'c-panov', name: 'Panov Attack' });
  assert.deepEqual(shape(next), [
    ['Advance', '', '', ''],
    ['Caro-Kann: Exchange Variation', 'Caro-Kann: Exchange Variation', '', 'x1 x2'],
    ['Panov Attack', 'Caro-Kann: Exchange Variation', 'Panov Attack', 'p1 p2'],
    ['Classical', '', '', ''],
  ]);
  const panov = next.chapters.find((c) => c.id === 'c-panov');
  assert.deepEqual(panov.variations[0].comments, { 6: 'Panov!' }, 'comments, progress, ids all travel');
  assert.equal(next.chapters.find((c) => c.id === 'c-adv'), o.chapters[0], 'untouched chapters are the same objects');
});

test('more lines to an existing sub-variation; a line already there isn\'t doubled', () => {
  let o = sendLines(opening(exchange()), { fromId: 'c-ex', ids: ['p1'], newId: 'c-panov', name: 'Panov Attack' });
  assert.deepEqual(subVariationsOf(o, o.chapters[0]).map((c) => c.id), ['c-panov']);
  o = sendLines(o, { fromId: 'c-ex', ids: ['p2'], toId: 'c-panov' });
  assert.deepEqual(o.chapters.find((c) => c.id === 'c-panov').variations.map((v) => v.id), ['p1', 'p2']);
  assert.deepEqual(o.chapters[0].variations.map((v) => v.id), ['x1', 'x2']);
});

test('a chapter already in a folder keeps it; its sub-variation goes in the same folder — a sibling, since there are two levels', () => {
  const ex = { ...exchange(), section: 'Sidelines', subsection: 'Exchange' };
  const o = sendLines(opening(ex, other('c-two', 'Two Knights', { section: 'Sidelines' })), {
    fromId: 'c-ex', ids: ['p1'], newId: 'c-panov', name: 'Panov Attack',
  });
  assert.deepEqual(shape(o), [
    ['Caro-Kann: Exchange Variation', 'Sidelines', 'Exchange', 'x1 x2 p2'],
    ['Two Knights', 'Sidelines', '', ''],
    ['Panov Attack', 'Sidelines', 'Panov Attack', 'p1'],
  ]);
});

test('nothing to send, an unknown chapter, a missing name, or sending to itself: nothing changes', () => {
  const o = opening(exchange());
  assert.equal(sendLines(o, { fromId: 'c-ex', ids: [], newId: 'n', name: 'X' }), o);
  assert.equal(sendLines(o, { fromId: 'nope', ids: ['p1'], newId: 'n', name: 'X' }), o);
  assert.equal(sendLines(o, { fromId: 'c-ex', ids: ['p1'], newId: 'n', name: '  ' }), o);
  assert.equal(sendLines(o, { fromId: 'c-ex', ids: ['p1'], toId: 'c-ex' }), o);
  assert.equal(sendLines(o, { fromId: 'c-ex', ids: ['p1'], toId: 'missing' }), o);
});

test('a chapter filed under another: that one heads the folder, this one is its sub-variation, placed inside it', () => {
  const o = opening(other('c-panov', 'Panov Attack', { variations: [line('p1', 'P', [...EX, 'c4'])] }), exchange(), other('c-adv', 'Advance'));
  const next = makeSub(o, { chapterId: 'c-panov', parentId: 'c-ex' });
  assert.deepEqual(shape(next).map((r) => r.slice(0, 3)), [
    ['Caro-Kann: Exchange Variation', 'Caro-Kann: Exchange Variation', ''],
    ['Panov Attack', 'Caro-Kann: Exchange Variation', 'Panov Attack'],
    ['Advance', '', ''],
  ]);
});

test('a chapter filed into an existing folder, like Classical (Mainline) with its Tartakower and Karpov', () => {
  const o = opening(
    other('c-t', 'Classical (Mainline) Tartakower', { section: 'Classical (Mainline) Variation', subsection: 'Tartakower Variation' }),
    other('c-k', 'Classical (Mainline) Karpov', { section: 'Classical (Mainline) Variation', subsection: 'Karpov Variation' }),
    other('c-adv', 'Advance'),
    other('c-4q', 'Classical 4...Qd7'),
  );
  const next = makeSub(o, { chapterId: 'c-4q', section: 'Classical (Mainline) Variation' });
  assert.deepEqual(shape(next).map((r) => r.slice(0, 3)), [
    ['Classical (Mainline) Tartakower', 'Classical (Mainline) Variation', 'Tartakower Variation'],
    ['Classical (Mainline) Karpov', 'Classical (Mainline) Variation', 'Karpov Variation'],
    ['Classical 4...Qd7', 'Classical (Mainline) Variation', 'Classical 4...Qd7'],
    ['Advance', '', ''],
  ]);
});

test('a chapter heading its own folder, filed elsewhere, brings its sub-variations along', () => {
  let o = sendLines(opening(exchange(), other('c-main', 'Mainlines', { section: 'Mainlines' })), {
    fromId: 'c-ex', ids: ['p1', 'p2'], newId: 'c-panov', name: 'Panov Attack',
  });
  o = makeSub(o, { chapterId: 'c-ex', parentId: 'c-main' });
  assert.deepEqual(shape(o).map((r) => r.slice(0, 3)), [
    ['Mainlines', 'Mainlines', ''],
    ['Caro-Kann: Exchange Variation', 'Mainlines', 'Caro-Kann: Exchange Variation'],
    ['Panov Attack', 'Mainlines', 'Panov Attack'],
  ]);
});

test('filed under a chapter of another course, it joins that course', () => {
  const o = opening(other('a', 'A', { courseId: 'k1' }), other('b', 'B', { courseId: 'k2' }));
  const next = makeSub(o, { chapterId: 'b', parentId: 'a' });
  assert.equal(next.chapters.find((c) => c.id === 'b').courseId, 'k1');
  assert.equal(makeSub(o, { chapterId: 'a', parentId: 'a' }), o, 'not under itself');
});

test('out of its folder again', () => {
  const o = opening(other('a', 'A', { section: 'S', subsection: 'A' }), other('b', 'B'));
  const next = leaveFolder(o, 'a');
  assert.equal(next.chapters[0].section, null);
  assert.equal(next.chapters[0].subsection, null);
  assert.equal(leaveFolder(next, 'b'), next, 'already on its own: unchanged');
});

test('which lines go together: the same move where the chapter\'s lines part ways', () => {
  const ch = exchange();
  assert.deepEqual(branchOf(ch.variations, 'p2'), { ids: ['p1', 'p2'], label: '4.c4' });
  assert.deepEqual(branchOf(ch.variations, 'x1'), { ids: ['x1'], label: '4.Nf3' });
  assert.deepEqual(stemOf(ch.variations), EX);
});

test('a name from the line names, or else from the move', () => {
  assert.equal(familyOf('Caro-Kann Exchange Variation Panov Attack: 5.Nc3 #1'), 'Caro-Kann Exchange Variation Panov Attack');
  assert.equal(familyOf('Karpov 5.Ng5 #3'), 'Karpov 5.Ng5');
  const ch = exchange();
  assert.equal(suggestName(ch, ['p1', 'p2']), 'Panov Attack');
  const unnamed = { ...ch, variations: ch.variations.map((v, i) => ({ ...v, name: `Line ${i + 1}` })) };
  assert.equal(suggestName(unnamed, ['p1', 'p2']), '4.c4');
  // Every line sent: named against the chapter itself.
  const all = { ...ch, name: 'Caro-Kann Exchange Variation', variations: ch.variations.filter((v) => v.id.startsWith('p')) };
  assert.equal(suggestName(all, ['p1', 'p2']), 'Panov Attack');
});

test('the likeliest parent shares the most opening moves', () => {
  const panov = { variations: [line('p1', 'P', [...EX, 'c4', 'Nf6']), line('p2', 'P', [...EX, 'c4', 'e6'])] };
  const cands = [
    { key: 'advance', lines: [line('a', 'A', ['e4', 'c6', 'd4', 'd5', 'e5'])] },
    { key: 'exchange', lines: exchange().variations.slice(0, 1).concat(exchange().variations[2]) },
    { key: 'empty', lines: [] },
  ];
  assert.equal(suggestParent(cands, panov), 'exchange');
  // The Advance shares 1.e4 c6 2.d4 d5 with the Exchange and the Classical
  // alike: no suggestion rather than a coin toss.
  const advance = { variations: [line('a', 'A', ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5'])] };
  const tie = [
    { key: 'exchange', lines: [line('x', 'X', EX)] },
    { key: 'classical', lines: [line('c', 'C', ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4'])] },
  ];
  assert.equal(suggestParent(tie, advance), null);
});

// ---------- From the review ----------

test('a line sent to where a copy of it already is: the two are merged — the progress, notes and badges of both survive', () => {
  const o = opening(
    exchange(),
    other('c-panov', 'Panov Attack', {
      section: 'Caro-Kann: Exchange Variation',
      subsection: 'Panov Attack',
      variations: [line('p1', 'P', [...EX, 'c4'], { comments: { 7: 'theirs' }, badges: { 6: 'good' } })],
    }),
  );
  const ex = o.chapters[0];
  o.chapters[0] = { ...ex, section: 'Caro-Kann: Exchange Variation', variations: ex.variations.map((v) => (v.id === 'p1'
    ? { ...v, learned: true, srs: { level: 4, lastReview: 2e12 }, comments: { 6: 'mine' } } : v)) };
  const next = sendLines(o, { fromId: 'c-ex', ids: ['p1'], toId: 'c-panov' });
  const p1 = next.chapters.find((c) => c.id === 'c-panov').variations;
  assert.equal(p1.length, 1, 'one copy');
  assert.equal(p1[0].srs.level, 4, 'the sender\'s progress kept');
  assert.equal(p1[0].learned, true);
  assert.deepEqual(p1[0].comments, { 6: 'mine', 7: 'theirs' });
  assert.deepEqual(p1[0].badges, { 6: 'good' });
});

test('which chapter a folder is of: its one loose chapter — renaming the folder or the chapter doesn\'t change it', () => {
  let o = sendLines(opening(exchange()), { fromId: 'c-ex', ids: ['p1'], newId: 'c-panov', name: 'Panov Attack' });
  // The folder renamed (as the Library's "Rename section" does).
  o = { ...o, chapters: o.chapters.map((c) => ({ ...c, section: 'Exchange Variation' })) };
  assert.equal(headOf(o.chapters, 'Exchange Variation')?.id, 'c-ex');
  assert.ok(isHead(o.chapters, o.chapters[0]));
  // …so filing it elsewhere still brings Panov along.
  o = { ...o, chapters: [...o.chapters, other('c-main', 'Mainlines', { section: 'Mainlines' })] };
  const next = makeSub(o, { chapterId: 'c-ex', parentId: 'c-main' });
  assert.equal(next.chapters.find((c) => c.id === 'c-panov').section, 'Mainlines');
  // A folder with no loose chapter has no head; two loose, the one named like it.
  assert.equal(headOf([other('t', 'T', { section: 'S', subsection: 'T' })], 'S'), null);
  assert.equal(headOf([other('a', 'A', { section: 'S' }), other('s', 'S', { section: 'S' })], 'S').id, 's');
});

test('a chapter in no folder has no sub-variations, even when a folder carries its name', () => {
  const o = opening(other('a', 'A'), other('p', 'P', { section: 'A', subsection: 'P' }));
  assert.deepEqual(subVariationsOf(o, o.chapters[0]), []);
});

test('from a sub-variation, lines can go back to the chapter the folder is of', () => {
  const o = sendLines(opening(exchange()), { fromId: 'c-ex', ids: ['p1', 'p2'], newId: 'c-panov', name: 'Panov Attack' });
  const panov = o.chapters.find((c) => c.id === 'c-panov');
  assert.deepEqual(destinationsFor(o, panov).map((c) => c.id), ['c-ex']);
  const back = sendLines(o, { fromId: 'c-panov', ids: ['p2'], toId: 'c-ex' });
  assert.deepEqual(back.chapters.find((c) => c.id === 'c-ex').variations.map((v) => v.id), ['x1', 'x2', 'p2']);
});

test('the last sub-variation leaving a folder dissolves it; a chapter filed into the folder named after it heads it again', () => {
  let o = sendLines(opening(exchange()), { fromId: 'c-ex', ids: ['p1'], newId: 'c-panov', name: 'Panov Attack' });
  o = leaveFolder(o, 'c-panov');
  assert.deepEqual(o.chapters.map((c) => [c.id, c.section ?? null, c.subsection ?? null]), [['c-ex', null, null], ['c-panov', null, null]]);
  // Out and back in: the Exchange chapter filed into "its" folder is its head, not a sub-variation of itself.
  o = sendLines(o, { fromId: 'c-ex', ids: ['p2'], newId: 'c-panov2', name: 'Panov 2' });
  o = leaveFolder(o, 'c-ex');
  o = makeSub(o, { chapterId: 'c-ex', section: 'Caro-Kann: Exchange Variation' });
  const ex = o.chapters.find((c) => c.id === 'c-ex');
  assert.deepEqual([ex.section, ex.subsection], ['Caro-Kann: Exchange Variation', null]);
});

test('a new sub-variation keeps the chapter\'s star and themes; a line\'s video timestamp doesn\'t follow it to a chapter without that video', () => {
  const ex = { ...exchange(), starred: true, tags: ['IQP'], video: { id: 'vid1' } };
  ex.variations = ex.variations.map((v) => (v.id === 'p1' ? { ...v, videoTimestamp: 95 } : v));
  const o = sendLines(opening(ex), { fromId: 'c-ex', ids: ['p1'], newId: 'c-panov', name: 'Panov Attack' });
  const panov = o.chapters.find((c) => c.id === 'c-panov');
  assert.equal(panov.starred, true);
  assert.deepEqual(panov.tags, ['IQP']);
  assert.notEqual(panov.tags, ex.tags, 'a copy, not the same array');
  assert.equal('videoTimestamp' in panov.variations[0], false);
});

test('a sub-variation filed into another folder keeps its sub-variation name', () => {
  const o = opening(
    other('a', 'Chapter A', { section: 'S', subsection: 'Nice name' }),
    other('t', 'T', { section: 'T2', subsection: 'x' }),
  );
  assert.equal(makeSub(o, { chapterId: 'a', section: 'T2' }).chapters.find((c) => c.id === 'a').subsection, 'Nice name');
});

test('two courses with a chapter of the same name get separate folders', () => {
  const o = {
    id: 'o',
    courses: [{ id: 'k1', name: 'Bortnyk' }, { id: 'k2', name: 'Moser' }],
    chapters: [
      other('e1', 'Exchange Variation', { courseId: 'k1', section: 'Exchange Variation' }),
      other('e2', 'Exchange Variation', { courseId: 'k2', variations: [line('v', 'V', EX)] }),
    ],
  };
  const next = sendLines(o, { fromId: 'e2', ids: ['v'], newId: 'n', name: 'Panov' });
  assert.equal(next.chapters.find((c) => c.id === 'e2').section, 'Exchange Variation (Moser)');
});

test('a head moved to another course takes its folder with it', () => {
  const o = sendLines(opening(exchange()), { fromId: 'c-ex', ids: ['p1'], newId: 'c-panov', name: 'Panov Attack' });
  assert.deepEqual(withFolderMates(o, 'c-ex').sort(), ['c-ex', 'c-panov']);
  assert.deepEqual(withFolderMates(o, 'c-panov'), ['c-panov'], 'a sub-variation moves alone');
});

test('a new chapter id already in use is refused', () => {
  const o = opening(exchange());
  assert.equal(sendLines(o, { fromId: 'c-ex', ids: ['p1'], newId: 'c-ex', name: 'X' }), o);
});

test('names: a colon that isn\'t followed by a move is part of the name, and punctuation doesn\'t split words', () => {
  assert.equal(familyOf('Caro-Kann: Exchange Variation'), 'Caro-Kann: Exchange Variation');
  assert.equal(familyOf('Caro-Kann: Exchange: 4.Bd3 #2'), 'Caro-Kann: Exchange');
  const ch = {
    name: 'Caro-Kann: Exchange Variation',
    variations: [line('a', 'Caro-Kann: Exchange Variation, Panov: 5.Nf3', [...EX, 'c4']), line('b', 'Caro-Kann: Exchange Variation: 4.Bd3', [...EX, 'Bd3'])],
  };
  assert.equal(suggestName(ch, ['a']), 'Panov');
});

test('merging two copies of a line', () => {
  const a = { id: 'x', name: 'A', learned: false, srs: { level: 1, lastReview: 5 }, tags: ['t1'] };
  const b = { id: 'x', name: 'B', learned: true, srs: { level: 3, lastReview: 9 }, tags: ['t2'], starred: true };
  const m = mergeLine(a, b);
  assert.equal(m.name, 'A', 'the kept copy\'s content');
  assert.equal(m.learned, true);
  assert.equal(m.srs.level, 3, 'the more recent review');
  assert.deepEqual(m.tags, ['t1', 't2']);
  assert.equal(m.starred, true);
});

