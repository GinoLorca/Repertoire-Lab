// The three-way merge at the heart of sync — see src/lib/cloud/merge3.js.
// Each test names the promise it holds the merge to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeState, toBaseline, same } from '../src/lib/cloud/merge3.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const game = (id, extra = {}) => ({ id, name: id, moves: ['e4', 'e5'], date: 1, meta: { notes: '' }, ...extra });
const state = (games, openings = []) => ({
  openings, labEntries: [], categories: [], playlists: [], savedPositions: [],
  players: [{ id: 'p1', name: 'Me', kind: 'self', games }],
});
const course = (vName, v = {}) => [{
  id: 'o1', name: 'Jobava',
  chapters: [{ id: 'c1', name: 'Main', variations: [{ id: 'v1', name: vName, moves: ['d4'], ...v }] }],
}];
const ids = (games) => games.map((g) => g.id).sort().join();

test('an edit made here survives syncing against an unchanged cloud', () => {
  const base = toBaseline(state([game('G', { meta: { notes: 'old' } })]));
  const m = mergeState(base, state([game('G', { meta: { notes: 'NEW' } })]), state([game('G', { meta: { notes: 'old' } })]));
  assert.equal(m.players[0].games[0].meta.notes, 'NEW');
});

test('a game deleted here stays deleted', () => {
  const base = toBaseline(state([game('G'), game('H')]));
  assert.equal(ids(mergeState(base, state([game('H')]), state([game('G'), game('H')])).players[0].games), 'H');
});

test('a game deleted on the other device goes here too', () => {
  const base = toBaseline(state([game('G'), game('H')]));
  assert.equal(ids(mergeState(base, state([game('G'), game('H')]), state([game('H')])).players[0].games), 'H');
});

test('a variation renamed here survives', () => {
  const base = toBaseline(state([], course('old name')));
  const m = mergeState(base, state([], course('RENAMED')), state([], course('old name')));
  assert.equal(m.openings[0].chapters[0].variations[0].name, 'RENAMED');
});

test('an edit made on the other device arrives', () => {
  const base = toBaseline(state([game('G', { meta: { notes: 'old' } })]));
  const m = mergeState(base, state([game('G', { meta: { notes: 'old' } })]), state([game('G', { meta: { notes: 'from iPad' } })]));
  assert.equal(m.players[0].games[0].meta.notes, 'from iPad');
});

test('games added on either side, or both, are all kept', () => {
  const base = toBaseline(state([game('G')]));
  assert.equal(ids(mergeState(base, state([game('G')]), state([game('G'), game('N')])).players[0].games), 'G,N');
  assert.equal(ids(mergeState(base, state([game('G'), game('L')]), state([game('G'), game('R')])).players[0].games), 'G,L,R');
});

test('different fields changed on each side: both changes kept', () => {
  const base = toBaseline(state([game('G', { name: 'Round 1', meta: { notes: 'a' } })]));
  const g = mergeState(
    base,
    state([game('G', { name: 'Round 1 vs Parker', meta: { notes: 'a' } })]),
    state([game('G', { name: 'Round 1', meta: { notes: 'b' } })]),
  ).players[0].games[0];
  assert.equal(g.name, 'Round 1 vs Parker');
  assert.equal(g.meta.notes, 'b');
});

test('same field changed on both: the newer edit wins, by updatedAt', () => {
  const base = toBaseline(state([game('G', { meta: { notes: 'a' }, updatedAt: 10 })]));
  const g = mergeState(
    base,
    state([game('G', { meta: { notes: 'mine, older' }, updatedAt: 20 })]),
    state([game('G', { meta: { notes: 'theirs, newer' }, updatedAt: 30 })]),
  ).players[0].games[0];
  assert.equal(g.meta.notes, 'theirs, newer');
  assert.equal(g.updatedAt, 30);
});

test('same field changed on both with no timestamps: this device wins', () => {
  const base = toBaseline(state([game('G', { meta: { notes: 'a' } })]));
  const m = mergeState(base, state([game('G', { meta: { notes: 'here' } })]), state([game('G', { meta: { notes: 'there' } })]));
  assert.equal(m.players[0].games[0].meta.notes, 'here');
});

test('a rename here and practice there both survive', () => {
  const base = toBaseline(state([], course('x', { learned: false, srs: { lastReview: 1, level: 0 } })));
  const v = mergeState(
    base,
    state([], course('renamed here', { learned: false, srs: { lastReview: 1, level: 0 } })),
    state([], course('x', { learned: true, srs: { lastReview: 50, level: 3 } })),
  ).openings[0].chapters[0].variations[0];
  assert.equal(v.name, 'renamed here');
  assert.equal(v.learned, true);
  assert.equal(v.srs.level, 3);
});

test('practised on both: once learned always learned, and the fresher review wins', () => {
  const base = toBaseline(state([], course('x', { learned: false, srs: { lastReview: 1, level: 0 } })));
  const v = mergeState(
    base,
    state([], course('x', { learned: true, srs: { lastReview: 40, level: 2 } })),
    state([], course('x', { learned: true, srs: { lastReview: 60, level: 1 } })),
  ).openings[0].chapters[0].variations[0];
  assert.equal(v.learned, true);
  assert.equal(v.srs.lastReview, 60);
});

test('a reorder made on either side survives', () => {
  const o = (id) => ({ id, name: id, chapters: [] });
  const base = toBaseline(state([], [o('a'), o('b'), o('c')]));
  const here = mergeState(base, state([], [o('c'), o('a'), o('b')]), state([], [o('a'), o('b'), o('c')]));
  assert.equal(here.openings.map((x) => x.id).join(), 'c,a,b');
  const there = mergeState(base, state([], [o('a'), o('b'), o('c')]), state([], [o('b'), o('c'), o('a')]));
  assert.equal(there.openings.map((x) => x.id).join(), 'b,c,a');
});

test('pictures: kept as a hash in the baseline, and equal to their own hash', () => {
  const pic = `data:image/jpeg;base64,${'A'.repeat(300)}`;
  const opening = (name) => [{ id: 'o1', name, chapters: [], artwork: { medium: pic } }];
  const base = toBaseline(state([], opening('J')));
  assert.ok(JSON.stringify(base).length < 400);
  const m = mergeState(base, state([], opening('J')), state([], opening('Renamed there')));
  assert.equal(m.openings[0].artwork.medium, pic);
  assert.equal(m.openings[0].name, 'Renamed there');
  assert.ok(same(pic, toBaseline(pic)));
});

test('with no baseline at all, nothing is lost from either side', () => {
  assert.equal(ids(mergeState(undefined, state([game('L')]), state([game('R')])).players[0].games), 'L,R');
});

test('nothing changed anywhere: nothing changes', () => {
  const s = state([game('G')], course('x'));
  assert.ok(same(mergeState(toBaseline(s), clone(s), clone(s)), s));
});

test('missing, undefined and null are the same thing', () => {
  const base = toBaseline(state([game('G', { meta: { notes: 'a', photo: undefined } })]));
  const local = state([game('G', { meta: { notes: 'a' } })]);
  const remote = state([game('G', { meta: { notes: 'a', photo: null } })]);
  assert.ok(same(mergeState(base, local, remote), local));
});

// --- work done while a sync was running --------------------------------------
import { foldInFlight } from '../src/lib/cloud/merge3.js';

test('a game saved while a sync was running is not thrown away by the sync', () => {
  const started = state([game('G')]);
  const now = state([game('G'), game('SAVED-MID-SYNC')]);
  const synced = state([game('G'), game('FROM-IPAD')]);
  assert.equal(ids(foldInFlight(started, now, synced).players[0].games), 'FROM-IPAD,G,SAVED-MID-SYNC');
});

test('an edit made mid-sync survives, and what the sync brought still lands', () => {
  const started = state([game('G', { meta: { notes: 'a' } }), game('H')]);
  const now = state([game('G', { meta: { notes: 'typed during sync' } }), game('H')]);
  const synced = state([game('G', { meta: { notes: 'a' } }), game('H', { name: 'renamed on iPad' })]);
  const out = foldInFlight(started, now, synced).players[0].games;
  assert.equal(out.find((x) => x.id === 'G').meta.notes, 'typed during sync');
  assert.equal(out.find((x) => x.id === 'H').name, 'renamed on iPad');
});

test('nothing happened during the sync: its result is used as is', () => {
  const started = state([game('G')]);
  const synced = state([game('G'), game('N')]);
  assert.equal(foldInFlight(started, started, synced), synced);
});

test('settings changed mid-sync stay; otherwise the sync’s settings land', () => {
  const started = { ...state([]), settings: { skin: 'felt' } };
  const synced = { ...state([]), settings: { skin: 'hustler' } };
  assert.equal(foldInFlight(started, { ...state([]), settings: { skin: 'bauhaus' } }, synced).settings.skin, 'bauhaus');
  assert.equal(foldInFlight(started, { ...state([game('X')]), settings: { skin: 'felt' } }, synced).settings.skin, 'hustler');
});
