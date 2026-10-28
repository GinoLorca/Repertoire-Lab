// Sharing a line — src/lib/shareLine.js: the message (the line's name, its
// moves, a Lichess link), the link itself, and the share sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  hasShareSheet, lineMessage, shareMessage, lichessUrl,
} from '../src/lib/shareLine.js';

const CARO = { id: 'caro', name: 'Caro-Kann', color: 'black' };
const LONDON = { id: 'london', name: 'Jobava London', color: 'white' };
const LINE = {
  id: 'v1',
  name: 'Caro-Kann Exchange Variation: 4.Nf3 #4',
  moves: 'e4 c6 d4 d5 exd5 cxd5 Nf3 Nc6 Bb5 Bg4 O-O e6 h3 Bh5 Qd3 Bd6'.split(' '),
  comments: { 9: 'Pin the knight. [%cal Gg4f3]' },
  badges: { 8: 'inaccuracy' },
};

test('the message: the line’s name, its moves, then the Lichess link — nothing else', () => {
  assert.equal(lineMessage(CARO, LINE), [
    'Caro-Kann Exchange Variation: 4.Nf3 #4',
    '1.e4 c6 2.d4 d5 3.exd5 cxd5 4.Nf3 Nc6 5.Bb5 Bg4 6.O-O e6 7.h3 Bh5 8.Qd3 Bd6',
    'Open in Lichess: https://lichess.org/analysis/pgn/1.e4_c6_2.d4_d5_3.exd5_cxd5_4.Nf3_Nc6_5.Bb5_Bg4_6.O-O_e6_7.h3_Bh5_8.Qd3_Bd6?color=black',
  ].join('\n\n'));
  // Check signs read as written; only the link leaves them off.
  const checks = lineMessage(LONDON, { name: 'Bb5+', moves: ['e4', 'd5', 'Bb5+', 'c6'] });
  assert.match(checks, /\n\n1\.e4 d5 2\.Bb5\+ c6\n\n/);
});

test('a line from a set-up position says where it starts', () => {
  const fen = 'r1bqkbnr/pp2pppp/2n5/3p4/3P4/5N2/PP3PPP/RNBQKB1R b KQkq - 1 5';
  const parts = lineMessage(CARO, { name: 'Set up', startFen: fen, moves: ['Nf6', 'Bb5'] }).split('\n\n');
  assert.equal(parts[1], `From the position: ${fen}`);
  assert.equal(parts[2], '5...Nf6 6.Bb5');
  assert.match(parts[3], /^Open in Lichess: https:\/\/lichess\.org\/analysis\/pgn\/%5BSetUp/);
});

test('the Lichess link: the moves, from your side, nothing it would misread', () => {
  const url = lichessUrl(CARO, { ...LINE, moves: ['e4', 'c6', 'd4', 'd5', 'Bc4', 'dxc4', 'Qh5', 'Nf6', 'Qxf7#'] });
  assert.equal(url, 'https://lichess.org/analysis/pgn/1.e4_c6_2.d4_d5_3.Bc4_dxc4_4.Qh5_Nf6_5.Qxf7%23?color=black');
  const checks = lichessUrl(LONDON, { moves: ['e4', 'd5', 'Bb5+', 'c6'] });
  assert.equal(checks, 'https://lichess.org/analysis/pgn/1.e4_d5_2.Bb5_c6');
  // Notes and glyphs stay out of the address.
  assert.ok(!lichessUrl(CARO, LINE).includes('Pin'));
  // A set-up line: its FEN rides along, as Lichess reads a PGN.
  const fen = 'r1bqkbnr/pp2pppp/2n5/3p4/3P4/5N2/PP3PPP/RNBQKB1R b KQkq - 1 5';
  const setUp = lichessUrl(CARO, { startFen: fen, moves: ['Nf6'] });
  const read = decodeURIComponent(setUp.replace('https://lichess.org/analysis/pgn/', '').replace('?color=black', '')).replace(/_/g, ' ');
  assert.equal(read, `[SetUp "1"] [FEN "${fen}"] 5...Nf6`);
  assert.ok(new Chess(fen).move('Nf6'));
});

test('the share sheet gets the message as text; closing it isn’t a failure', async () => {
  const shared = [];
  const nav = (fail) => ({
    share: async (data) => {
      if (fail) { const e = new Error('no'); e.name = fail; throw e; }
      shared.push(data);
    },
  });
  const text = lineMessage(CARO, LINE);
  assert.equal(await shareMessage(text, nav()), 'shared');
  assert.deepEqual(shared[0], { text });
  assert.equal(await shareMessage(text, nav('AbortError')), 'cancelled');
  assert.equal(await shareMessage(text, nav('NotAllowedError')), 'failed');
  assert.equal(await shareMessage(text, {}), 'failed');
  assert.equal(hasShareSheet({}), false);
  assert.equal(hasShareSheet(nav()), true);
});
