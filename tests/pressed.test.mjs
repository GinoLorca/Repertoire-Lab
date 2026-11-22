import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pressedOn, setPressed, subscribePressed, shownPick,
} from '../src/lib/pressed.js';

test('a press is on one board, and over when it ends', () => {
  assert.equal(pressedOn('analysis'), null);
  setPressed('analysis', 'g1');
  assert.equal(pressedOn('analysis'), 'g1');
  assert.equal(pressedOn('practice'), null, 'another board hears nothing of it');
  setPressed('practice', 'e2');
  assert.equal(pressedOn('practice'), 'e2');
  setPressed('analysis', null);
  assert.equal(pressedOn('analysis'), null);
  assert.equal(pressedOn('practice'), 'e2');
  setPressed('practice', null);
});

test('listeners hear a change once, and nothing when nothing changed', () => {
  let heard = 0;
  const off = subscribePressed(() => { heard += 1; });
  setPressed('analysis', 'b1');
  setPressed('analysis', 'b1');
  assert.equal(heard, 1);
  setPressed('analysis', 'c3');
  assert.equal(heard, 2);
  setPressed('analysis', null);
  setPressed('analysis', null);
  assert.equal(heard, 3);
  off();
  setPressed('analysis', 'b1');
  assert.equal(heard, 3, 'not after it stops listening');
  setPressed('analysis', null);
});

test('only a square is a press; an id is told apart as text', () => {
  setPressed('analysis', 'z9');
  assert.equal(pressedOn('analysis'), null);
  setPressed('analysis', undefined);
  assert.equal(pressedOn('analysis'), null);
  setPressed(7, 'a1');
  assert.equal(pressedOn('7'), 'a1');
  assert.equal(pressedOn(7), 'a1');
  setPressed(7, null);
  setPressed(null, 'a1');
  assert.equal(pressedOn(null), null);
});

test('a listener that stops listening as it is told doesn\'t upset the rest', () => {
  const seen = [];
  let offA = null;
  offA = subscribePressed(() => { seen.push('a'); offA(); });
  const offB = subscribePressed(() => { seen.push('b'); });
  setPressed('analysis', 'd2');
  assert.deepEqual(seen, ['a', 'b']);
  setPressed('analysis', null);
  assert.deepEqual(seen, ['a', 'b', 'b']);
  offB();
});

test('what is shown: the square pressed, else the one picked', () => {
  assert.equal(shownPick('g1', 'e2'), 'g1');
  assert.equal(shownPick(null, 'e2'), 'e2');
  assert.equal(shownPick(null, null), null);
  assert.equal(shownPick(undefined, undefined), null);
});
