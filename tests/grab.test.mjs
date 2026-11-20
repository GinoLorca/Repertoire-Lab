// Picking a piece up: which press lifts a piece, and when a drop the board
// library threw away is played after all (lib/grab).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';

const {
  pieceAt, sideToMove, liftable, movable, ownPiece, defaultPromotionCheck, lateDrop, takenSquare, dropSquare,
} = await import('../src/lib/grab.js');

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MIDDLE = 'r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2QK2R b KQ - 4 8';

test('the piece on a square, as the board shows it', () => {
  // Every square of several positions, against chess.js.
  for (const fen of [START, MIDDLE, '8/P6k/8/8/8/8/6Kp/8 w - - 0 1', '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1']) {
    const chess = new Chess(fen);
    for (const f of 'abcdefgh') {
      for (const r of '12345678') {
        const sq = `${f}${r}`;
        const p = chess.get(sq);
        assert.equal(pieceAt(fen, sq), p ? `${p.color}${p.type.toUpperCase()}` : null, `${sq} in ${fen}`);
      }
    }
  }
  assert.equal(pieceAt('start', 'e2'), 'wP');
  assert.equal(pieceAt('start', 'e8'), 'bK');
  assert.equal(pieceAt('start', 'e4'), null);
  assert.equal(pieceAt(START.split(' ')[0], 'g1'), 'wN', 'a bare placement');
  assert.equal(pieceAt({ e4: 'wP', g8: 'bN' }, 'e4'), 'wP', 'the board library’s own object');
  assert.equal(pieceAt({ e4: 'wP' }, 'e5'), null);
  for (const bad of [null, undefined, '', 'nonsense', 42, '8/8/8 w - -']) assert.equal(pieceAt(bad, 'e4'), null);
  for (const bad of ['', 'z9', 'e', 'e44', null, undefined, 4]) assert.equal(pieceAt(START, bad), null);
});

test('whose move it is', () => {
  assert.equal(sideToMove(START), 'w');
  assert.equal(sideToMove(MIDDLE), 'b');
  assert.equal(sideToMove('start'), 'w');
  for (const bad of [null, undefined, '', '8/8/8/8/8/8/8/8', { e4: 'wP' }]) assert.equal(sideToMove(bad), null);
});

test('a press lifts a piece when there is one the board lets go', () => {
  assert.equal(liftable('e2', { position: START }), true);
  assert.equal(liftable('e4', { position: START }), false, 'an empty square');
  assert.equal(liftable('e2', { position: START, draggable: false }), false, 'a board whose pieces don’t move');
  assert.equal(liftable('e2', { position: START, draggable: undefined }), true, 'not said: they do');
  // Learn and Practice: your own side's.
  const mine = ({ piece }) => ownPiece(piece, true);
  assert.equal(liftable('e2', { position: START, isDraggablePiece: mine }), true);
  assert.equal(liftable('e7', { position: START, isDraggablePiece: mine }), false, 'the other side’s: a hold there still draws');
  const theirs = ({ piece }) => ownPiece(piece, false);
  assert.equal(liftable('e7', { position: START, isDraggablePiece: theirs }), true);
  // The board's question is asked with the piece and its square, as react-chessboard asks it.
  let asked = null;
  liftable('g1', { position: START, isDraggablePiece: (q) => { asked = q; return true; } });
  assert.deepEqual(asked, { piece: 'wN', sourceSquare: 'g1' });
  assert.equal(liftable('g1', { position: START, isDraggablePiece: () => { throw new Error('no'); } }), false);
  assert.equal(liftable('g1'), false);
  assert.equal(ownPiece('wQ', true), true);
  assert.equal(ownPiece('bQ', true), false);
  assert.equal(ownPiece('bQ', false), true);
  assert.equal(ownPiece(undefined, true), false);
});

test('the analysis board with holding a piece to draw off: the side to move’s pieces lift', () => {
  assert.equal(movable(START, 'e2'), true);
  assert.equal(movable(START, 'e7'), false, 'not their move: a hold there draws');
  assert.equal(movable(START, 'e4'), false, 'nothing there');
  assert.equal(movable(MIDDLE, 'e7'), true);
  assert.equal(movable(MIDDLE, 'd3'), false);
  assert.equal(movable('start', 'g1'), true);
  assert.equal(movable(null, 'g1'), false);
});

test('a drop the board threw away is played after all — and only that', () => {
  const let_go = { released: true };
  assert.deepEqual(lateDrop({ from: 'g1', to: 'f3', piece: 'wN', ...let_go }), { from: 'g1', to: 'f3', piece: 'wN' });
  assert.equal(lateDrop({ from: 'g1', to: 'f3', piece: 'wN', asked: true, ...let_go }), null, 'the board was asked: its answer stands');
  assert.equal(lateDrop({ from: 'g1', to: 'g1', piece: 'wN', ...let_go }), null, 'put back where it was');
  assert.equal(lateDrop({ from: 'g1', to: null, piece: 'wN', ...let_go }), null, 'let go off the board');
  assert.equal(lateDrop({ from: 'g1', to: 'f3', ...let_go }), null);
  assert.equal(lateDrop({ from: 'g1', to: 'f3', piece: 'wN', premoves: true, ...let_go }), null, 'a board keeping premoves has it');
  assert.equal(lateDrop(), null);
  // A drag called off — Escape, a touch the system took back — ends over
  // whatever square the pointer was on: that's not a move.
  assert.equal(lateDrop({ from: 'g1', to: 'f3', piece: 'wN' }), null, 'nobody saw it let go');
  assert.equal(lateDrop({ from: 'g1', to: 'f3', piece: 'wN', released: false }), null);
  // Only ever between two squares of a board: not a spare piece from a tray, nor anything else.
  assert.equal(lateDrop({ from: 'spare', to: 'f3', piece: 'wN', ...let_go }), null);
  assert.equal(lateDrop({ from: 'g1', to: 'f9', piece: 'wN', ...let_go }), null);
  assert.equal(lateDrop({ from: 'g1', to: 'F3', piece: 'wN', ...let_go }), null);
  // A pawn to the last rank belongs to the board's promotion dialog — unless the board asks no such question.
  assert.equal(lateDrop({ from: 'e7', to: 'e8', piece: 'wP', ...let_go }), null);
  assert.equal(lateDrop({ from: 'e7', to: 'd8', piece: 'wP', ...let_go }), null);
  assert.deepEqual(lateDrop({ from: 'e7', to: 'e8', piece: 'wP', promotes: () => false, ...let_go }), { from: 'e7', to: 'e8', piece: 'wP' },
    'Learn, Practice and the analysis board choose the piece themselves');
  assert.deepEqual(lateDrop({ from: 'e7', to: 'e8', piece: 'wR', ...let_go }), { from: 'e7', to: 'e8', piece: 'wR' });
  assert.deepEqual(lateDrop({ from: 'e7', to: 'e8', piece: 'wP', promotes: () => { throw new Error('x'); }, ...let_go }), { from: 'e7', to: 'e8', piece: 'wP' });
  assert.equal(defaultPromotionCheck('e7', 'e8', 'wP'), true);
  assert.equal(defaultPromotionCheck('e2', 'e1', 'bP'), true);
  assert.equal(defaultPromotionCheck('e2', 'd1', 'bP'), true);
  assert.equal(defaultPromotionCheck('e7', 'g8', 'wP'), false);
  assert.equal(defaultPromotionCheck('e6', 'e7', 'wP'), false);
  assert.equal(defaultPromotionCheck('e7', 'e8', 'wQ'), false);
});

test('the piece a move takes: the one piece of yours a reply puts out of reach', () => {
  // Bxf3: the knight on f3.
  const a = new Chess('rn1qkbnr/ppp1pppp/8/3p4/6b1/5N2/PPPPPPPP/RNBQKB1R b KQkq - 2 2');
  assert.equal(takenSquare(a.move('Bxf3')), 'f3');
  // En passant: the pawn taken isn't on the square the capture lands on.
  const b = new Chess('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3');
  const ep = b.move('dxe3');
  assert.equal(ep.to, 'e3');
  assert.equal(takenSquare(ep), 'e4');
  // Nothing taken.
  assert.equal(takenSquare(new Chess().move('e4')), null);
  assert.equal(takenSquare(new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1').move('O-O')), null);
  for (const bad of [null, undefined, {}, { captured: 'n' }, { captured: 'n', from: 'g4', to: 'zz' }]) assert.equal(takenSquare(bad), null);
});

test('the square a drop is for: where the piece was let go, not what was sliding over it', () => {
  // 3.Nxe4 let go on e4 as the pawn from d5 slides onto it: the library asks about d5 (the slider's own
  // square), and then about e4.
  assert.equal(dropSquare({ from: 'c3', asked: 'd5', released: 'e4' }), 'e4');
  assert.equal(dropSquare({ from: 'c3', asked: 'e4', released: 'e4' }), 'e4');
  // Put back where it came from, under something sliding past: not a move.
  assert.equal(dropSquare({ from: 'c3', asked: 'd5', released: 'c3' }), null);
  // Seen let go, but not over the board (or nowhere we can place): the library's word stands.
  assert.equal(dropSquare({ from: 'c3', asked: 'e4', released: null }), 'e4');
  // Not seen let go — another finger ended the drag. The carrying finger's last square picks the question…
  assert.equal(dropSquare({ from: 'c3', asked: 'd5', over: 'e4' }), null, 'not this one');
  assert.equal(dropSquare({ from: 'c3', asked: 'e4', over: 'e4' }), 'e4', 'this one');
  // …and never answers one that wasn't asked.
  assert.equal(dropSquare({ from: 'c3', asked: 'd5', over: null }), null);
  // Nothing known about the pointer: as the library asks.
  assert.equal(dropSquare({ from: 'c3', asked: 'e4' }), 'e4');
  assert.equal(dropSquare({ from: 'c3', asked: 'c3' }), null);
  assert.equal(dropSquare({ from: 'c3', asked: 'zz' }), null);
  assert.equal(dropSquare({ from: 'c3', asked: 'e4', released: 'nonsense' }), 'e4', 'a square that isn’t one is no square');
  assert.equal(dropSquare(), null);
});
