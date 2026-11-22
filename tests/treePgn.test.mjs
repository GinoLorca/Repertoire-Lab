// A whole board as PGN text (src/lib/pgn.js treeToMovetext, treeToPgn): what
// the analysis board's "Copy PGN" puts on the clipboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { treeToMovetext, treeToPgn, movesToMovetext } from '../src/lib/pgn.js';
import { pgnTextToEntries } from '../src/lib/pgnImport.js';
import { makeTree, addMove, mainLineFrom } from '../src/lib/moveTree.js';

const RUY = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6'];

test('a line with nothing on it reads exactly as the line writer has it', () => {
  const tree = makeTree(RUY);
  assert.equal(treeToMovetext(tree), movesToMovetext(RUY));
  assert.equal(treeToMovetext(tree), '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6');
  assert.equal(treeToMovetext(makeTree([])), '');
});

test('notes in braces, a badge as its glyph and NAG, and the move after a note is numbered', () => {
  const tree = makeTree(RUY);
  const main = mainLineFrom(tree);
  const notes = { root: 'The Spanish.', [main[1].id]: 'The open game. [%cal Ge7e5]', [main[4].id]: 'Pins {nothing} yet.' };
  const badges = { [main[5].id]: 'mistake' };
  const text = treeToMovetext(tree, { notes, badges });
  assert.ok(text.startsWith('{The Spanish.} 1.e4 e5 {The open game. [%cal Ge7e5]} 2.Nf3 Nc6 3.Bb5 {Pins nothing yet.} 3...a6'), text);
  assert.ok(text.endsWith('4.Ba4 Nf6'), text);
  // The badge reads as the line writer writes it.
  const asLine = movesToMovetext(RUY, { 4: 'Pins nothing yet.' }, { 5: 'mistake' });
  assert.ok(text.includes(asLine.slice(asLine.indexOf('3...a6'))), `${text}\n${asLine}`);
});

test('side lines in brackets where they leave, nested, each starting with its number', () => {
  let tree = makeTree(RUY);
  const main = mainLineFrom(tree);
  // 3.Bc4 instead of 3.Bb5, and in it 3...Nf6 beside 3...Bc5; and 2...d6 instead of 2...Nc6.
  let r = addMove(tree, main[3].id, 'Bc4'); tree = r.tree; const bc4 = r.nodeId;
  r = addMove(tree, bc4, 'Bc5'); tree = r.tree;
  r = addMove(tree, bc4, 'Nf6'); tree = r.tree; const nf6 = r.nodeId;
  r = addMove(tree, nf6, 'Ng5'); tree = r.tree;
  r = addMove(tree, main[2].id, 'd6'); tree = r.tree;
  const text = treeToMovetext(tree, { notes: { [bc4]: 'The Italian.' } });
  assert.equal(text, '1.e4 e5 2.Nf3 Nc6 (2...d6) 3.Bb5 (3.Bc4 {The Italian.} 3...Bc5 (3...Nf6 4.Ng5)) 3...a6 4.Ba4 Nf6');
  // The game in it plays, read back by a real PGN reader.
  const chess = new Chess();
  chess.loadPgn(text);
  assert.deepEqual(chess.history(), RUY);
});

test('the PGN: the seven tags, the game\'s own where known, where it starts, the result', () => {
  const tree = makeTree(RUY);
  const pgn = treeToPgn(tree, {
    tags: {
      white: 'Ann "The Pin" Lee', black: 'Bo', result: '1-0', date: Date.UTC(2026, 10, 22, 12), event: 'Club night',
    },
  });
  const lines = pgn.split('\n');
  assert.deepEqual(lines.slice(0, 7), [
    '[Event "Club night"]', '[Site "?"]', '[Date "2026.11.22"]', '[Round "-"]',
    '[White "Ann \'The Pin\' Lee"]', '[Black "Bo"]', '[Result "1-0"]',
  ]);
  assert.equal(lines[7], '');
  assert.ok(pgn.endsWith('4.Ba4 Nf6 1-0\n'), pgn);
  // Nothing known: still a PGN any reader takes.
  const bare = treeToPgn(tree);
  assert.ok(bare.includes('[White "?"]\n[Black "?"]\n[Result "*"]\n\n1.e4'), bare);
  assert.ok(bare.includes('[Date "????.??.??"]') && bare.endsWith(' *\n'));
  assert.ok(treeToPgn(tree, { tags: { date: '2026-11-02' } }).includes('[Date "2026.11.02"]'));
  // From a position: SetUp and FEN, and numbered from there.
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  const from = treeToPgn(makeTree(['Bb5', 'a6']), { startFen: fen });
  assert.ok(from.includes(`[SetUp "1"]\n[FEN "${fen}"]`), from);
  assert.ok(from.includes('\n\n3.Bb5 a6 *\n'), from);
  // …and the app's own reader takes it back as the same game.
  const entries = pgnTextToEntries(pgn, { mainLineOnly: true });
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].moves, RUY);
});
