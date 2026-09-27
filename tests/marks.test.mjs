// Arrows and highlighted squares on a line's moves: carried inside the move's
// comment as PGN's [%cal]/[%csl] commands, through import, editing and export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMarks, encodeMarks, withText, withMarks, toggleArrow, toggleSquare, commentAt,
  drawingOf, marksOfDrawing, withoutArrow,
} from '../src/lib/marks.js';
import { movetextToLines, movesToMovetext } from '../src/lib/pgn.js';
import { pgnTextToEntries } from '../src/lib/pgnImport.js';
import { merge3 } from '../src/lib/cloud/merge3.js';

test('a comment taken apart and put back together', () => {
  const m = parseMarks('Watch e5. [%cal Gf3e5,Rc6e5] [%csl Ye5] [%clk 0:10:00]');
  assert.equal(m.text, 'Watch e5.');
  assert.deepEqual(m.cal, [{ c: 'G', from: 'f3', to: 'e5' }, { c: 'R', from: 'c6', to: 'e5' }]);
  assert.deepEqual(m.csl, [{ c: 'Y', sq: 'e5' }]);
  assert.deepEqual(m.other, ['[%clk 0:10:00]'], 'other commands are kept, not thrown away');
  assert.equal(encodeMarks(m), '[%csl Ye5] [%cal Gf3e5,Rc6e5]');
  assert.deepEqual(parseMarks('[%cal ge2e4]').cal, [{ c: 'G', from: 'e2', to: 'e4' }], 'lower-case colours read too');
});

test('editing the words keeps the arrows; drawing keeps the words', () => {
  const raw = 'Old words [%cal Gf3e5]';
  assert.equal(withText(raw, 'New words'), 'New words [%cal Gf3e5]');
  assert.equal(withText(raw, ''), '[%cal Gf3e5]', 'words cleared: the arrows stay');
  const drawn = withMarks(raw, toggleSquare(toggleArrow(parseMarks(raw), 'd1', 'h5', 'R'), 'f7', 'Y'));
  assert.equal(drawn, 'Old words [%csl Yf7] [%cal Gf3e5,Rd1h5]');
  assert.equal(withMarks('Only words', { cal: [], csl: [] }), 'Only words');
  assert.equal(withMarks('[%cal Gf3e5]', { cal: [], csl: [] }), '', 'nothing left: an empty comment');
});

test('drawing the same arrow or square again takes it away; another colour recolours it', () => {
  let m = { cal: [], csl: [] };
  m = toggleArrow(m, 'e2', 'e4', 'G');
  assert.equal(m.cal.length, 1);
  m = toggleArrow(m, 'e2', 'e4', 'R');
  assert.deepEqual(m.cal, [{ c: 'R', from: 'e2', to: 'e4' }]);
  m = toggleArrow(m, 'e2', 'e4', 'R');
  assert.deepEqual(m.cal, []);
  m = toggleSquare(toggleSquare(m, 'd5', 'B'), 'd5', 'B');
  assert.deepEqual(m.csl, []);
});

test('PGN in: arrows on moves and on the starting position arrive with the line', () => {
  const [line] = movetextToLines('{Intro. [%cal Ge2e4]} 1.e4 {[%csl Gd5]} c6 2.d4 d5 {The Caro. [%cal Rd5e4]}');
  assert.equal(line.comments[-1], 'Intro. [%cal Ge2e4]');
  assert.equal(line.comments[0], '[%csl Gd5]');
  assert.equal(line.comments[3], 'The Caro. [%cal Rd5e4]');
  assert.equal(commentAt(line.comments, 0), 'Intro. [%cal Ge2e4]');
  assert.equal(commentAt(line.comments, 1), '[%csl Gd5]');
});

test('PGN in: a comment opening a side line is about the position it branches from', () => {
  const lines = movetextToLines('1.e4 c6 2.d4 d5 3.e5 ({The Exchange instead [%cal Ge4d5]} 3.exd5 cxd5) 3...Bf5');
  const exchange = lines.find((l) => l.moves[4] === 'exd5');
  assert.equal(exchange.comments[3], 'The Exchange instead [%cal Ge4d5]');
  assert.equal(lines[0].comments[3], undefined, 'not on the main line');
});

test('PGN out and back in: the arrows survive the round trip', () => {
  const comments = { [-1]: '[%cal Ge2e4]', 0: 'Best by test [%csl Ye4]', 3: '[%cal Gf8b4,Rd8h4]' };
  const text = movesToMovetext(['e4', 'c6', 'd4', 'd5'], comments, {});
  assert.ok(text.startsWith('{[%cal Ge2e4]} 1.e4'), text);
  const [back] = movetextToLines(text);
  assert.deepEqual(back.comments, { [-1]: '[%cal Ge2e4]', 0: 'Best by test [%csl Ye4]', 3: '[%cal Gf8b4,Rd8h4]' });
});

test('a note keeps the line breaks typed into it when its arrows change', () => {
  assert.equal(parseMarks('Plan A: d5 [%cal Ge2e4]\nPlan B:  f4 [%csl Ye5]').text, 'Plan A: d5\nPlan B: f4');
  assert.equal(withMarks('one\ntwo', { cal: [{ c: 'G', from: 'e2', to: 'e4' }], csl: [] }), 'one\ntwo [%cal Ge2e4]');
});

test('marks go across to Analysis\'s drawing and come back the same', () => {
  const m = parseMarks('x [%cal Gf3e5,Rd8d1,Bb1c3,Ya1a8] [%csl Ye5,Rd4]');
  const back = marksOfDrawing(drawingOf(m));
  assert.equal(encodeMarks(back), encodeMarks(m));
  assert.deepEqual(marksOfDrawing(undefined), { cal: [], csl: [] });
  assert.equal(withoutArrow('Defends [%cal Gb8c6,Gg8f6] [%clk 0:01:00]', 'b8', 'c6'), 'Defends [%cal Gg8f6] [%clk 0:01:00]');
  assert.equal(withoutArrow('No arrow here', 'b8', 'c6'), 'No arrow here');
});

test('a side line doesn\'t inherit the arrow pointing out the main line\'s reply', () => {
  const [main, petroff] = movetextToLines(
    '1. e4 e5 2. Nf3 {Black defends e5 [%cal Gb8c6]} 2... Nc6 ({The Petroff [%cal Gg8f6]} 2... Nf6 3. Nxe5) 3. Bb5',
  );
  assert.equal(main.comments[2], 'Black defends e5 [%cal Gb8c6]');
  assert.deepEqual(petroff.moves, ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5']);
  assert.deepEqual(parseMarks(petroff.comments[2]).cal.map((a) => a.from + a.to), ['g8f6']);
  assert.match(petroff.comments[2], /Black defends e5/);
  // At the very start too.
  const [, d4] = movetextToLines('{Start [%cal Ge2e4,Gd7d5]} 1. e4 (1. d4 d5) 1... e5');
  assert.equal(d4.comments[-1], 'Start [%cal Gd7d5]');
});

test('lines pasted one per row, each opening with its own {comment}, stay separate', () => {
  const entries = pgnTextToEntries(
    '{Main idea [%cal Ge2e4]} 1. e4 e5 2. Nf3 Nc6\n{The Queen\'s Gambit [%cal Gc2c4]} 1. d4 d5 2. c4 e6',
  );
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.ok));
  assert.equal(entries[1].comments[-1], "The Queen's Gambit [%cal Gc2c4]");
  // A comment on a row of its own introduces the line below it.
  const two = pgnTextToEntries('1. e4 e5 2. Nf3\n\n{Intro to the second}\n1. d4 d5');
  assert.equal(two.length, 2);
  assert.equal(two[0].comments[-1], undefined);
  assert.equal(two[1].comments[-1], 'Intro to the second');
});

test('sync: arrows drawn on one device and words changed on another, same move, both kept', () => {
  const base = { id: 'v', comments: { 3: 'Quiet.' } };
  const mac = { id: 'v', comments: { 3: 'Quiet. [%cal Gg1f3]' } };
  const ipad = { id: 'v', comments: { 3: 'A quiet move.' } };
  assert.equal(merge3(base, mac, ipad).comments[3], 'A quiet move. [%cal Gg1f3]');
  assert.equal(merge3(base, ipad, mac).comments[3], 'A quiet move. [%cal Gg1f3]');
  // Each drew a different arrow: both.
  assert.equal(
    merge3({ id: 'v', comments: { 0: 'x' } }, { id: 'v', comments: { 0: 'x [%cal Ge2e4]' } }, { id: 'v', comments: { 0: 'x [%cal Rd2d4]' } }).comments[0],
    'x [%cal Ge2e4,Rd2d4]',
  );
  // One took an arrow off while the other reworded: the arrow stays off.
  assert.equal(
    merge3({ id: 'v', comments: { 0: 'hi [%cal Ge2e4]' } }, { id: 'v', comments: { 0: 'hi' } }, { id: 'v', comments: { 0: 'hello [%cal Ge2e4]' } }).comments[0],
    'hello',
  );
});
