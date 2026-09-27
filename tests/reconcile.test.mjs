// The sync's merge step, end to end through the real sync.js — records,
// deletions queued for the cloud, and settings with their own rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from '../src/lib/cloud/sync.js';
import { toBaseline } from '../src/lib/cloud/merge3.js';
import { hashOf } from '../src/lib/cloud/shape.js';
import { DEFAULT_SETTINGS } from '../src/lib/settingsDefaults.js';

const g = (id, notes = '') => ({ id, name: id, moves: ['e4'], date: 1, meta: { notes } });
const st = (games, chapters = ['c1', 'c2'], settings = { ...DEFAULT_SETTINGS, skin: 'bauhaus' }) => ({
  openings: [{ id: 'o1', name: 'J', chapters: chapters.map((id) => ({ id, name: id, variations: [] })) }],
  players: [{ id: 'p1', name: 'Me', kind: 'self', games }],
  labEntries: [], categories: [], playlists: [], savedPositions: [], settings,
});
const docsOf = (s, settingsAt = 5) => ({
  openings: s.openings.map((o) => ({ id: o.id })),
  chapters: s.openings.flatMap((o) => o.chapters.map((c) => ({ id: c.id }))),
  players: s.players.map((p) => ({ id: p.id })), labEntries: [], settingsAt,
});
const meta = (extra = {}) => ({
  ids: { openings: ['o1'], chapters: ['c1', 'c2'], players: ['p1'], labEntries: [] },
  hashes: {}, settingsHash: 'h', settingsAt: 5, ...extra,
});

const base = toBaseline(st([g('G', 'old')]));
const remote = st([g('G', 'old')]);

test('with a baseline, a game edit made here survives the sync', () => {
  const r = reconcile(st([g('G', 'NEW')]), remote, docsOf(remote), meta(), DEFAULT_SETTINGS, base);
  assert.equal(r.merged.players[0].games[0].meta.notes, 'NEW');
});

test('a chapter deleted here stays deleted and is queued for deletion in the cloud', () => {
  const r = reconcile(st([g('G', 'old')], ['c1']), remote, docsOf(remote), meta(), DEFAULT_SETTINGS, base);
  assert.deepEqual(r.goneHere.chapters, ['c2']);
  assert.equal(r.merged.openings[0].chapters.length, 1);
});

test('a chapter deleted on the other device goes here, and nothing else is deleted', () => {
  const remote2 = st([g('G', 'old')], ['c1']);
  const r = reconcile(st([g('G', 'old')]), remote2, docsOf(remote2), meta(), DEFAULT_SETTINGS, base);
  assert.equal(r.merged.openings[0].chapters.length, 1);
  assert.deepEqual(r.goneHere.chapters, []);
});

test('with no baseline yet, the old two-way rules run (once per device)', () => {
  const r = reconcile(st([g('G', 'NEW')]), remote, docsOf(remote), meta(), DEFAULT_SETTINGS, null);
  assert.equal(r.merged.players[0].games[0].meta.notes, 'old');
});

// --- settings: their own rules, on both paths ----------------------------------

const fresh = { ...DEFAULT_SETTINGS };
const withSettings = (settings) => ({ ...st([]), settings });
const neverSynced = meta({ settingsHash: null, settingsAt: 0 });

test('a new install opens on Tournament Felt', () => {
  assert.equal(fresh.skin, 'felt');
});

for (const [label, baseline] of [['two-way', null], ['three-way', toBaseline(st([]))]]) {
  test(`${label}: signing in on a fresh device brings your own theme across`, () => {
    const { merged } = reconcile(withSettings(fresh), withSettings({ ...fresh, skin: 'outerspace' }),
      docsOf(st([]), 10), neverSynced, DEFAULT_SETTINGS, baseline);
    assert.equal(merged.settings.skin, 'outerspace');
  });

  test(`${label}: a new sign-up keeps the default`, () => {
    const { merged } = reconcile(withSettings(fresh), withSettings({}), docsOf(st([]), 0), neverSynced, DEFAULT_SETTINGS, baseline);
    assert.equal(merged.settings.skin, 'felt');
  });

  test(`${label}: a theme chosen here is never swapped by a first sync`, () => {
    const mine = { ...fresh, skin: 'custom', background: 'data:image/jpeg;base64,AAA' };
    const { merged } = reconcile(withSettings(mine), withSettings({ ...fresh, skin: 'gameboy' }),
      docsOf(st([]), 99), neverSynced, DEFAULT_SETTINGS, baseline);
    assert.equal(merged.settings.skin, 'custom');
    assert.equal(merged.settings.background, 'data:image/jpeg;base64,AAA');
  });

  test(`${label}: a newer theme from another device arrives; one picked here outranks it`, () => {
    const mine = { ...fresh, skin: 'bauhaus' };
    const arrives = reconcile(withSettings(mine), withSettings({ ...fresh, skin: 'hustler' }), docsOf(st([]), 20),
      meta({ settingsHash: hashOf(JSON.stringify(mine)), settingsAt: 5 }), DEFAULT_SETTINGS, baseline);
    assert.equal(arrives.merged.settings.skin, 'hustler');
    const outranks = reconcile(withSettings(mine), withSettings({ ...fresh, skin: 'hustler' }), docsOf(st([]), 20),
      meta({ settingsHash: hashOf(JSON.stringify({ ...fresh, skin: 'felt' })), settingsAt: 5 }), DEFAULT_SETTINGS, baseline);
    assert.equal(outranks.merged.settings.skin, 'bauhaus');
  });

  test(`${label}: an older setting from elsewhere is ignored`, () => {
    const mine = { ...fresh, skin: 'bauhaus' };
    const { merged } = reconcile(withSettings(mine), withSettings({ ...fresh, skin: 'hustler' }), docsOf(st([]), 20),
      meta({ settingsHash: hashOf(JSON.stringify(mine)), settingsAt: 30 }), DEFAULT_SETTINGS, baseline);
    assert.equal(merged.settings.skin, 'bauhaus');
  });
}
