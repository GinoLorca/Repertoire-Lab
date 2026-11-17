// A player's Openings tab: which openings it's based on, in Chess Arcade's
// form, and every game handed to it — src/lib/openingsBasis.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultBasis, basisFor, arcadeRepertoire, openingsGames, basisSummary, reviewRepertoire,
} from '../src/lib/openingsBasis.js';

const line = (id, moves, extra = {}) => ({ id, name: id, moves: moves.split(' '), ...extra });
const openings = [
  { id: 'jl', name: 'Jobava London System', color: 'white', courses: [{ id: 'k1', name: 'Midas' }], chapters: [{ id: 'c1', name: 'Main', courseId: 'k1', variations: [line('v1', 'd4 d5 Nc3')] }] },
  { id: 'ck', name: 'Caro-Kann', color: 'black', chapters: [{ id: 'c2', name: 'Exchange', variations: [line('v2', 'e4 c6 d4 d5')] }] },
  { id: 'kid', name: "King's Indian", color: 'black', chapters: [] },
  { id: 'sjl', name: 'jobava london system ', color: 'white', ownerId: 'myla', freeChapterOrder: true, chapters: [{ id: 's1', name: 'Guide', section: 'A', variations: [line('sv1', 'd4 d5 Nc3', { startFen: null })] }] },
  { id: 'zck', name: 'Caro-Kann', color: 'black', ownerId: 'zed', chapters: [] },
];
const players = [{ id: 'myla', name: 'Myla', kind: 'student' }, { id: 'zed', name: 'Zed', kind: 'student' }, { id: 'me', name: 'Me', kind: 'self' }];

test('by default: the student’s own openings and yours of the same name; your library on your own card, or for a student with none', () => {
  assert.deepEqual(defaultBasis(openings, players[0]), ['sjl', 'jl']);
  assert.deepEqual(defaultBasis(openings, players[2]), ['jl', 'ck', 'kid']);
  assert.deepEqual(defaultBasis(openings, { id: 'new', kind: 'student' }), ['jl', 'ck', 'kid']);
  assert.deepEqual(basisFor(openings, players[0]), { ids: ['sjl', 'jl'], picked: false });
});

test('what was picked is used, in order (theirs, yours, other students’), and only what still exists', () => {
  const myla = { ...players[0], openingsBasis: { ids: ['zck', 'ck', 'gone', 'sjl'] } };
  assert.deepEqual(basisFor(openings, myla), { ids: ['sjl', 'ck', 'zck'], picked: true });
  assert.deepEqual(basisSummary(openings, ['sjl', 'ck', 'zck'], players), { white: ['jobava london system (Myla’s)'], black: ['Caro-Kann', 'Caro-Kann (Zed’s)'] });
});

test('in Chess Arcade’s compact form: colour, courses, chapters, lines; a student’s opening named for them', () => {
  const rep = arcadeRepertoire(openings, ['jl', 'sjl', 'nope'], players);
  assert.equal(rep.o.length, 2);
  assert.deepEqual(rep.o[0], {
    i: 'jl', n: 'Jobava London System', c: 'w', k: [['k1', 'Midas']],
    ch: [{ i: 'c1', n: 'Main', k: 'k1', s: '', ss: '', l: [['v1', 'v1', ['d4', 'd5', 'Nc3'], null]] }],
  });
  assert.equal(rep.o[1].n, 'jobava london system (Myla’s)');
  assert.equal(rep.o[1].f, 1, 'arranged by hand travels');
  assert.equal(rep.o[1].ch[0].s, 'A');
  assert.equal(arcadeRepertoire(openings, ['ck']).o[0].c, 'b');
});

test('every game with moves goes to the tab, marked or not; not a game set up from a position', () => {
  const player = {
    id: 'myla', name: 'Myla', kind: 'student',
    games: [
      { id: 'g1', moves: ['d4', 'd5'], meta: { white: 'Myla', black: 'Sam', result: '1-0', color: 'white' } },
      { id: 'g2', moves: [], meta: {} },
      { id: 'g3', moves: ['e5'], startFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', meta: {} },
      { id: 'g4', moves: ['e4', 'c6'], startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', meta: { white: 'Sam', black: 'Myla', result: '0-1', color: 'black' } },
    ],
  };
  const { games, byArcadeId } = openingsGames(player);
  assert.equal(games.length, 2);
  assert.equal(games[0].summary.san, 'd4 d5');
  assert.equal(games[0].summary.me, 'white');
  assert.equal(games[1].summary.me, 'black');
  assert.equal(games[1].summary.res, 'win');
  assert.equal(byArcadeId.get(games[1].id), 'g4');
  assert.equal(games[0].an, '');
});

test('Game Review checks a game against what the analysis board would: a student’s lines and yours, under their own names', () => {
  const ids = (r) => r.plain.o.map((o) => o.i);
  // a student's game: theirs first, then your whole library; named as they are, the card says whose
  const both = reviewRepertoire(openings, players[0]);
  assert.deepEqual(ids(both), ['sjl', 'jl', 'ck', 'kid']);
  assert.equal(both.plain.o[0].n, 'jobava london system');
  assert.equal(both.label, "Myla's + yours");
  assert.equal(both.whose, "Myla's repertoire or yours");
  // Repertoire to check: only theirs, only yours, none
  const theirs = reviewRepertoire(openings, players[0], 'student');
  assert.deepEqual(ids(theirs), ['sjl']);
  assert.equal(theirs.whose, "Myla's repertoire");
  assert.deepEqual(ids(reviewRepertoire(openings, players[0], 'mine')), ['jl', 'ck', 'kid']);
  assert.equal(reviewRepertoire(openings, players[0], 'mine').whose, 'your repertoire');
  assert.deepEqual(reviewRepertoire(openings, players[0], 'none').plain.o, []);
  // your own game, or one not saved yet: yours, nobody else's
  for (const owner of [players[2], null]) {
    const r = reviewRepertoire(openings, owner);
    assert.deepEqual(ids(r), ['jl', 'ck', 'kid']);
    assert.equal(r.label, null);
    assert.equal(r.whose, 'your repertoire');
  }
  // a line keeps its own ids: Learn and Practice open that very line
  assert.deepEqual(both.plain.o[0].ch[0].l[0].slice(0, 3), ['sv1', 'sv1', ['d4', 'd5', 'Nc3']]);
});

