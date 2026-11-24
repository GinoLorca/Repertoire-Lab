// Board changes written into a game's Game Review — src/lib/reviewEdit.js,
// read back the way the analysis board and Chess Arcade read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setMarksAt, setCommentAt, setBadgeAt, setLineColorAt, removeLineFrom, hasLineFrom, fits, reviewBadge,
} from '../src/lib/reviewEdit.js';
import { reviewOnBoard, refOf, PEN_HEX } from '../src/lib/reviewOnBoard.js';
import { makeTree, mainLineFrom } from '../src/lib/moveTree.js';

const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'];
const AN = JSON.stringify({
  v: 1, l: [[4, 'f1c4', 'f8c5', 'c2c3']], c: [[5, 'Ruy']], m: [[5, 'Gb5c6 Re1e8', 'Ye5']],
  b: [[5, 's']], k: [[5, 'A', 'pin']], t: [[[7], 'pin', 'b', 'm', 'a4c6', '']], h: [[[4, 'f1c4'], 'p']], zz: [1, 2],
});
const read = (an) => reviewOnBoard({ tree: makeTree(MOVES), moves: MOVES, records: { an } });
const at = (r, p) => mainLineFrom(r.tree)[p - 1].id;

test('an arrow drawn in Game Review taken off on the board is gone; put back, it\'s back — the rest as it was', () => {
  const r0 = read(AN);
  const drawn = r0.drawn[at(r0, 5)];
  assert.deepEqual(drawn.arrows, [['b5', 'c6', PEN_HEX.G], ['e1', 'e8', PEN_HEX.R]]);
  const off = setMarksAt(AN, 5, { arrows: [drawn.arrows[1]], squares: drawn.squares });
  const r1 = read(off);
  assert.deepEqual(r1.drawn[at(r1, 5)].arrows, [['e1', 'e8', PEN_HEX.R]]);
  const back = setMarksAt(off, 5, { arrows: [drawn.arrows[1], ['b5', 'c6', PEN_HEX.G]], squares: drawn.squares });
  const r2 = read(back);
  assert.equal(r2.drawn[at(r2, 5)].arrows.length, 2);
  const A = JSON.parse(back);
  assert.deepEqual(A.k, [[5, 'A', 'pin']], 'CLAMP untouched');
  assert.deepEqual(A.zz, [1, 2], 'a field Chess Arcade adds later, kept');
  assert.deepEqual(Object.keys(A), ['v', 'l', 'c', 'm', 'b', 'k', 't', 'h', 'zz'], 'in Chess Arcade\'s order');
  assert.ok(r1.tactics[at(r1, 7)], 'tactic untouched');
});

test('marks: all taken off, the move has none; colours drawn here go as Chess Arcade\'s pens', () => {
  const none = JSON.parse(setMarksAt(AN, 5, { arrows: [], squares: {} }));
  assert.deepEqual(none.m, []);
  const near = JSON.parse(setMarksAt(AN, 3, { arrows: [['g1', 'f3', '#39c5cf'], ['d2', 'd4', '#f0883e']], squares: { d4: '#e5534b' } }));
  assert.deepEqual(none.m.length, 0);
  assert.deepEqual(near.m.find((x) => x[0] === 3), [3, 'Lg1f3 Od2d4', 'Rd4']);
  const odd = JSON.parse(setMarksAt(AN, 3, { arrows: [['g1', 'f3', '#2fcb70']], squares: {} }));
  assert.deepEqual(odd.m.find((x) => x[0] === 3), [3, 'Gg1f3', ''], 'any other colour: the nearest pen');
});

test('a badge put on a move marked "No badge" takes that mark off; the rest of them, and a clear\'s date, stay', () => {
  const an = JSON.stringify({ v: 1, l: [], c: [], m: [], k: [[5, 'A']], n: [5, 7], rc: 1700 });
  assert.deepEqual(JSON.parse(setBadgeAt(an, 5, 'mistake')), { v: 1, l: [], c: [], m: [], b: [[5, 'm']], k: [[5, 'A']], n: [7], rc: 1700 });
  const back = JSON.parse(setBadgeAt(setBadgeAt(an, 5, 'mistake'), 5, null));
  assert.deepEqual([back.b, back.n, back.rc], [[], [7], 1700]);
  assert.deepEqual(JSON.parse(setCommentAt(an, 3, 'x')).n, [5, 7]);
  assert.deepEqual(JSON.parse(setBadgeAt(setCommentAt(JSON.stringify({ v: 1, rc: 5 }), 3, ''), 3, null)).rc, 5, 'a date alone is kept');
});

test('comments and badges, on a move and on a side line — the line kept in the record', () => {
  let an = setCommentAt(AN, 5, 'Ruy Lopez, edited');
  an = setCommentAt(an, [2, 'b1c3'], 'Or the Vienna');
  an = setBadgeAt(an, 6, 'mistake');
  an = setBadgeAt(an, 5, null);
  an = setBadgeAt(an, [2, 'b1c3'], 'interesting'); // not one of Chess Arcade's: no change
  const A = JSON.parse(an);
  assert.deepEqual(A.c, [[5, 'Ruy Lopez, edited'], [[2, 'b1c3'], 'Or the Vienna']]);
  assert.deepEqual(A.b, [[6, 'm']]);
  assert.ok(A.l.some((x) => JSON.stringify(x) === JSON.stringify([2, 'b1c3'])));
  const r = read(an);
  const vienna = mainLineFrom(r.tree)[1].children[1];
  assert.equal(vienna.san, 'Nc3');
  assert.equal(r.notes[vienna.id], 'Or the Vienna');
  assert.deepEqual(JSON.parse(setCommentAt(an, 5, '')).c, [[[2, 'b1c3'], 'Or the Vienna']]);
  assert.deepEqual(JSON.parse(setBadgeAt(setBadgeAt(AN, 5, null), 6, null)).b, [], 'b kept, empty, once all are off');
  assert.equal(reviewBadge('miss'), true);
  assert.equal(reviewBadge('interesting'), false);
});

test('a line kept goes on as far as it\'s marked; one already longer stays as it is', () => {
  const A = JSON.parse(setCommentAt(AN, [4, 'f1c4', 'f8c5'], 'inside the line'));
  assert.deepEqual(A.l, [[4, 'f1c4', 'f8c5', 'c2c3']]);
  const B = JSON.parse(setCommentAt(AN, [4, 'f1c4', 'f8c5', 'c2c3', 'g8f6'], 'further on'));
  assert.deepEqual(B.l, [[4, 'f1c4', 'f8c5', 'c2c3', 'g8f6']]);
});

test('a side line\'s colour, on its first move', () => {
  const A = JSON.parse(setLineColorAt(AN, [4, 'f1c4'], 'red'));
  assert.deepEqual(A.h, [[[4, 'f1c4'], 'r']]);
  assert.deepEqual(JSON.parse(setLineColorAt(AN, [4, 'f1c4'], null)).h, []);
  assert.equal(setLineColorAt(AN, 4, 'red'), AN, 'the game\'s own moves have no line colour');
  const r = read(setLineColorAt(AN, [4, 'f1c4'], 'white'));
  assert.deepEqual(Object.values(r.lineColors), ['white']);
});

test('a side line taken out from a move on: what came before stays, everything on it goes', () => {
  assert.ok(hasLineFrom(AN, [4, 'f1c4']));
  const whole = JSON.parse(removeLineFrom(AN, [4, 'f1c4']));
  assert.deepEqual(whole.l, []);
  assert.deepEqual(whole.h, []);
  const tail = JSON.parse(removeLineFrom(setCommentAt(AN, [4, 'f1c4', 'f8c5', 'c2c3'], 'c3 idea'), [4, 'f1c4', 'f8c5', 'c2c3']));
  assert.deepEqual(tail.l, [[4, 'f1c4', 'f8c5']]);
  assert.deepEqual(tail.c, [[5, 'Ruy']]);
  assert.deepEqual(tail.h, [[[4, 'f1c4'], 'p']]);
  assert.equal(hasLineFrom(AN, [2, 'b1c3']), false);
});

test('a record with nothing left is empty; a fresh game gets one; bad refs change nothing; the size limit', () => {
  const one = setMarksAt('', 1, { arrows: [['e2', 'e4', PEN_HEX.G]], squares: {} });
  assert.deepEqual(JSON.parse(one), { v: 1, l: [], c: [], m: [[1, 'Ge2e4', '']] });
  assert.equal(setMarksAt(one, 1, { arrows: [], squares: {} }), '');
  assert.equal(setCommentAt(AN, [4, 'zz'], 'x'), AN);
  assert.equal(setCommentAt(AN, -1, 'x'), AN);
  assert.ok(fits(AN));
  assert.equal(fits('x'.repeat(10001)), false);
});

test('the board\'s refs and the record\'s agree: what refOf names is where the change lands', () => {
  const r = read(AN);
  const c3 = mainLineFrom(r.tree)[3].children[1].children[0].children[0];
  const ref = refOf(r.tree, c3.id);
  assert.deepEqual(ref, { line: [4, 'f1c4', 'f8c5', 'c2c3'] });
  const r2 = read(setCommentAt(AN, ref.line, 'here'));
  assert.equal(Object.entries(r2.notes).find(([, t]) => t === 'here') !== undefined, true);
});
