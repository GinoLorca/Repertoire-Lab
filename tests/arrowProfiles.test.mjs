// Arrow colour profiles — src/lib/arrowProfiles.js, from Chess Arcade:
// Default, Sequential and Strategic, drawn, recoloured and switched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEQUENCE, STRATEGIC, profileOf, nextProfile, drawArrow, drawSquare, recolorAll, resolveColors, colorOfNext,
  colorForPlain, squareMarkStyle, snapshotOf,
} from '../src/lib/arrowProfiles.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const GREEN = '#2ecc71'; const RED = '#e5534b'; const BLUE = '#3b9cff'; const YELLOW = '#e8b339';
const pen = GREEN;
const draw = (profile, fen, steps, start = null) => steps.reduce((m, s) => {
  const opts = {
    held: s.held ?? null, pen, profile, fen,
  };
  return s.sq ? drawSquare(m, s.sq, opts) : drawArrow(m, s.a.slice(0, 2), s.a.slice(2, 4), opts);
}, start);
const colours = (m) => m.arrows.map((a) => `${a[0]}${a[1]}:${a[2]}`);

test('the setting: three profiles, anything else is Default, and a click goes round', () => {
  assert.equal(profileOf({ arrowProfile: 'strategic' }), 'strategic');
  assert.equal(profileOf({ arrowProfile: 'fourth' }), 'default');
  assert.equal(profileOf({}), 'default');
  assert.deepEqual(['default', 'sequential', 'strategic'].map(nextProfile), ['sequential', 'strategic', 'default']);
});

test('the position, read from a FEN', () => {
  const s = snapshotOf('8/8/8/3pP3/8/8/8/8 w - d6 0 2');
  assert.equal(s.colors[36], 'w'); // e5
  assert.equal(s.types[35], 'p'); // d5
  assert.equal(s.colors[35], 'b');
  assert.equal(s.ep, 43); // d6
  assert.equal(snapshotOf(null).turn, 'w');
});

test('Default: the pen, as always', () => {
  let m = draw('default', START, [{ a: 'e2e4' }, { a: 'd2d4', held: RED }]);
  assert.deepEqual(colours(m), [`e2e4:${GREEN}`, `d2d4:${RED}`]);
  // The same arrow in the same colour takes it off; another colour replaces it.
  m = draw('default', START, [{ a: 'e2e4' }], m);
  assert.deepEqual(colours(m), [`d2d4:${RED}`]);
  m = draw('default', START, [{ a: 'd2d4', held: BLUE }], m);
  assert.deepEqual(colours(m), [`d2d4:${BLUE}`]);
});

test('Sequential: the next colour each time; a pen key takes no step', () => {
  let m = draw('sequential', START, [{ a: 'e2e4' }, { a: 'd2d4' }, { a: 'c2c4', held: RED }, { a: 'g1f3' }]);
  assert.deepEqual(colours(m), [`e2e4:${SEQUENCE[0]}`, `d2d4:${SEQUENCE[1]}`, `c2c4:${RED}`, `g1f3:${SEQUENCE[2]}`]);
  // A highlight takes the colour of the arrow before it.
  m = draw('sequential', START, [{ sq: 'e4' }], m);
  assert.equal(m.squares.e4, SEQUENCE[2]);
  assert.equal(draw('sequential', START, [{ sq: 'e4' }]).squares.e4, SEQUENCE[0], 'green with no arrow yet');
  // Taking the first off moves the later ones up a colour.
  m = draw('sequential', START, [{ a: 'e2e4' }], m);
  assert.deepEqual(colours(m), [`d2d4:${SEQUENCE[0]}`, `c2c4:${RED}`, `g1f3:${SEQUENCE[1]}`]);
  assert.equal(m.squares.e4, SEQUENCE[1]);
  // The 11th starts over at green.
  const files = 'abcdefgh';
  const eleven = Array.from({ length: 11 }, (_, i) => ({ a: `${files[i % 8]}${i < 8 ? '2' : '7'}${files[i % 8]}${i < 8 ? '3' : '6'}` }));
  const all = draw('sequential', START, eleven);
  assert.equal(all.arrows[9][2], SEQUENCE[9]);
  assert.equal(all.arrows[10][2], SEQUENCE[0]);
});

test('Strategic: by side and captures, along the line drawn', () => {
  const m = draw('strategic', START, [{ a: 'e2e4' }, { a: 'e7e5' }, { a: 'g1f3' }, { a: 'b8c6' }, { a: 'f3e5' }]);
  assert.deepEqual(colours(m), [`e2e4:${GREEN}`, `e7e5:${BLUE}`, `g1f3:${GREEN}`, `b8c6:${BLUE}`, `f3e5:${RED}`]);
  // From an empty square: the other side from the previous arrow.
  const n = draw('strategic', START, [{ a: 'e2e4' }, { a: 'd6d5' }]);
  assert.equal(n.arrows[1][2], BLUE);
  // A highlight with no arrow yet: the side to move's colour.
  assert.equal(draw('strategic', '4k3/8/8/8/8/8/8/4K3 b - - 0 1', [{ sq: 'e8' }]).squares.e8, BLUE);
});

test('Strategic: a knight’s fan of hops, and its second hop, stay White’s', () => {
  const m = draw('strategic', START, [{ a: 'g1f3' }, { a: 'g1h3' }, { a: 'f3g5' }, { a: 'g5f7' }]);
  assert.deepEqual(colours(m), [`g1f3:${GREEN}`, `g1h3:${GREEN}`, `f3g5:${GREEN}`, `g5f7:${RED}`]);
});

test('Strategic: a battery — the second piece into f7 is a capture too', () => {
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R w KQkq - 0 1';
  const m = draw('strategic', fen, [{ a: 'c4f7' }, { a: 'g5f7' }]);
  assert.deepEqual(colours(m), [`c4f7:${RED}`, `g5f7:${RED}`]);
});

test('Strategic: en passant, on the board and in the imagined line', () => {
  const onBoard = draw('strategic', 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3', [{ a: 'e5d6' }]);
  assert.equal(onBoard.arrows[0][2], RED);
  // A double step drawn in the line opens it: d2-d4, then e4xd3.
  const line = draw('strategic', 'rnbqkbnr/pppp1ppp/8/8/4p3/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [{ a: 'd2d4' }, { a: 'e4d3' }]);
  assert.deepEqual(colours(line), [`d2d4:${GREEN}`, `e4d3:${YELLOW}`]);
});

test('Strategic: a pen key keeps its colour but still counts as a move', () => {
  const m = draw('strategic', START, [{ a: 'e2e4', held: YELLOW }, { a: 'd6d5' }]);
  assert.deepEqual(colours(m), [`e2e4:${YELLOW}`, `d6d5:${BLUE}`]);
});

test('redrawing a keyless arrow with a profile on takes it off; a pen key replaces it', () => {
  let m = draw('sequential', START, [{ a: 'e2e4' }, { a: 'd2d4' }]);
  m = draw('sequential', START, [{ a: 'e2e4' }], m);
  assert.deepEqual(colours(m), [`d2d4:${SEQUENCE[0]}`]);
  m = draw('sequential', START, [{ a: 'd2d4', held: RED }], m);
  assert.deepEqual(colours(m), [`d2d4:${RED}`]);
  m = draw('sequential', START, [{ a: 'd2d4', held: RED }], m);
  assert.deepEqual(m, { arrows: [], squares: {} }, 'all off: nothing left, no bookkeeping');
});

test('switching profile recolours what is drawn — pen-key marks stay', () => {
  const fen = START;
  const drawn = { [fen]: draw('sequential', fen, [{ a: 'e2e4' }, { a: 'e7e5' }, { a: 'd2d4', held: RED }, { sq: 'e5' }]) };
  const strat = recolorAll(drawn, 'strategic');
  assert.deepEqual(colours(strat[fen]), [`e2e4:${GREEN}`, `e7e5:${BLUE}`, `d2d4:${RED}`]);
  assert.equal(strat[fen].squares.e5, GREEN, 'the highlight follows the arrow before it (d2-d4, a White move)');
  const back = recolorAll(strat, 'default');
  assert.deepEqual(colours(back[fen]), [`e2e4:${GREEN}`, `e7e5:${GREEN}`, `d2d4:${RED}`]);
  assert.equal(recolorAll(back, 'default'), back, 'nothing to change: the same object');
  // Marks with no bookkeeping (imported, older) are left as they are.
  const plain = { [fen]: { arrows: [['e2', 'e4', '#123456']], squares: {} } };
  assert.equal(recolorAll(plain, 'strategic'), plain);
  assert.deepEqual(resolveColors(plain[fen], fen, 'sequential').arrows, ['#123456']);
});

test('the arrow under the pointer shows the colour it will be drawn in', () => {
  const m = draw('sequential', START, [{ a: 'e2e4' }]);
  assert.equal(colorOfNext(m, 'd2', 'd4', {
    held: null, pen, profile: 'sequential', fen: START,
  }), SEQUENCE[1]);
  assert.equal(colorOfNext(m, 'e2', 'e4', {
    held: null, pen, profile: 'sequential', fen: START,
  }), null, 'redrawing it would take it off');
});

test('marks kept as PGN codes: a new mark’s colour from what is there, in order', () => {
  const drawing = { arrows: [['e2', 'e4', GREEN], ['e7', 'e5', GREEN]], squares: {} };
  const opts = { held: null, pen, profile: 'strategic' };
  assert.equal(colorForPlain(drawing, START, { from: 'g1', to: 'f3' }, opts), GREEN);
  assert.equal(colorForPlain(drawing, START, { from: 'b8', to: 'c6' }, opts), BLUE);
  assert.equal(colorForPlain(drawing, START, { from: 'e4', to: 'e5' }, opts), RED);
  assert.equal(colorForPlain(drawing, START, { sq: 'd4' }, { ...opts, profile: 'sequential' }), SEQUENCE[1], 'the colour of the arrow before it');
});

test('highlights: stronger, with a halo, when a profile is on', () => {
  assert.deepEqual(squareMarkStyle(GREEN, 'default'), { backgroundColor: `${GREEN}66`, boxShadow: `inset 0 0 0 3px ${GREEN}` });
  assert.match(squareMarkStyle(GREEN, 'strategic').backgroundColor, /b3$/);
  assert.match(squareMarkStyle(GREEN, 'strategic').boxShadow, /rgba\(0, 0, 0, 0\.45\)/);
  assert.match(squareMarkStyle('#1a1a1a', 'sequential').boxShadow, /rgba\(255, 255, 255, 0\.6\)/);
  assert.match(squareMarkStyle('#1a1a1a', 'sequential').backgroundColor, /8c$/);
  assert.deepEqual(Object.keys(STRATEGIC), ['w', 'b', 'wx', 'bx']);
});
