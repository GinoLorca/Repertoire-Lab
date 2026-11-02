// Sending lines to another chapter — src/lib/chapterTransfer.js: copy or
// move, nothing sent twice, progress kept by a move and not by a copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSend, sendToChapter } from '../src/lib/chapterTransfer.js';

const v = (id, moves, extra = {}) => ({ id, name: id, moves: moves.split(' '), comments: {}, badges: {}, ...extra });
const OPENINGS = [
  {
    id: 'caro', name: 'Caro-Kann', color: 'black', chapters: [
      {
        id: 'panov', name: 'Panov', video: { url: 'x' }, variations: [
          v('p2', 'e4 c6 c4 d5 exd5 cxd5', { learned: true, srs: { due: 5 }, tags: ['Panov'], videoTimestamp: 30, comments: { 3: 'a note' } }),
          v('p3', 'e4 c6 c4 d5 exd5 cxd5 cxd5 Nf6'),
          v('p4', 'e4 c6 d4 d5'),
        ],
      },
      { id: 'exch', name: 'Exchange', variations: [v('e1', 'e4 c6 d4 d5')] },
    ],
  },
  { id: 'slav', name: 'Slav', color: 'black', chapters: [{ id: 's1', name: 'Main', variations: [] }] },
];
const FROM = { openingId: 'caro', chapterId: 'panov' };
const EXCH = { openingId: 'caro', chapterId: 'exch' };
const chapter = (os, oid, cid) => os.find((o) => o.id === oid).chapters.find((c) => c.id === cid);
let n = 0;
const newId = () => `new${++n}`;

test('a line the chapter already has is skipped', () => {
  const { lines, skipped } = planSend(OPENINGS, { from: FROM, to: EXCH, ids: ['p4', 'p2'] });
  assert.deepEqual(lines.map((x) => x.id), ['p2']);
  assert.deepEqual(skipped.map((x) => x.id), ['p4']);
});

test('move: out of here, into there, progress and themes along, the video link left behind', () => {
  const out = sendToChapter(OPENINGS, { from: FROM, to: EXCH, ids: ['p2', 'p3', 'p4'], mode: 'move' }, newId);
  assert.deepEqual(chapter(out, 'caro', 'panov').variations.map((x) => x.id), ['p4'], 'the skipped one stays');
  const there = chapter(out, 'caro', 'exch').variations;
  assert.deepEqual(there.map((x) => x.id), ['e1', 'p2', 'p3']);
  assert.equal(there[1].learned, true);
  assert.deepEqual(there[1].srs, { due: 5 });
  assert.deepEqual(there[1].tags, ['Panov']);
  assert.equal(there[1].comments[3], 'a note');
  assert.equal('videoTimestamp' in there[1], false);
});

test('copy: left here too; the copy is new, to be learned afresh', () => {
  const out = sendToChapter(OPENINGS, { from: FROM, to: { openingId: 'slav', chapterId: 's1' }, ids: ['p2'], mode: 'copy' }, newId);
  assert.equal(chapter(out, 'caro', 'panov').variations.length, 3);
  const [copy] = chapter(out, 'slav', 's1').variations;
  assert.match(copy.id, /^new/);
  assert.equal(copy.learned, false);
  assert.equal(copy.srs, null);
  assert.deepEqual(copy.moves, OPENINGS[0].chapters[0].variations[0].moves);
  assert.equal(copy.comments[3], 'a note');
  assert.equal(chapter(out, 'caro', 'panov').variations[0].learned, true, 'the original keeps its progress');
});

test('to the same chapter, or nothing to send: unchanged', () => {
  assert.equal(sendToChapter(OPENINGS, { from: FROM, to: FROM, ids: ['p2'], mode: 'move' }, newId), OPENINGS);
  assert.equal(sendToChapter(OPENINGS, { from: FROM, to: EXCH, ids: ['p4'], mode: 'move' }, newId), OPENINGS);
});
