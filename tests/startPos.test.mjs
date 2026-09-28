// Lines that start from a set-up position ([SetUp "1"] [FEN …]) — a course's
// "Typical Ideas": imported with their start, numbered and played from it,
// exported with it, and kept apart from lines that start from the beginning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  START_FEN, plyOffset, moveNumberLabel, isWhiteMove, canonicalStartFen, isStandardStart, replay, sameStart,
} from '../src/lib/startPos.js';
import { variationToPgn, movesToMovetext, lineFens, validateLine } from '../src/lib/pgn.js';
import { pgnTextToEntries, parsePastedLine } from '../src/lib/pgnImport.js';
import {
  studySegments, resolveNote, noteParts, fenAfter, lastMoveAfter, marksAt,
} from '../src/lib/studyText.js';
import {
  buildPositionIndex, bookMovesAt, rankVariationsByMoves, matchGameToRepertoire, moveLabel,
} from '../src/lib/repertoire.js';
import { classifyGame } from '../src/lib/games.js';
import { startGroups, mergeVariations, treeMove } from '../src/lib/repertoireTree.js';
import {
  stemOf, branchOf, suggestParent, suggestName,
} from '../src/lib/subVariations.js';
import { sharedPrefix, diverge } from '../src/lib/compare.js';

// Queen's Gambit Declined, Black to move at move 12 (an isolated pawn soon).
const IQP = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N2N2/PP2BPPP/R1BQ1RK1 b - - 0 12';

test('numbering and whose move it is come from the FEN', () => {
  assert.equal(plyOffset(START_FEN), 0);
  assert.equal(plyOffset(IQP), 23);
  assert.equal(moveNumberLabel(0, IQP), '12...');
  assert.equal(moveNumberLabel(1, IQP), '13.');
  assert.equal(moveNumberLabel(2, IQP, '…'), '13…');
  assert.equal(isWhiteMove(0, IQP), false);
  assert.equal(moveNumberLabel(0), '1.');
  assert.equal(moveNumberLabel(3), '2...');
});

test('a start is stored once, normalised, and never for the normal start', () => {
  assert.equal(canonicalStartFen(START_FEN), null);
  assert.equal(canonicalStartFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -'), null);
  assert.equal(canonicalStartFen(IQP), IQP);
  // Four fields are padded; nonsense is refused.
  assert.equal(canonicalStartFen(IQP.split(' ').slice(0, 4).join(' ')), IQP.replace('0 12', '0 1'));
  assert.equal(canonicalStartFen('not a position'), null);
  assert.ok(isStandardStart(undefined));
  assert.ok(!isStandardStart(IQP));
  assert.ok(sameStart({ startFen: IQP }, { startFen: IQP.replace('0 12', '3 20') }));
  assert.ok(!sameStart({ startFen: IQP }, {}));
});

test('replaying stops at a move the position can\'t play, instead of throwing', () => {
  const { played, game } = replay(['dxc4', 'e4', 'Bxc4'], IQP);
  assert.equal(played.length, 1);
  assert.equal(game.turn(), 'w');
  assert.deepEqual(lineFens(['dxc4', 'Nonsense'], IQP).length, 2);
  assert.ok(validateLine(['dxc4', 'Bxc4'], IQP).ok);
  assert.ok(!validateLine(['dxc4', 'Bxc4']).ok);
});

const COURSE = `[Event "Typical Ideas for White"]
[White "Idea #1: the IQP"]
[Black "?"]
[SetUp "1"]
[FEN "${IQP}"]

{Black takes on c4 and White recaptures with the bishop. [%cal Gd5c4]} 12... dxc4 13. Bxc4 {The bishop is active. [%cal Gc4f7] [%csl Yd4]} (13. Qa4 {Also possible.} 13... a6) 13... b6 14. a3 $1 Bb7 *`;

test('a course\'s set-up game imports with its start, its side lines too', () => {
  const [main, alt] = pgnTextToEntries(COURSE, { includeUnusable: true });
  assert.equal(main.name, 'Idea #1: the IQP');
  assert.equal(main.startFen, IQP);
  assert.ok(main.ok);
  assert.deepEqual(main.moves, ['dxc4', 'Bxc4', 'b6', 'a3', 'Bb7']);
  assert.equal(main.comments[-1], 'Black takes on c4 and White recaptures with the bishop. [%cal Gd5c4]');
  assert.equal(main.badges[3], 'great');
  assert.equal(alt.name, 'Idea #1: the IQP (alt 1)');
  assert.equal(alt.startFen, IQP);
  assert.ok(alt.ok);
  assert.deepEqual(alt.moves, ['dxc4', 'Qa4', 'a6']);
});

test('a side line from a set-up position doesn\'t inherit the arrow for the move it replaces', () => {
  const pgn = `[Event "x"]\n[White "Arrows"]\n[FEN "${IQP}"]\n\n12... dxc4 {[%cal Ge2c4,Gd1a4]} 13. Bxc4 (13. Qa4 a6) 13... b6 *`;
  const [main, alt] = pgnTextToEntries(pgn);
  assert.equal(main.comments[0], '[%cal Ge2c4,Gd1a4]');
  // The Qa4 line keeps d1→a4 but not e2→c4, the main line's reply.
  assert.equal(alt.comments[0], '[%cal Gd1a4]');
});

test('exported with SetUp/FEN and numbered from the position; reads back the same', () => {
  const [main] = pgnTextToEntries(COURSE);
  const pgn = variationToPgn({ ...main }, { event: 'Typical Ideas', white: 'Idea #1', black: '?' });
  assert.match(pgn, /\[SetUp "1"\]/);
  assert.ok(pgn.includes(`[FEN "${IQP}"]`));
  assert.ok(pgn.includes('12...dxc4 13.Bxc4 {The bishop is active.'));
  assert.ok(pgn.includes('13...b6 14.a3! $1 Bb7'));
  const [back] = pgnTextToEntries(pgn);
  assert.equal(back.startFen, IQP);
  assert.deepEqual(back.moves, main.moves);
  assert.deepEqual(back.comments, main.comments);
  assert.deepEqual(back.badges, main.badges);
  // chess.js reads it as a PGN too.
  const game = new Chess();
  game.loadPgn(pgn);
  assert.equal(game.history().length, 5);
  // A normal line is exported as it always was.
  assert.equal(movesToMovetext(['e4', 'c6']), '1.e4 c6');
});

test('Study numbers, positions and note links work from the set-up position', () => {
  const [main] = pgnTextToEntries(COURSE);
  const segs = studySegments(main.moves, main.comments, IQP);
  assert.equal(segs[0].kind, 'note'); // the introduction
  assert.equal(segs[1].moves[0].number, '12...');
  assert.equal(segs[1].moves[1].number, '13.');
  assert.equal(new Chess(fenAfter(['dxc4'], IQP)).turn(), 'w');
  assert.deepEqual(lastMoveAfter(['dxc4'], IQP), { from: 'd5', to: 'c4' });
  assert.deepEqual(marksAt(main.comments, 0).arrows, [['d5', 'c4', '#2ecc71']]);
  // A note naming the game's own move numbers plays on the board…
  const [seq] = resolveNote(main.moves, noteParts('Instead 13.Qa4 a6 is slower.'), IQP).filter((p) => p.kind === 'seq');
  assert.deepEqual(seq.line.base, ['dxc4']);
  assert.deepEqual(seq.line.path, ['Qa4', 'a6']);
  // …and one from before the set-up position has nothing to play from.
  const [early] = resolveNote(main.moves, noteParts('After 5.Nf3 the plan changes.'), IQP).filter((p) => p.kind === 'seq');
  assert.equal(early.line, null);
});

const opening = (variations) => ({ id: 'o', name: 'QGD', color: 'white', chapters: [{ id: 'c', name: 'Ideas', variations }] });

test('the repertoire joins a set-up line at its position, and nowhere else', () => {
  const idea = { id: 'idea', name: 'Idea', moves: ['dxc4', 'Bxc4', 'b6'], startFen: IQP };
  const normal = { id: 'norm', name: 'QGD', moves: ['d4', 'd5', 'c4'] };
  const index = buildPositionIndex([opening([idea, normal])]);
  assert.deepEqual(bookMovesAt(index, IQP).map((b) => b.san), ['dxc4']);
  assert.deepEqual(bookMovesAt(index, START_FEN).map((b) => b.san), ['d4']);
  // Searching moves from the start never finds the set-up line.
  assert.deepEqual(rankVariationsByMoves(['d4', 'd5'], [opening([idea, normal])]).map((r) => r.variation.id), ['norm']);
  // A game set up at that position follows it.
  const m = matchGameToRepertoire(['dxc4', 'Bxc4'], index, IQP);
  assert.ok(m.matched);
  assert.equal(m.variation.id, 'idea');
  assert.equal(moveLabel(0, IQP), '12…');
});

test('a game that reaches a course\'s set-up position counts as following it', () => {
  // The IQP position, reached by moves from the start.
  const moves = ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'Be7', 'e3', 'O-O', 'Be2', 'c5', 'O-O', 'Nc6',
    'cxd5', 'exd5', 'dxc5', 'Bxc5', 'b3', 'a6', 'Bb2', 'Re8', 'Rc1'];
  const game = new Chess();
  for (const m of moves) game.move(m);
  const reached = game.fen();
  const idea = { id: 'idea', name: 'Idea', moves: [game.moves()[0]], startFen: reached };
  const shallow = { id: 'qgd', name: 'QGD', moves: ['d4', 'd5', 'c4', 'e6'] };
  const hit = classifyGame(moves, buildPositionIndex([opening([idea, shallow])]));
  assert.ok(hit.matched);
  assert.equal(hit.variation.id, 'idea');
});

test('the tree browser keeps each start to its own tree', () => {
  const lines = [
    { id: 'a', moves: ['d4', 'd5'] },
    { id: 'b', moves: ['dxc4', 'Bxc4'], startFen: IQP },
    { id: 'c', moves: ['dxc4', 'Qa4'], startFen: IQP },
    { id: 'd', moves: ['c4'] },
  ];
  const groups = startGroups(lines);
  assert.deepEqual(groups.map((g) => [g.startFen, g.variations.map((v) => v.id)]), [[null, ['a', 'd']], [IQP, ['b', 'c']]]);
  const tree = mergeVariations(groups[1].variations);
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].children.length, 2);
  // A move off the tree is named from the position itself.
  const off = treeMove(Chess, tree, IQP, 0, 'b7', 'b6');
  assert.equal(off.offBook.san, '12…b6');
});

test('sub-variations and Compare only share moves between lines from the same start', () => {
  const idea = { id: 'i', moves: ['dxc4', 'Bxc4'], startFen: IQP };
  const idea2 = { id: 'j', moves: ['dxc4', 'Qa4'], startFen: IQP };
  const normal = { id: 'n', moves: ['dxc4'] };
  assert.deepEqual(stemOf([idea, idea2]), ['dxc4']);
  assert.deepEqual(stemOf([idea, normal]), []);
  const b = branchOf([idea, idea2, normal], 'i');
  assert.deepEqual(b.ids, ['i']);
  assert.equal(b.label, '13.Bxc4');
  assert.equal(suggestParent([{ key: 'k', lines: [normal] }], { variations: [idea] }), null);
  assert.equal(sharedPrefix(['d4'], ['d4'], IQP, START_FEN), 0);
  assert.equal(sharedPrefix(idea.moves, idea2.moves, IQP, IQP), 1);
  assert.equal(diverge(idea, normal).sameStart, false);
  assert.equal(diverge(idea, idea2).at, 1);
});

test('a set-up line in a chapter doesn\'t spoil suggestions for its ordinary lines', () => {
  const A = { id: 'A', name: 'Caro-Kann Exchange: 4.c4', moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'c4', 'Nf6'] };
  const B = { id: 'B', name: 'Caro-Kann Exchange: 4.Bd3', moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5', 'Bd3', 'Nc6'] };
  const S = { id: 'S', name: 'Idea', moves: ['dxc4', 'Bxc4'], startFen: IQP };
  const chapter = { name: 'Exchange', variations: [A, B, S] };
  assert.equal(suggestName({ ...chapter, variations: [A, B, { ...A, id: 'A2', name: 'Other: 4.c4 Nc6' }, S] }, ['A', 'A2']), '4.c4');
  const X = { key: 'X', lines: [{ id: 'x', moves: ['e4', 'c6', 'd4', 'd5', 'exd5', 'cxd5'] }] };
  const Y = { key: 'Y', lines: [{ id: 'y', moves: ['d4', 'd5'] }] };
  assert.equal(suggestParent([X, Y], chapter), 'X');
});

test('a course note naming an opening move before the set-up position isn\'t played on the line', () => {
  // Counter reset to move 1, as course exports often have it.
  const fen = 'rn1qk2r/ppp2ppp/3bpn2/3p1b2/3P1B2/2N1PN2/PPP2PPP/R2QKB1R w KQkq - 0 1';
  const moves = ['Ne5', 'O-O', 'g4', 'Bg6', 'h4'];
  const [ref] = resolveNote(moves, noteParts('This arises in the symmetrical variation (3...Bf5).'), fen, -1).filter((p) => p.kind === 'seq');
  assert.equal(ref.line, null);
  // The line's own moves still link.
  const [own] = resolveNote(moves, noteParts('Next comes 2.g4 Bg6.'), fen, 0).filter((p) => p.kind === 'seq');
  assert.deepEqual(own.line.base, ['Ne5', 'O-O']);
});

test('a pasted PGN with a set-up position is read from there; a position with no moves is listed', () => {
  const read = parsePastedLine(`[Event "x"]\n[FEN "${IQP}"]\n\n12... dxc4 13. Bxc4 *`);
  assert.equal(read.startFen, IQP);
  assert.ok(read.parsed.ok);
  assert.deepEqual(read.parsed.moves, ['dxc4', 'Bxc4']);
  assert.equal(parsePastedLine('1. e4 e5').startFen, undefined);
  const [key] = pgnTextToEntries(`[Event "x"]\n[White "Key position"]\n[FEN "${IQP}"]\n\n{Remember this.} *`, { includeUnusable: true });
  assert.equal(key.unusable, 'a set-up position with no moves');
  // Searching moves from a set-up position finds the lines from there.
  const idea = { id: 'idea', name: 'Idea', moves: ['dxc4', 'Bxc4', 'b6'], startFen: IQP };
  assert.deepEqual(rankVariationsByMoves(['dxc4', 'Bxc4'], [opening([idea])], IQP).map((r) => r.variation.id), ['idea']);
});

test('reaching a set-up position files the game there, however long the ordinary lines are', () => {
  const moves = ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'];
  const game = new Chess();
  for (const m of moves) game.move(m);
  const idea = { id: 'idea', name: 'Idea', moves: ['Bg5'], startFen: game.fen() };
  const longOrdinary = { id: 'long', name: 'Long', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'] };
  const hit = classifyGame(moves, buildPositionIndex([opening([longOrdinary, idea])]));
  assert.ok(hit.matched);
  assert.equal(hit.variation.id, 'idea');
});
