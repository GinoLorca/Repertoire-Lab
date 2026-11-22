// The tactic cue on the analysis board (src/lib/tacticCue.js): when stepping
// onto a move marked with a tactic plays Game Review's sound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { tacticCueDue, CUE_AFTER_MS } from '../src/lib/tacticCue.js';
import { SOUND_EVENTS, DEFAULT_SOUNDS } from '../src/lib/sound.js';

const T = [{ keys: ['fork'] }];

test('one step forward onto a marked move plays the cue; nothing else does', () => {
  // n7 is the move before n8, which carries a tactic.
  assert.equal(tacticCueDue({ prev: 'n7', head: 'n8', parent: 'n7', tactics: T }), true, 'the arrow key, ▶, or playing the game\'s move');
  assert.equal(tacticCueDue({ prev: 'root', head: 'n1', parent: 'root', tactics: T }), true, 'from the start onto the first move');
  assert.equal(tacticCueDue({ prev: 'n3', head: 'n8', parent: 'n7', tactics: T }), false, 'a jump there');
  assert.equal(tacticCueDue({ prev: 'n9', head: 'n8', parent: 'n7', tactics: T }), false, 'a step back onto it');
  assert.equal(tacticCueDue({ prev: null, head: 'n8', parent: 'n7', tactics: T }), false, 'a game opening on it');
  assert.equal(tacticCueDue({ prev: 'n8', head: 'n8', parent: 'n7', tactics: T }), false, 'the same move again');
  assert.equal(tacticCueDue({ prev: 'n7', head: 'n8', parent: 'n7', tactics: [] }), false, 'a move with no tactic');
  assert.equal(tacticCueDue({ prev: 'n7', head: 'n8', parent: 'n7', tactics: undefined }), false, 'a game with no review');
});

test('sound off, or the cue switched off in Settings, is silence; the switch reads as on until it is turned off', () => {
  const step = { prev: 'n7', head: 'n8', parent: 'n7', tactics: T };
  assert.equal(tacticCueDue({ ...step, soundOn: false }), false);
  assert.equal(tacticCueDue({ ...step, setting: false }), false);
  assert.equal(tacticCueDue({ ...step, setting: undefined }), true, 'never set: on');
  assert.equal(tacticCueDue({ ...step, setting: true }), true);
  assert.ok(CUE_AFTER_MS >= 120 && CUE_AFTER_MS <= 450, 'after the move\'s own sound, as Chess Arcade times it');
});

test('the cue is one of the app\'s sounds: listed for the Sounds page, with its file shipped', () => {
  assert.ok(SOUND_EVENTS.some((e) => e.key === 'tactic'));
  assert.equal(DEFAULT_SOUNDS.tactic, '/sounds/tactic.mp3');
  const file = new URL('../public/sounds/tactic.mp3', import.meta.url);
  assert.ok(existsSync(file) && statSync(file).size > 1000);
});
