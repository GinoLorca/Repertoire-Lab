// The sync fingerprint, read piece by piece (lib/cloud/fingerprint): the same
// answers as turning the whole library to text and hashing it — equal for
// equal states, different for different ones — without reading what hasn't
// changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { syncableHash } = await import('../src/lib/cloud/fingerprint.js');

// Counts how often a piece is turned to text (JSON.stringify calls toJSON).
let reads = 0;
const counted = (o) => Object.defineProperty(o, 'toJSON', {
  enumerable: false,
  value() { reads += 1; const { ...plain } = this; return plain; },
});
const make = () => ({
  openings: [
    counted({ id: 'o1', name: 'Jobava', chapters: [{ id: 'c1', variations: [{ id: 'v1', moves: ['d4', 'd5'] }] }] }),
    counted({ id: 'o2', name: 'Caro', chapters: [] }),
  ],
  players: [
    counted({ id: 'p1', name: 'Myla', games: [counted({ id: 'g1', moves: ['e4'] }), counted({ id: 'g2', moves: ['d4'] })] }),
    counted({ id: 'p2', name: 'Lola', games: [counted({ id: 'g3', moves: ['c4'] })] }),
  ],
  categories: [{ id: 'k', name: 'Mine' }],
  playlists: [],
  labEntries: [counted({ id: 'l1', title: 'Lab' })],
  savedPositions: [{ id: 's1', fen: 'x' }],
  settings: counted({ skin: 'cards', volume: 1 }),
  analysisDraft: { head: 'root' },
});

test('two states that say the same thing have the same fingerprint — a sync’s result matches what it came from', () => {
  const a = make();
  const b = JSON.parse(JSON.stringify(a));
  assert.equal(syncableHash(a), syncableHash(b));
  assert.equal(syncableHash(a), syncableHash(a, { fresh: true }));
  assert.equal(typeof syncableHash(a), 'string');
  assert.equal(syncableHash(null), syncableHash(undefined));
  assert.equal(syncableHash({}), syncableHash(null));
});

test('a change to anything that syncs changes it; the board in front of you doesn’t', () => {
  const a = make();
  const base = syncableHash(a);
  const game = (st, fn) => ({ ...st, players: st.players.map((p) => (p.id === 'p1' ? { ...p, games: p.games.map((g) => (g.id === 'g2' ? fn(g) : g)) } : p)) });
  const changes = {
    'a move in a game': game(a, (g) => ({ ...g, moves: ['d4', 'd5'] })),
    'a game’s review': game(a, (g) => ({ ...g, gameReview: { an: '{"v":1}', at: 1 } })),
    'a game removed': { ...a, players: a.players.map((p) => (p.id === 'p1' ? { ...p, games: p.games.slice(0, 1) } : p)) },
    'a card renamed': { ...a, players: a.players.map((p) => (p.id === 'p2' ? { ...p, name: 'Lola R' } : p)) },
    'cards reordered': { ...a, players: [...a.players].reverse() },
    'a line learned': { ...a, openings: a.openings.map((o) => (o.id === 'o1' ? { ...o, chapters: [{ ...o.chapters[0], variations: [{ ...o.chapters[0].variations[0], learned: true }] }] } : o)) },
    'an opening added': { ...a, openings: [...a.openings, { id: 'o3', name: 'New', chapters: [] }] },
    'a category': { ...a, categories: [{ id: 'k', name: 'Renamed' }] },
    'a playlist': { ...a, playlists: [{ id: 'pl' }] },
    'a Lab entry': { ...a, labEntries: [{ id: 'l1', title: 'Lab 2' }] },
    'a saved position': { ...a, savedPositions: [] },
    'a setting': { ...a, settings: { ...a.settings, volume: 0.5 } },
  };
  const seen = new Set([base]);
  for (const [what, st] of Object.entries(changes)) {
    const h = syncableHash(st);
    assert.notEqual(h, base, what);
    assert.equal(h, syncableHash(JSON.parse(JSON.stringify(st))), `${what}: by what it says`);
    seen.add(h);
  }
  assert.equal(seen.size, Object.keys(changes).length + 1, 'each its own');
  assert.equal(syncableHash({ ...a, analysisDraft: { head: 'n7' }, analysisSessionDraft: { source: 'x' }, syncGen: 9 }), base);
  // A game moved to another card is a change, though every game is as it was.
  const [g1, g2] = a.players[0].games;
  const moved = { ...a, players: [{ ...a.players[0], games: [g1] }, { ...a.players[1], games: [...a.players[1].games, g2] }] };
  assert.notEqual(syncableHash(moved), base);
});

test('what hasn’t changed isn’t read again', () => {
  const a = make();
  reads = 0;
  syncableHash(a);
  const first = reads;
  // Two openings, three games, a Lab entry and the settings (a card's own
  // fields are read apart from its games, and aren't counted here).
  assert.equal(first, 7, 'every piece read once');
  reads = 0;
  syncableHash(a);
  syncableHash({ ...a, analysisDraft: { head: 'n1' } });
  assert.equal(reads, 0, 'a step on the board reads nothing');
  // One game changes: that game and its card are read — not the other games, cards, openings or settings.
  const next = { ...a, players: a.players.map((p) => (p.id === 'p1' ? { ...p, games: p.games.map((g) => (g.id === 'g2' ? counted({ ...g, moves: ['d4', 'Nf6'] }) : g)) } : p)) };
  reads = 0;
  syncableHash(next);
  assert.ok(reads >= 1 && reads <= 2, `only what was replaced (${reads})`);
  // Asked to look afresh, everything is read — and a piece changed in place is seen.
  const before = syncableHash(a);
  a.players[1].games[0].moves.push('e5');
  assert.equal(syncableHash(a), before, 'remembered: not seen');
  reads = 0;
  const fresh = syncableHash(a, { fresh: true });
  assert.notEqual(fresh, before, 'afresh: seen');
  assert.ok(reads >= first, 'everything read');
  assert.equal(syncableHash(a), fresh, '…and remembered as it is now');
});
