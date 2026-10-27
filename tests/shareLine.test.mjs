// Sharing a line — src/lib/shareLine.js: its PGN, the share sheet, and the link
// to Lichess's analysis board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  linePgn, hasShareSheet, sharePgn, lichessUrl,
} from '../src/lib/shareLine.js';
import { splitPgnGames, movetextToLines } from '../src/lib/pgn.js';

const CARO = { id: 'caro', name: 'Caro-Kann', color: 'black' };
const LONDON = { id: 'london', name: 'Jobava London', color: 'white' };
const CHAPTER = { id: 'x', name: 'Exchange Variation' };
const LINE = {
  id: 'v1',
  name: 'Caro-Kann Exchange Variation: 4.Nf3 #4',
  moves: 'e4 c6 d4 d5 exd5 cxd5 Nf3 Nc6 Bb5 Bg4 O-O e6 h3 Bh5 Qd3 Bd6'.split(' '),
  comments: { 9: 'Pin the knight. [%cal Gg4f3]' },
  badges: { 8: 'inaccuracy' },
};

test('a line’s PGN: named for the opening and line, with its notes, glyphs and arrows', () => {
  const { pgn, filename, title } = linePgn(CARO, CHAPTER, LINE);
  assert.equal(filename, 'Caro-Kann_Exchange_Variation_4_Nf3_4.pgn');
  assert.equal(title, 'Caro-Kann — Caro-Kann Exchange Variation: 4.Nf3 #4');
  assert.match(pgn, /\[Event "Caro-Kann: Exchange Variation"\]/);
  // Your side is the opening's: Black here.
  assert.match(pgn, /\[White "Caro-Kann Exchange Variation: 4\.Nf3 #4"\]/);
  assert.match(pgn, /\[Black "Caro-Kann"\]/);
  assert.match(pgn, /5\.Bb5\?! \$6 Bg4 \{Pin the knight\. \[%cal Gg4f3\]\} 6\.O-O/);
  // And it reads back as the same line.
  const [game] = splitPgnGames(pgn);
  const [back] = movetextToLines(game.movetext);
  assert.deepEqual(back.moves, LINE.moves);
  assert.equal(back.badges[8], 'inaccuracy');
  assert.equal(back.comments[9], LINE.comments[9]);
  assert.equal(linePgn(LONDON, CHAPTER, LINE).pgn.match(/\[White "(.*)"\]/)[1], 'Jobava London');
});

test('a line from a set-up position keeps its FEN', () => {
  const fen = 'r1bqkbnr/pp2pppp/2n5/3p4/3P4/5N2/PP3PPP/RNBQKB1R b KQkq - 1 5';
  const { pgn } = linePgn(CARO, CHAPTER, { ...LINE, startFen: fen, moves: ['Nf6', 'Bb5'], comments: {}, badges: {} });
  assert.match(pgn, /\[SetUp "1"\]/);
  assert.ok(pgn.includes(`[FEN "${fen}"]`));
  assert.match(pgn, /5\.\.\.Nf6 6\.Bb5 \*/);
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

test('the share sheet: a .pgn file where it takes one, else the text; closing it isn’t a failure', async () => {
  const shared = [];
  const nav = (canFiles, fail) => ({
    canShare: ({ files }) => canFiles && files.every((f) => f.name.endsWith('.pgn')),
    share: async (data) => {
      if (fail) { const e = new Error('no'); e.name = fail; throw e; }
      shared.push(data);
    },
  });
  const item = linePgn(CARO, CHAPTER, LINE);
  assert.equal(await sharePgn(item, nav(true)), 'shared');
  assert.equal(shared[0].files[0].name, item.filename);
  assert.equal(await shared[0].files[0].text(), item.pgn);
  assert.equal(await sharePgn(item, nav(false)), 'shared');
  assert.equal(shared[1].text, item.pgn);
  assert.equal(await sharePgn(item, nav(true, 'AbortError')), 'cancelled');
  assert.equal(await sharePgn(item, nav(true, 'NotAllowedError')), 'failed');
  assert.equal(await sharePgn(item, {}), 'failed');
  assert.equal(hasShareSheet({}), false);
  assert.equal(hasShareSheet(nav(true)), true);
});
