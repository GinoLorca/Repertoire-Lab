// Theme suggestions, one repertoire at a time — src/lib/themes.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allTags } from '../src/lib/themes.js';

const state = {
  openings: [
    { id: 'a', tags: ['Tournament prep'], chapters: [{ tags: ['Needs work'], variations: [{ tags: ['Bishop trap'] }] }] },
    { id: 'b', ownerId: 'parker', chapters: [{ variations: [{ tags: ['Traps to remember', 'Bishop trap'] }] }] },
    { id: 'c', ownerId: 'myla', chapters: [{ tags: ['Myla only'], variations: [] }] },
  ],
  players: [{ id: 'me', games: [{ tags: ['Blitz'] }] }],
};

test('a student’s line suggests their themes only; yours, yours; the same name on both is each its own', () => {
  assert.deepEqual(allTags(state, { ownerId: 'parker' }), ['Bishop trap', 'Traps to remember']);
  assert.deepEqual(allTags(state, { ownerId: null }), ['Bishop trap', 'Needs work', 'Tournament prep']);
  assert.deepEqual(allTags(state, { ownerId: 'myla' }), ['Myla only']);
  assert.deepEqual(allTags(state, { ownerId: 'zed' }), []);
  // unscoped (a game's tags): everything, as before
  assert.deepEqual(allTags(state), ['Bishop trap', 'Blitz', 'Myla only', 'Needs work', 'Tournament prep', 'Traps to remember']);
});
