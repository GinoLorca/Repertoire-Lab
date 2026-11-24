// The player page's Positions tab: there only with a copy of Chess Arcade that
// has it; what Game Review asks it to find; where it was left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE_POSITIONS } from '../src/lib/arcadeBuild.js';
import {
  ARCADE_TABS, askFind, takeFind, keepPlace, takePlace,
} from '../src/lib/positionsTab.js';
import { openPlayerCard } from '../src/lib/openPlayer.js';

test('the tab is there with a copy that has Positions, after Openings', () => {
  assert.deepEqual(ARCADE_TABS, ARCADE_POSITIONS ? ['clamp', 'tactics', 'openings', 'positions'] : ['clamp', 'tactics', 'openings']);
});

test('what Game Review asked to find waits for that player, once; only a position is taken', () => {
  const fen = 'rnbqkb1r/pp2pppp/5n2/3p4/3P4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 1';
  assert.equal(askFind('p1', { fen, flip: 1, sub: 'structures' }), true);
  assert.equal(takeFind('p2'), null);
  assert.deepEqual(takeFind('p1'), { fen, flip: true, sub: 'structures' });
  assert.equal(takeFind('p1'), null);
  assert.equal(askFind('p1', { fen, sub: '<script>' }), true);
  assert.equal(takeFind('p1').sub, 'find');
  for (const bad of ['', '8/8/8', 'hello', `${fen}${'x'.repeat(200)}`, null, { toString: null }]) {
    let took = false;
    try { took = askFind('p1', { fen: bad }); } catch { took = false; }
    assert.equal(took, false);
  }
  assert.equal(askFind(null, { fen }), false);
  assert.equal(askFind('p1', null), false);
});

test('the place a game was opened from is kept for that player, once', () => {
  keepPlace('p1', null, 900);
  assert.equal(takePlace('p1'), null);
  keepPlace('p1', { sub: 'structures', card: 'carlsbad' }, 2400);
  assert.deepEqual(takePlace('p1'), { place: { sub: 'structures', card: 'carlsbad' }, height: 2400 });
  assert.equal(takePlace('p1'), null);
});

test('a card is opened on its games, or on the tab asked for', () => {
  const was = globalThis.window;
  const sent = [];
  globalThis.window = { dispatchEvent: (e) => sent.push(e.type) };
  try {
    openPlayerCard({ id: 's1', kind: 'student' });
    assert.deepEqual(globalThis.window.__repertoireOpenPlayer, { id: 's1', kind: 'student', tab: 'games' });
    openPlayerCard({ id: 'me' }, { tab: 'positions' });
    assert.deepEqual(globalThis.window.__repertoireOpenPlayer, { id: 'me', kind: 'self', tab: 'positions' });
    assert.deepEqual(sent.filter((t) => t === 'repertoire-open-player').length, 2);
  } finally { if (was === undefined) delete globalThis.window; else globalThis.window = was; }
});
