// The analysis board's engine keys — src/lib/shortcuts.js: Chess Arcade's
// 1 / 2 / 3 / E / L, and the alternatives moved to Shift+1 / 2 / 3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutMap, keyToken, formatShortcutKey } from '../src/lib/shortcuts.js';

const press = (key, code, shiftKey = false) => keyToken({ key, code, shiftKey });

test('1 / 2 / 3 / E / L by default, as on Chess Arcade', () => {
  const map = shortcutMap({});
  assert.equal(map[press('1', 'Digit1')], 'arrowBest');
  assert.equal(map[press('2', 'Digit2')], 'arrowSecond');
  assert.equal(map[press('3', 'Numpad3')], 'arrowThird');
  assert.equal(map[press('e', 'KeyE')], 'hideSuggestions');
  assert.equal(map[press('L', 'KeyL', true)], 'toggleEngine');
  assert.equal(map[press('a', 'KeyA')], 'toggleArrows');
});

test('Shift with a digit marks the alternatives, whatever the keyboard types for it', () => {
  const map = shortcutMap({});
  assert.equal(press('!', 'Digit1', true), 'shift+1');
  assert.equal(map[press('!', 'Digit1', true)], 'highlightGreen');
  assert.equal(map[press('"', 'Digit2', true)], 'highlightBlue');
  assert.equal(map[press('#', 'Digit3', true)], 'highlightYellow');
  assert.equal(formatShortcutKey('shift+1'), '⇧1');
  // A numpad digit with Num Lock off still counts as its digit.
  assert.equal(map[press('End', 'Numpad1')], 'arrowBest');
});

test('a key given in Settings still wins', () => {
  const map = shortcutMap({ shortcuts: { toggleLines: 'n' } });
  assert.equal(map.n, 'toggleLines');
  assert.equal(formatShortcutKey(''), '');
});
