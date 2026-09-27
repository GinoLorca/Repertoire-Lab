// A course typed up by hand (or by an assistant) writes moves the ways books
// do. Each of these used to cut the line short, drop a badge, or lose a game
// without a word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movetextToLines, validateLine } from '../src/lib/pgn.js';
import { pgnTextToEntries } from '../src/lib/pgnImport.js';

const read = (text) => {
  const [line] = movetextToLines(text);
  return { ...line, ...validateLine(line.moves) };
};

test('castling written with zeros', () => {
  const l = read('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. 0-0 Nf6 5. d3 0-0 6. Nc3 d6 7. Bg5 h6 8. Bh4 g5 9. Bg3 Bg4 10. h3 Bh5');
  assert.ok(l.ok);
  assert.equal(l.moves[6], 'O-O');
  assert.equal(l.moves[9], 'O-O');
  const q = read('1. d4 d5 2. Nc3 Nf6 3. Bf4 e6 4. Qd2 Be7 5. 0-0-0+');
  assert.equal(q.moves[8], 'O-O-O');
});

test('Black\'s move numbered with the ellipsis character, or with dots on their own', () => {
  for (const x of ['2… d5', '2…d5', '2. ... d5', '2 ... d5', '2.…d5', '...d5']) {
    const l = read(`1. e4 c6 2. d4 {note} ${x}`);
    assert.ok(l.ok, x);
    assert.deepEqual(l.moves, ['e4', 'c6', 'd4', 'd5'], x);
    assert.equal(l.comments[2], 'note', x);
  }
});

test('glyphs and NAGs however they\'re attached', () => {
  assert.deepEqual(read('1. e4$1 e5 2. Nf3 $2').badges, { 0: 'great', 2: 'mistake' });
  assert.deepEqual(read('1. e4 ! e5 ?? 2. Nf3').badges, { 0: 'great', 1: 'blunder' });
  assert.deepEqual(read('1. e4 {x} ! e5').badges, { 0: 'great' });
  const mate = read('1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7!#');
  assert.ok(mate.ok);
  assert.equal(mate.moves[6], 'Qxf7#');
  assert.deepEqual(mate.badges, { 5: 'blunder', 6: 'great' });
});

test('evaluation signs and "e.p." between moves are skipped', () => {
  const l = read('1. e4 e5 2. Nf3 ± Nc6 += 3. Bb5 N 3... a6 ∞ 4. Ba4 =');
  assert.ok(l.ok);
  assert.deepEqual(l.moves, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4']);
  assert.ok(read('1. e4 d5 2. e5 f5 3. exf6 e.p. Nxf6').ok);
});

test('signs that come before a move nobody played, and "N f3", stop the line where it shows', () => {
  // "Δ" = with the idea, "⌓" = better is: the move after them wasn't played.
  const idea = read('1. d4 d5 2. Bf4 Nf6 3. e3 e6 4. Nd2 c5 5. c3 Nc6 6. Ngf3 Bd6 7. Bg3 O-O 8. Bd3 Δ Ne5');
  assert.equal(idea.ok, false);
  assert.equal(idea.moves.at(-1), 'Bd3');
  assert.equal(read('1. e4 e5 2. Nf3 ⌓ Bc4').ok, false);
  // A knight move typed with a space isn't turned into a pawn move.
  const knight = read('1. d4 Nf6 2. c4 e6 3. N f3 b6');
  assert.equal(knight.ok, false);
  assert.equal(knight.failedToken, 'N');
  // …but a novelty mark before a move number, a comment or the end is skipped.
  assert.ok(read('1. d4 Nf6 2. c4 b6 N 3. Nc3').ok);
  assert.ok(read('1. d4 Nf6 2. c4 b6 N {new} 3. Nc3 Bb7 N').ok);
});

test('a row that can\'t be added takes no name from a line that can', () => {
  const pgn = '[Event "Ch"]\n[White "Idea"]\n[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]\n\n2. Nf3 *\n\n'
    + '[Event "Ch"]\n[White "Idea"]\n\n1. e4 e5 *\n\n[Event "Ch"]\n[White "Idea"]\n\n1. d4 d5 *';
  assert.deepEqual(
    pgnTextToEntries(pgn, { includeUnusable: true }).map((e) => [e.name, e.moves.length]),
    [['Idea', 0], ['Idea', 2], ['Idea (2)', 2]],
  );
  assert.deepEqual(pgnTextToEntries(pgn).map((e) => e.name), ['Idea', 'Idea (2)']);
});

test('a bracket with only words in it adds them to the line, not a cut-off copy', () => {
  const lines = movetextToLines('1. e4 c6 2. d4 d5 3. Nc3 dxe4 ({Also possible is 3...g6.}) 4. Nxe4 ()');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].comments[4], 'Also possible is 3...g6.');
});

test('tag lines with stray spaces are still tags; "?" and spaces don\'t make chapters', () => {
  const entries = pgnTextToEntries(
    '  [Event "Ch" ]\n[White "L1"]\n[Black "?"]\n\n1. e4 c6 *\n\n[Event "?"]\n[White "L2"]\n\n1. d4 d5 *\n\n[Event " Ch "]\n[White "L3"]\n\n1. c4 e5 *',
  );
  assert.deepEqual(entries.map((e) => [e.name, e.event]), [['L1', 'Ch'], ['L2', null], ['L3', 'Ch']]);
});

test('a game the app can\'t use is listed with why, never played from the wrong position', () => {
  const pgn = [
    '[Event "A"]\n[White "Set up"]\n[SetUp "1"]\n[FEN "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"]\n\n2. Nf3 Nc6 *',
    '[Event "A"]\n[White "Normal start"]\n[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]\n\n1. e4 e5 *',
    '[Event "A"]\n[White "Bad first move"]\n\n1. e5 e4 *',
  ].join('\n\n');
  const listed = pgnTextToEntries(pgn, { includeUnusable: true });
  assert.deepEqual(listed.map((e) => [e.name, e.moves.length, e.unusable ?? null]), [
    ['Set up', 0, 'starts from a set-up position'],
    ['Normal start', 2, null],
    ['Bad first move', 0, 'can’t read its first move, “e5”'],
  ]);
  // Anywhere else (Analysis), only what can be played.
  assert.deepEqual(pgnTextToEntries(pgn).map((e) => e.name), ['Normal start']);
});
