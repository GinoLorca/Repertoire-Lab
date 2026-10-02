// The telestrator's reading of a stroke: arrow, square, or plain ink.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStroke, squareAt } from '../src/lib/telestrator.js';

// A stroke through these points, with extra points filled in between so it
// looks like a real finger's trail.
const trail = (...pts) => {
  const out = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [a, b] = [pts[i], pts[i + 1]];
    for (let t = 0; t < 10; t += 1) out.push({ x: a[0] + (b[0] - a[0]) * (t / 10), y: a[1] + (b[1] - a[1]) * (t / 10) });
  }
  const end = pts[pts.length - 1];
  out.push({ x: end[0], y: end[1] });
  return out;
};
// The middle of a square, in screen squares, with White at the bottom.
const at = (sq) => [sq.charCodeAt(0) - 97 + 0.5, 8 - Number(sq[1]) + 0.5];

test('squares under a point, either way up', () => {
  assert.equal(squareAt(0.5, 7.5, 'white'), 'a1');
  assert.equal(squareAt(7.5, 0.5, 'white'), 'h8');
  assert.equal(squareAt(0.5, 7.5, 'black'), 'h8');
  assert.equal(squareAt(4.2, 3.9, 'white'), 'e5');
  assert.equal(squareAt(8.2, 3, 'white'), null);
});

test('a straight stroke between squares is an arrow', () => {
  assert.deepEqual(classifyStroke(trail(at('e2'), at('e4'))), { type: 'arrow', from: 'e2', to: 'e4' });
  // A little wobble is still an arrow.
  assert.deepEqual(classifyStroke(trail(at('c1'), [4.1, 4.3], at('h6'))), { type: 'arrow', from: 'c1', to: 'h6' });
  // Flipped board: the same screen stroke names the other squares.
  assert.deepEqual(classifyStroke(trail(at('e2'), at('e4')), 'black'), { type: 'arrow', from: 'd7', to: 'd5' });
});

test('a knight drawn as an L is an arrow; the same bend elsewhere is ink', () => {
  // g1 up two squares to g3, then across to f3.
  assert.deepEqual(classifyStroke(trail(at('g1'), at('g3'), at('f3'))), { type: 'arrow', from: 'g1', to: 'f3' });
  // An L from a1 up to a5 then across to e5 is no knight move.
  assert.equal(classifyStroke(trail(at('a1'), at('a5'), at('e5'))).type, 'ink');
});

test('a tap or a small loop marks a square', () => {
  assert.deepEqual(classifyStroke([{ x: 4.5, y: 4.5 }, { x: 4.6, y: 4.55 }]), { type: 'square', square: 'e4' });
  const [cx, cy] = at('d5');
  const loop = Array.from({ length: 25 }, (_, i) => ({
    x: cx + 0.55 * Math.cos((i / 24) * 2 * Math.PI), y: cy + 0.55 * Math.sin((i / 24) * 2 * Math.PI),
  }));
  assert.deepEqual(classifyStroke(loop), { type: 'square', square: 'd5' });
});

test('a big ring or a squiggle stays as ink', () => {
  const ring = Array.from({ length: 40 }, (_, i) => ({
    x: 4 + 2.5 * Math.cos((i / 39) * 2 * Math.PI), y: 4 + 2.5 * Math.sin((i / 39) * 2 * Math.PI),
  }));
  assert.equal(classifyStroke(ring).type, 'ink');
  assert.equal(classifyStroke(trail([1, 6], [2, 5], [3, 6], [4, 5], [5, 6])).type, 'ink');
  // Starting and ending on the same square after a long trip: ink, not an arrow.
  assert.equal(classifyStroke(trail(at('e4'), at('e7'), [4.6, 4.4])).type, 'ink');
});
