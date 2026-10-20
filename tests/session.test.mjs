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
  boardsFromNav, subFromNav, splitDrafts,
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

test('from one board to two: what was on it goes to the board it was', () => {
  const game = { name: 'Jojo vs Sam', gameId: 'g', playerId: 'p', moves: ['e4'] };
  // Studio on a game, left on the analysis screen.
  const studio = { view: 'analysis', sub: null, coachStudio: true, analysisLine: game, analysisLabId: null };
  assert.deepEqual(boardsFromNav(studio), {
    analysisLine: null, analysisLabId: null, studioLine: game, studioLabId: null,
  });
  assert.equal(subFromNav(studio), 'studio', 'reopens on the Studio tab');
  // The analysis board with a Lab entry on it.
  const plain = { view: 'analysis', sub: null, coachStudio: false, analysisLine: null, analysisLabId: 'L1' };
  assert.deepEqual(boardsFromNav(plain), {
    analysisLine: null, analysisLabId: 'L1', studioLine: null, studioLabId: null,
  });
  assert.equal(subFromNav(plain), null);
  // Studio on, but the Board Editor open: still the editor; Studio elsewhere.
  assert.equal(subFromNav({ ...studio, view: 'games' }), null);
  assert.equal(subFromNav({ ...studio, sub: 'editor' }), 'editor');
  // New sessions keep their tab as is.
  assert.equal(subFromNav({ view: 'analysis', sub: 'studio' }), 'studio');
  assert.equal(subFromNav(null), null);
  assert.deepEqual(boardsFromNav(null), {
    analysisLine: null, analysisLabId: null, studioLine: null, studioLabId: null,
  });
});

test('the store’s drafts split the same way, once', () => {
  const blank = { tree: { id: 'root' }, labTitle: 'Before class' };
  const session = { source: 'game:p:g:studio', head: 'n3' };
  // A blank Studio board: its draft is Studio's.
  assert.deepEqual(splitDrafts({ analysisDraft: blank, analysisSessionDraft: null }, { coachStudio: true }), {
    analysisDraft: null, studioDraft: blank, analysisSessionDraft: null, studioSessionDraft: null,
  });
  // Studio on a game: the game's session is Studio's; the blank board's
  // draft stays the analysis board's.
  assert.deepEqual(
    splitDrafts({ analysisDraft: blank, analysisSessionDraft: session }, { coachStudio: true, analysisLine: { gameId: 'g' } }),
    {
      analysisDraft: blank, studioDraft: null, analysisSessionDraft: null, studioSessionDraft: session,
    },
  );
  // The analysis board: everything stays.
  assert.deepEqual(splitDrafts({ analysisDraft: blank, analysisSessionDraft: session }, { coachStudio: false }), {
    analysisDraft: blank, studioDraft: null, analysisSessionDraft: session, studioSessionDraft: null,
  });
  // Already split, or nothing saved: nothing to do.
  assert.equal(splitDrafts({ analysisDraft: blank, studioDraft: null }, { coachStudio: true }), null);
  assert.equal(splitDrafts(null, { coachStudio: true }), null);
});
