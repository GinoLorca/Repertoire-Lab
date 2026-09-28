// Sending a game to the analysis board with no side on record: the side of
// the repertoire it follows is the best guess at whose game it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPositionIndex, repertoireSide } from '../src/lib/repertoire.js';

const opening = (name, color, lines) => ({
  id: name, name, color, chapters: [{ id: `${name}-c`, name, variations: lines.map((moves, i) => ({ id: `${name}-${i}`, name: `${name} ${i}`, moves })) }],
});
const jobava = opening('Jobava', 'white', [['d4', 'd5', 'Nc3', 'Nf6', 'Bf4', 'c5', 'e3', 'Nc6']]);
const caro = opening('Caro-Kann', 'black', [['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5']]);
const index = buildPositionIndex([jobava, caro]);

test('a game with no side on record takes the side of the repertoire it follows', () => {
  assert.equal(repertoireSide(['d4', 'd5', 'Nc3', 'Nf6', 'Bf4', 'e6'], index), 'white');
  assert.equal(repertoireSide(['e4', 'c6', 'd4', 'd5', 'Nc3'], index), 'black');
});

test('no guess from one move in book, from nothing in book, or when both sides share the position', () => {
  assert.equal(repertoireSide(['d4', 'Nf6'], index), null); // one move deep
  assert.equal(repertoireSide(['c4', 'e5'], index), null);
  assert.equal(repertoireSide([], index), null);
  // A White London and a Black defence against d4 both reach 1.d4 d5.
  const both = buildPositionIndex([jobava, opening('vs d4', 'black', [['d4', 'd5', 'c4', 'e6']])]);
  assert.equal(repertoireSide(['d4', 'd5', 'Nf3'], both), null);
  // …until the game goes where only one of them does.
  assert.equal(repertoireSide(['d4', 'd5', 'Nc3', 'Nf6'], both), 'white');
});

test('a PGN’s White/Black names put you on your side — your own sections only', async () => {
  const { sideFromNames } = await import('../src/lib/pov.js');
  const players = [
    { id: 'me', kind: 'self', name: 'Gino Lorca', profile: { lichess: 'ginoL', chesscom: 'GinoChess' } },
    { id: 's1', kind: 'student', name: 'Parker Reckhow' },
  ];
  assert.equal(sideFromNames({ white: 'Keith Magnussen', black: 'gino lorca' }, players), 'black');
  assert.equal(sideFromNames({ white: 'GINOL', black: 'someone' }, players), 'white'); // a handle, any case
  assert.equal(sideFromNames({ white: 'Parker Reckhow', black: 'x' }, players), null); // a student isn't you
  assert.equal(sideFromNames({ white: 'Gino Lorca', black: 'GinoChess' }, players), null); // both
  assert.equal(sideFromNames(undefined, players), null);
});
