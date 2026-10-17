// "Where you are" on this device: what reopens, and what's whose.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  },
};
const {
  loadSession, saveSessionPart, shouldRestore, markBootResume, takeBootResume, analysisSourceKey,
} = await import('../src/lib/session.js');

test('parts are kept apart, stamped, and removed with null', () => {
  saveSessionPart('nav', { view: 'analysis', path: '/analysis' });
  saveSessionPart('editor', { map: { e1: 'wK' } });
  const all = loadSession();
  assert.equal(all.nav.view, 'analysis');
  assert.ok(all.nav.at > 0);
  assert.deepEqual(all.editor.map, { e1: 'wK' });
  saveSessionPart('editor', null);
  assert.equal(loadSession().editor, undefined);
  assert.equal(loadSession().nav.view, 'analysis');
});

test('reopens at the front door or the saved address; any other link wins', () => {
  assert.equal(shouldRestore('/coaches/abc123', '/'), true, 'iOS relaunch at start_url');
  assert.equal(shouldRestore('/coaches/abc123', '/coaches/abc123'), true, 'a reload or an update');
  assert.equal(shouldRestore('/coaches/abc123', '/analysis/editor/p7x2k9q1'), false, 'a link opened on purpose');
  assert.equal(shouldRestore(null, '/'), false, 'nothing saved yet');
});

test('a screen picks its saved part up once, and only when the app reopened on it', () => {
  assert.equal(takeBootResume('practice'), false);
  markBootResume('practice');
  assert.equal(takeBootResume('practice'), true);
  assert.equal(takeBootResume('practice'), false, 'pressing Practice later starts afresh');
});

test('the analysis board knows whose work it holds', () => {
  assert.equal(analysisSourceKey(null, null, false), null, 'a blank board keeps its own draft');
  assert.equal(analysisSourceKey(null, { id: 'L1' }, false), 'lab:L1');
  assert.equal(analysisSourceKey({ gameId: 'g', playerId: 'p' }, null, true), 'game:p:g:studio');
  assert.notEqual(
    analysisSourceKey({ gameId: 'g', playerId: 'p' }, null, true),
    analysisSourceKey({ gameId: 'g', playerId: 'p' }, null, false),
    'Studio and plain analysis of a game are kept apart',
  );
  assert.equal(analysisSourceKey({ name: 'Main', moves: ['e4', 'c6'] }, null, false), 'line:|e4 c6|Main');
});
