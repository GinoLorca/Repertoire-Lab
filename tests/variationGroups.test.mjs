// Sub-variations: a line filed under another line in the same chapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parentsOf, grouped, nest, unnest, moveGrouped, suggestParent,
} from '../src/lib/variationGroups.js';

const v = (id, moves = ['e4', 'c6'], parentId) => ({ id, name: id, moves, ...(parentId ? { parentId } : {}) });
const ids = (list) => list.map((x) => (x.parentId ? `  ${x.id}` : x.id)).join(',');

test('filing a line under another puts it right after that line, at the end of its sub-variations', () => {
  let list = [v('Main'), v('Karpov'), v('Tartakower'), v('Advance')];
  list = nest(list, 'Tartakower', 'Main');
  list = nest(list, 'Karpov', 'Main');
  assert.equal(ids(list), 'Main,  Tartakower,  Karpov,Advance');
});

test('only one level: filing under a sub-variation files under its main line, and a line\'s own sub-variations come along', () => {
  let list = [v('A'), v('B'), v('C'), v('D')];
  list = nest(list, 'B', 'A');
  list = nest(list, 'D', 'C');
  list = nest(list, 'C', 'B'); // B is itself under A
  assert.equal(ids(list), 'A,  B,  C,  D');
  assert.ok(list.every((x) => x.id === 'A' || x.parentId === 'A'));
});

test('a line can\'t be filed under itself; an unknown parent changes nothing', () => {
  const list = [v('A'), v('B')];
  assert.equal(nest(list, 'A', 'A'), list);
  assert.equal(nest(list, 'A', 'nope'), list);
});

test('back to a main line: it lands just after the block it was in', () => {
  let list = nest(nest([v('A'), v('B'), v('C'), v('D')], 'B', 'A'), 'C', 'A');
  list = unnest(list, 'B');
  assert.equal(ids(list), 'A,  C,B,D');
  assert.equal('parentId' in list.find((x) => x.id === 'B'), false);
});

test('move up/down: a main line moves with its sub-variations; a sub-variation only among its siblings', () => {
  let list = nest(nest([v('A'), v('B'), v('C'), v('D')], 'B', 'A'), 'C', 'A');
  // A, B, C (under A), D
  list = moveGrouped(list, 'D', -1);
  assert.equal(ids(list), 'D,A,  B,  C');
  list = moveGrouped(list, 'C', -1);
  assert.equal(ids(list), 'D,A,  C,  B');
  assert.equal(moveGrouped(list, 'C', -1), list, 'the first sub-variation can\'t leave its main line');
  list = moveGrouped(list, 'A', -1);
  assert.equal(ids(list), 'A,  C,  B,D');
});

test('devices that crossed: a missing parent, or a loop, just means a main line', () => {
  // The iPad deleted Main while the Mac filed Karpov under it.
  assert.equal(parentsOf([v('Karpov', undefined, 'Main')]).get('Karpov'), null);
  // A under B on one device, B under A on the other.
  const loop = [v('A', undefined, 'B'), v('B', undefined, 'A')];
  assert.equal(parentsOf(loop).get('A'), null);
  assert.equal(parentsOf(loop).get('B'), null);
  // Two levels, from crossing changes: flattened to the top.
  const deep = [v('A'), v('B', undefined, 'A'), v('C', undefined, 'B')];
  assert.equal(parentsOf(deep).get('C'), 'A');
  // Reading order puts a stray sub-variation back behind its main line.
  assert.equal(ids(grouped([v('K', undefined, 'M'), v('X'), v('M')])), 'X,M,  K');
});

test('the suggested main line is the one sharing the most moves', () => {
  const list = [
    v('Classical', ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5']),
    v('Karpov', ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7']),
    v('Advance', ['e4', 'c6', 'd4', 'd5', 'e5']),
    v('Karpov 5.Ng5', ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nd7', 'Ng5']),
  ];
  assert.equal(suggestParent(list, 'Karpov 5.Ng5'), 'Karpov');
  assert.equal(suggestParent([v('A', ['e4', 'c6']), v('B', ['e4', 'c6'])], 'A'), null, 'nothing beyond what every line shares');
});
