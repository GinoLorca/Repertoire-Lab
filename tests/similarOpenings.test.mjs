// Similar openings — src/lib/similarOpenings.js: lines in a repertoire whose
// positions resemble the board's, closest first, and nothing looser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { buildPositionIndex } from '../src/lib/repertoire.js';
import {
  buildSimilarIndex, similarOpenings, compare, describeDiff, afterLabel, differingSquares,
} from '../src/lib/similarOpenings.js';

const line = (name, moves) => ({ id: name, name, moves: moves.split(' ') });
const opening = (name, color, variations) => ({
  id: name, name, color, chapters: [{ id: `${name}-c`, name: 'Main', variations }],
});
// The Caro-Kann Exchange, and a London from the other side of the board.
const CARO = opening('Caro-Kann', 'black', [
  line('Exchange', 'e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 c3 Nf6 Bf4 Bg4 Qb3 Qd7 Nd2 e6'),
  line('Exchange 4.Nf3', 'e4 c6 d4 d5 exd5 cxd5 Nf3 Nc6 Bb5 Nf6 O-O Bg4'),
]);
const LONDON = opening('London', 'white', [
  line('London vs ...c5', 'd4 d5 Bf4 Nf6 e3 c5 c3 Nc6 Nd2 e6 Ngf3 Bd6'),
]);
const indexOf = (...openings) => buildSimilarIndex(buildPositionIndex(openings));
const at = (moves) => {
  const c = new Chess();
  for (const m of moves.split(' ')) c.move(m);
  return { fen: c.fen(), ply: c.history().length };
};
const ask = (index, moves, opts = {}) => {
  const { fen, ply } = at(moves);
  return similarOpenings(index, fen, { gamePly: ply, ...opts });
};

test('the same position, by another road: a transposition', () => {
  const r = ask(indexOf(CARO), 'd4 d5 e4 c6 exd5 cxd5 Bd3 Nc6 c3 Nf6');
  assert.equal(r[0].tier, 'same');
  assert.equal(r[0].variation.name, 'Exchange');
  assert.equal(r[0].after, 'after 5…Nf6');
  assert.deepEqual(r[0].next.map((m) => [m.san, m.legal]), [['Bf4', true]]);
});

test('one move away: the move that lands in a line, and how it goes on', () => {
  const r = ask(indexOf(CARO), 'e4 c6 d4 d5 exd5 cxd5 c3 Nc6');
  assert.equal(r[0].tier, 'move');
  assert.equal(r[0].via.label, '5.Bd3');
  assert.equal(r[0].after, 'after 5.c3');
  assert.deepEqual(r[0].then.map((m) => m.san), ['Nf6']);
  assert.deepEqual(r[0].next.map((m) => m.san), ['Bd3']);
});

test('the same pawns, a piece elsewhere: said plainly', () => {
  const r = ask(indexOf(CARO), 'e4 c6 d4 d5 exd5 cxd5 Be2 Nc6 c3 Nf6');
  assert.equal(r[0].tier, 'pawns');
  assert.equal(r[0].cost, 0.5);
  assert.equal(r[0].after, 'after 5…Nf6');
  assert.deepEqual(r[0].diffs.map(describeDiff), ['White’s bishop is on e2 (the line has it on d3, one move away)']);
  assert.equal(r[0].next[0].san, 'Bf4');
  assert.equal(r[0].next[0].legal, true);
});

test('one pawn not yet pushed is close; one pushed further is no match', () => {
  const r = ask(indexOf(CARO), 'e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 Nf3 Nf6');
  const exch = r.find((s) => s.variation.name === 'Exchange');
  assert.ok(exch, 'the Exchange is offered');
  assert.equal(exch.tier, 'pawn');
  assert.ok(exch.diffs.map(describeDiff).includes('White’s c-pawn is still on c2 (the line has it on c3)'));
  // c4 instead of c3: the Panov, another opening.
  const panov = ask(indexOf(CARO), 'e4 c6 d4 d5 exd5 cxd5 c4 Nc6 Bd3 Nf6');
  assert.ok(!panov.some((s) => s.variation.name === 'Exchange' && s.tier !== 'same'), 'a pawn pushed past the line is no match');
});

test('a piece out at home in the line: the line is behind the board, and it costs a full point', () => {
  const here = { board: new Chess('rnbqkbnr/pp2pppp/8/3p4/3P4/2N5/PPP2PPP/R1BQKBNR b KQkq - 1 4').board().flat().map((p) => (p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : null)), turn: 'b' };
  const line2 = { board: new Chess('rnbqkbnr/pp2pppp/8/3p4/3P4/8/PPP2PPP/RNBQKBNR b KQkq - 0 3').board().flat().map((p) => (p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : null)), turn: 'b' };
  const c = compare(here, line2);
  assert.equal(c.cost, 1);
  assert.equal(describeDiff(c.diffs[0]), 'White’s knight is already on c3 (still on b1 in the line)');
});

test('castling is one difference; so is the other side to move', () => {
  const r = ask(indexOf(CARO), 'e4 c6 d4 d5 exd5 cxd5 Nf3 Nc6 Bb5 Nf6 Kf1 Bg4');
  const s = r.find((x) => x.variation.name === 'Exchange 4.Nf3');
  // Kf1 isn't castling: a king and no rook, so not merged.
  assert.ok(s === undefined || s.diffs.every((d) => d.kind !== 'castle'));
  // Qe2 rather than castling: a pawn move (h3) would be another structure.
  const r2 = ask(indexOf(CARO), 'e4 c6 d4 d5 exd5 cxd5 Nf3 Nc6 Bb5 Nf6 Qe2 Bg4');
  const s2 = r2.find((x) => x.variation.name === 'Exchange 4.Nf3');
  assert.ok(s2, 'offered');
  const text = s2.diffs.map(describeDiff);
  assert.ok(text.includes('White hasn’t castled yet here (the line castles short)'), text.join(' | '));
});

test('nothing looser: other material, too many differences, too early', () => {
  const idx = indexOf(CARO);
  assert.deepEqual(ask(idx, 'e4 c6 d4 d5 exd5 cxd5 Bd3 Nc6 c3 Nf6 Bxh7 Rxh7'), [], 'a piece traded off');
  assert.deepEqual(ask(idx, 'e4 c6 d4 d5 exd5 cxd5 Na3 Na6 Nb5 Nb4 Ne2 Nf6'), [], 'too far from any line');
  // Two moves in, nothing is "like" anything: only the exact kinds.
  assert.deepEqual(ask(idx, 'e4 e6').filter((s) => s.tier !== 'same' && s.tier !== 'move'), []);
});

test('each suggestion from a line of its own, and the side being played first', () => {
  const idx = indexOf(CARO, LONDON);
  const r = ask(idx, 'e4 c6 d4 d5 exd5 cxd5 Be2 Nc6 c3 Nf6');
  const lines = r.map((s) => s.variation.name);
  assert.equal(new Set(lines).size, lines.length, 'no line twice');
  // A position that's in both: a London from Black's side is a Slav from White's.
  const both = buildSimilarIndex(buildPositionIndex([
    opening('A', 'white', [line('a', 'd4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6')]),
    opening('B', 'black', [line('b', 'd4 d5 Nf3 Nf6 Bf4 e6 e3 Bd6')]),
  ]));
  const { fen, ply } = at('d4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6');
  assert.equal(similarOpenings(both, fen, { gamePly: ply, side: 'black' })[0].opening.name, 'B');
  assert.equal(similarOpenings(both, fen, { gamePly: ply, side: 'white' })[0].opening.name, 'A');
});

test('side by side: the squares that differ', () => {
  const r = ask(indexOf(CARO), 'e4 c6 d4 d5 exd5 cxd5 Be2 Nc6 c3 Nf6');
  assert.deepEqual(differingSquares(at('e4 c6 d4 d5 exd5 cxd5 Be2 Nc6 c3 Nf6').fen, r[0].fen).sort(), ['d3', 'e2']);
});

test('where a line is: the move that reached it', () => {
  const v = line('x', 'e4 c6 d4 d5');
  assert.equal(afterLabel(v, 0), 'at the start');
  assert.equal(afterLabel(v, 3), 'after 2.d4');
  assert.equal(afterLabel(v, 4), 'after 2…d5');
});

// The Stockfish check (lib/gameReview's checkMoves), against a stand-in
// engine that knows a few positions' scores (White's side, centipawns).
test('the check: each next move graded as the review grades a move', async () => {
  const { checkMoves, gradeLoss } = await import('../src/lib/gameReview.js');
  const SCORES = new Map();
  const fenAfter = (moves) => { const c = new Chess(); moves.forEach((m) => c.move(m)); return c.fen(); };
  const start = fenAfter(['e4', 'c6']);
  SCORES.set(start, 35); // the position itself: its best move's score
  SCORES.set(fenAfter(['e4', 'c6', 'd4']), 30); // 0.05 down: best
  SCORES.set(fenAfter(['e4', 'c6', 'a3']), -20); // 0.55 down: good
  SCORES.set(fenAfter(['e4', 'c6', 'Qh5']), -150); // 1.85 down: a mistake
  const listeners = new Set();
  const engine = {
    onInfo: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    analyze: (fen, { depth }) => {
      const white = fen.split(' ')[1] === 'w';
      const value = SCORES.get(fen) ?? 0;
      // As lib/engine reports it: White's side, whoever is to move.
      setTimeout(() => listeners.forEach((cb) => cb({
        fen, depth, multipv: 1, score: { type: 'cp', value }, sans: [], white,
      })), 0);
    },
  };
  const r = await checkMoves(engine, start, ['d4', 'a3', 'Qh5', 'Ke3']);
  assert.deepEqual(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.grade])), { d4: 'best', a3: 'good', Qh5: 'mistake' });
  assert.equal(r.Qh5.loss, 185);
  assert.equal(r.Ke3, undefined, 'an illegal move is left out');
  assert.deepEqual([10, 30, 60, 100, 300, 301].map(gradeLoss), ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']);
});
