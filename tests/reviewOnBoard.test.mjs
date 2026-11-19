// A game's Game Review, read for the analysis board — src/lib/reviewOnBoard.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTree, mainLineFrom } from '../src/lib/moveTree.js';
import {
  reviewOnBoard, parseEngineReview, movesSig, badgeShown, marksWith, PEN_HEX, TACTIC_COLOR, CLAMP,
} from '../src/lib/reviewOnBoard.js';

const MOVES = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'];
const rv = (moves = MOVES, extra = {}) => JSON.stringify({
  at: 1700, n: moves.length, h: movesSig(moves), d: 15,
  e: '20,25,22,30,28,35,30,40,38,120,110', b: 'kkkksesixm', a: [91.2, 64.5], ...extra,
});
const AN = JSON.stringify({
  v: 1,
  l: [[4, 'f1c4', 'f8c5']],
  c: [[5, 'The Ruy Lopez.'], [[4, 'f1c4'], 'The Italian instead']],
  m: [[5, 'Gb5c6 Re1e8', 'Ye5 Bc6'], [0, 'Ge2e4', '']],
  b: [[5, 's'], [[4, 'f1c4', 'f8c5'], 'i'], [3, 'w']],
  h: [[[4, 'f1c4'], 'p']],
  k: [[5, 'A', 'pin idea'], [9, 'C'], [5, 'Z']],
  q: [[5, 'A', 'c6'], [5, 'A', 'e8'], [7, 'Z', 'a1']],
  o: [[6, 'L', 'their loose bishop', 'm', 'b5 c6']],
  t: [[[7], 'pin fork', 'b', 'm', 'a4c6', 'c6 a4', 'missed it'], [8, 'hangingPiece', 'w', 'p', 'b5c6', ''], [8, 'pin', 'w', 'p', '', '']],
});
const records = { note: 'Notes card text', an: AN, lr: '# Larry\nGood game.', rv: rv() };
const read = (extra = {}) => {
  const tree = makeTree(MOVES);
  const r = reviewOnBoard({ tree, moves: MOVES, records, side: 'white', ...extra });
  const main = mainLineFrom(r.tree);
  return { r, main, ply: (p) => (p === 0 ? 'root' : main[p - 1].id) };
};

test('side lines go onto the tree; the game\'s moves stay the main line', () => {
  const { r, main } = read();
  assert.deepEqual(main.map((n) => n.san), MOVES);
  const fourth = main[3];
  assert.deepEqual(fourth.children.map((c) => c.san), ['Bb5', 'Bc4']);
  assert.deepEqual(fourth.children[1].children.map((c) => c.san), ['Bc5']);
  assert.ok(r.tree !== null);
});

test('comments, arrows and squares, by move', () => {
  const { r, main, ply } = read();
  const bc4 = main[3].children[1].id;
  assert.equal(r.notes[ply(5)], 'The Ruy Lopez.');
  assert.equal(r.notes[bc4], 'The Italian instead');
  assert.deepEqual(r.marks[ply(5)].arrows, [['b5', 'c6', PEN_HEX.G], ['e1', 'e8', PEN_HEX.R]]);
  assert.equal(r.marks[ply(5)].squares.e5, PEN_HEX.Y);
  assert.equal(r.marks[ply(5)].squares.c6, PEN_HEX.B, 'a square drawn keeps its colour');
  assert.equal(r.marks[ply(5)].squares.e8, undefined, 'a CLAMP square isn\'t tinted: the board puts its letter there');
  assert.equal(CLAMP.A.color, '#2675cd');
  assert.deepEqual(r.marks.root.arrows, [['e2', 'e4', PEN_HEX.G]], 'the start position\'s marks');
});

test('badges: set by hand (side lines too), the engine\'s on the game\'s moves; the board\'s own win, then the review\'s', () => {
  const { r, main, ply } = read();
  const bc5 = main[3].children[1].children[0].id;
  assert.equal(r.ownBadges[ply(5)], 'best');
  assert.equal(r.ownBadges[bc5], 'inaccuracy');
  assert.equal(r.ownBadges[ply(3)], 'miss');
  assert.deepEqual(MOVES.map((_, i) => r.engineBadges[ply(i + 1)] ?? null),
    ['book', 'book', 'book', 'book', 'best', 'excellent', 'best', 'inaccuracy', 'blunder', 'mistake']);
  assert.equal(badgeShown(ply(5), {}, r), 'best', 'yours over the engine\'s');
  assert.equal(badgeShown(ply(9), {}, r), 'blunder');
  assert.equal(badgeShown(ply(9), { [ply(9)]: 'great' }, r), 'great', 'the board\'s own first');
  assert.deepEqual(r.accuracy, { white: 91.2, black: 64.5 });
});

test('a side line\'s highlight colours the whole line', () => {
  const { r, main } = read();
  assert.deepEqual(r.lineColors, { [main[3].children[1].id]: 'purple' });
});

test('CLAMP: yours with notes and squares, their slips with how it went; letters in order, unknown ones left out', () => {
  const { r, ply } = read();
  assert.deepEqual(r.clamp[ply(5)].map((c) => [c.letter, c.theirs, c.note, c.squares]), [['A', false, 'pin idea', ['c6', 'e8']]]);
  assert.deepEqual(r.clamp[ply(9)].map((c) => c.letter), ['C']);
  assert.deepEqual(r.clamp[ply(6)].map((c) => [c.letter, c.theirs, c.out, c.note, c.squares]), [['L', true, 'm', 'their loose bishop', ['b5', 'c6']]]);
  assert.equal(r.clamp[ply(7)], undefined);
});

test('tactics: names, whose chance and how it went, a note; their arrows and pieces on the board; a move in one chance only', () => {
  const { r, ply } = read();
  const [t7] = r.tactics[ply(7)];
  assert.deepEqual(t7.names, ['Pin', 'Fork']);
  assert.equal(t7.mine, false);
  assert.equal(t7.words, 'Your move allowed it. They (Black) missed it.');
  assert.equal(t7.note, 'missed it');
  assert.ok(r.marks[ply(7)].arrows.some((a) => a[0] === 'a4' && a[1] === 'c6' && a[2] === TACTIC_COLOR));
  assert.equal(r.marks[ply(7)].squares.a4, TACTIC_COLOR);
  assert.equal(r.tactics[ply(8)].length, 1, 'the second chance on the same move is left out');
  assert.equal(r.tactics[ply(8)][0].words, 'You (White) had it and played it.');
});

test('the Notes card and a Larry Review', () => {
  const { r } = read();
  assert.equal(r.note, 'Notes card text');
  assert.equal(r.larry, '# Larry\nGood game.');
});

test('the engine\'s review counts only for the moves it was run on', () => {
  assert.ok(parseEngineReview(rv(), MOVES));
  assert.equal(parseEngineReview(rv(), [...MOVES.slice(0, 9), 'd6']), null, 'other moves');
  assert.equal(parseEngineReview(rv(MOVES, { b: 'kk' }), MOVES), null, 'a badge short');
  assert.equal(parseEngineReview('not json', MOVES), null);
  const { r } = read({ records: { ...records, rv: rv(MOVES, { h: '00000000' }) } });
  assert.deepEqual(r.engineBadges, {});
  assert.equal(r.accuracy, null);
});

test('nothing in it, or nothing readable: null; junk refs are passed over', () => {
  const tree = makeTree(MOVES);
  assert.equal(reviewOnBoard({ tree, moves: MOVES, records: null }), null);
  assert.equal(reviewOnBoard({ tree, moves: MOVES, records: { note: '', an: '' } }), null);
  assert.equal(reviewOnBoard({ tree, moves: MOVES, records: { note: '', an: '{oops' } }), null);
  const junk = JSON.stringify({ v: 1, l: [[99, 'e2e4'], [4, 'e1e8'], 'x'], c: [[40, 'past the end'], [[2, 'zz'], 'bad move'], [2, 'kept']] });
  const r = reviewOnBoard({ tree, moves: MOVES, records: { an: junk } });
  assert.deepEqual(Object.values(r.notes), ['kept']);
  assert.deepEqual(mainLineFrom(r.tree).map((n) => n.san), MOVES, 'nothing added for refs that don\'t fit');
  assert.equal(tree.children[0].children[0].children[0].children[0].children.length, 1, 'the tree given is untouched');
});

test('a game from a set-up position', () => {
  const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
  const moves = ['e4', 'Kd7'];
  const an = JSON.stringify({ v: 1, l: [[1, 'e8f7']], c: [[[1, 'e8f7'], 'or Kf7']] });
  const r = reviewOnBoard({ tree: makeTree(moves), moves, startFen: fen, records: { an } });
  assert.deepEqual(r.tree.children[0].children.map((c) => c.san), ['Kd7', 'Kf7']);
  assert.equal(Object.values(r.notes)[0], 'or Kf7');
});

test('the board\'s own marks and the review\'s, together', () => {
  const own = { arrows: [['e2', 'e4', '#fff']], squares: { e4: '#000' } };
  const rev = { arrows: [['e2', 'e4', '#2ecc71'], ['d2', 'd4', '#2ecc71']], squares: { e4: '#e8b339', d4: '#e8b339' } };
  assert.deepEqual(marksWith(own, rev), { arrows: [['e2', 'e4', '#fff'], ['d2', 'd4', '#2ecc71']], squares: { e4: '#000', d4: '#e8b339' } });
  assert.equal(marksWith(own, undefined), own);
});

test('the move list\'s chips, and where Game Review opens at a move', async () => {
  const { chipsOf, refOf } = await import('../src/lib/reviewOnBoard.js');
  const { r, main, ply } = read();
  const chips = chipsOf(r);
  assert.deepEqual(chips[ply(5)].map((c) => [c.text, c.hollow]), [['A', false]]);
  assert.match(chips[ply(5)][0].title, /^Alignments: pin idea$/);
  assert.deepEqual(chips[ply(6)].map((c) => [c.text, c.hollow]), [['L', true]]);
  assert.match(chips[ply(6)][0].title, /their slip, missed: their loose bishop/);
  assert.deepEqual(chips[ply(7)].map((c) => c.text), ['T'], 'their chance: the plain dot');
  assert.deepEqual(chips[ply(8)].map((c) => c.text), ['✓'], 'yours, played: a tick');
  assert.equal(chipsOf(null), null);
  assert.deepEqual(refOf(r.tree, ply(5)), { ply: 5 });
  assert.deepEqual(refOf(r.tree, 'root'), { ply: 0 });
  assert.deepEqual(refOf(r.tree, main[3].children[1].children[0].id), { line: [4, 'f1c4', 'f8c5'] });
  assert.equal(refOf(r.tree, 'nope'), null);
});
