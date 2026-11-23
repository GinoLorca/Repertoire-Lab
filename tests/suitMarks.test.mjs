// Court Cards' suit marks — src/lib/suitMarks.js, from Chess Arcade: the suit
// each piece wears, the pick a view hands to Board and LegalDots, what Board
// adds to the squares' own styles, and the quiet pip's size and place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  SUIT_OF, SET_SUITS, suitOf, pieceCode, captureSquares, suitPick, isDarkSquare, hasCoordinate, suitSquareStyles, quietPip, PIP,
} from '../src/lib/suitMarks.js';

const QUEEN = '4k2r/ppp2pbp/1n6/3q4/r2Q4/8/PPP2PPP/R3KBNR w KQk - 0 1'; // Qd4 takes a queen, rook, bishop, knight
const PASSANT = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'; // exd6 en passant
const sorted = (a) => [...a].sort().join(' ');

test('the suit each piece wears: White hearts and diamonds, Black spades and clubs, both bishops the Joker\'s star, pawns their army\'s', () => {
  assert.deepEqual(SUIT_OF, {
    wK: 'heart', wQ: 'heart', wP: 'heart', wR: 'diamond', wN: 'diamond', wB: 'star',
    bK: 'spade', bQ: 'spade', bP: 'spade', bR: 'club', bN: 'club', bB: 'star',
  });
  assert.equal(suitOf('bN'), 'club');
  assert.equal(suitOf('xQ'), null);
  assert.equal(suitOf(null), null);
  // every suit has its drawing
  for (const s of new Set(Object.values(SUIT_OF))) assert.ok(PIP[s]?.startsWith('M10'), s);
});

test('the picked piece, read off the position: its code, or nothing', () => {
  const g = new Chess();
  assert.equal(pieceCode(g, 'd1'), 'wQ');
  assert.equal(pieceCode(g, 'g8'), 'bN');
  assert.equal(pieceCode(g, 'a7'), 'bP');
  assert.equal(pieceCode(g, 'e4'), null); // empty
  assert.equal(pieceCode(g, null), null);
  assert.equal(pieceCode(null, 'd1'), null);
  assert.equal(pieceCode(g, 'z9'), null); // not a square
});

test('the pick: the piece, its square and the squares it captures on', () => {
  const g = new Chess(QUEEN);
  const p = suitPick(g, 'd4');
  assert.equal(p.code, 'wQ');
  assert.equal(p.square, 'd4');
  assert.equal(sorted(p.caps), 'a4 b6 d5 g7');
  // legal moves not shown: the pick alone
  assert.deepEqual(suitPick(g, 'd4', { captures: false }), { code: 'wQ', square: 'd4', caps: [] });
  // a piece with nothing to take
  assert.deepEqual(suitPick(g, 'g1'), { code: 'wN', square: 'g1', caps: [] });
  // nothing picked, an empty square, no position: no pick
  assert.equal(suitPick(g, null), null);
  assert.equal(suitPick(g, 'e4'), null);
  assert.equal(suitPick(null, 'd4'), null);
});

test('en passant is a capture: its empty square is in the pick\'s captures, the push is not', () => {
  const g = new Chess(PASSANT);
  assert.deepEqual(captureSquares(g, 'e5'), ['d6']);
  assert.deepEqual(suitPick(g, 'e5').caps, ['d6']);
  const b = new Chess('4k3/8/8/8/3Pp3/8/8/4K3 b - d3 0 1');
  assert.deepEqual(suitPick(b, 'e4'), { code: 'bP', square: 'e4', caps: ['d3'] });
});

test('a capture that promotes is one square, not four', () => {
  const g = new Chess('r3k3/1P6/8/8/8/8/8/4K3 w q - 0 1');
  assert.deepEqual(captureSquares(g, 'b7'), ['a8']);
  assert.deepEqual(suitPick(g, 'b7').caps, ['a8']);
});

test('square colors as the board prints them: a1 a card back, h1 a face', () => {
  const dark = [];
  for (const f of 'abcdefgh') for (const r of '12345678') if (isDarkSquare(f + r)) dark.push(f + r);
  assert.equal(dark.length, 32);
  for (const sq of ['a1', 'c1', 'b2', 'h8', 'd4', 'e5']) assert.ok(isDarkSquare(sq), sq);
  for (const sq of ['h1', 'a8', 'b1', 'd5', 'e4', 'g8']) assert.ok(!isDarkSquare(sq), sq);
});

test('the board\'s coordinates: the a-file and rank 1 for White, the h-file and rank 8 flipped', () => {
  for (const sq of ['a1', 'a4', 'a8', 'b1', 'h1']) assert.ok(hasCoordinate(sq, 'white'), sq);
  for (const sq of ['h8', 'h5', 'h1', 'a8', 'g8']) assert.ok(hasCoordinate(sq, 'black'), sq);
  for (const sq of ['b2', 'h4', 'g7', 'd5']) assert.ok(!hasCoordinate(sq, 'white'), sq);
  for (const sq of ['a4', 'b1', 'g7', 'd5']) assert.ok(!hasCoordinate(sq, 'black'), sq);
});

test('what a pick adds to the squares\' own styles: the suit on its square, the corners on its captures', () => {
  const g = new Chess(QUEEN);
  const s = suitSquareStyles(suitPick(g, 'd4'));
  assert.deepEqual(Object.keys(s).sort(), ['a4', 'b6', 'd4', 'd5', 'g7']);
  assert.deepEqual(s.d4, { '--shl-em': 'var(--shl-eb-heart)' }); // d4: a card back
  assert.deepEqual(s.d5, { '--shl-c': 'var(--shl-c-heart)', '--shl-d': 'var(--shl-d-heart)' });
  assert.deepEqual(s.g7, s.d5);
  // a4 carries the 4: its corners on the other diagonal
  assert.deepEqual(s.a4, { '--shl-c': 'var(--shl-c-heart)', '--shl-d': 'var(--shl-d-heart)', '--shl-alt': '1' });
  // Black's queen on a face (d5), spades
  const b = suitSquareStyles(suitPick(new Chess(QUEEN.replace(' w ', ' b ')), 'd5'), { orientation: 'black' });
  assert.deepEqual(b.d5, { '--shl-em': 'var(--shl-ef-spade)' });
  assert.equal(b.d4['--shl-c'], 'var(--shl-c-spade)');
  // the bishops: the Joker's star in its army's ink at the corners, one emblem for both
  const wb = suitSquareStyles(suitPick(new Chess('4k3/8/2n3r1/8/4B3/8/8/4K3 w - - 0 1'), 'e4'));
  assert.deepEqual(wb.e4, { '--shl-em': 'var(--shl-ef-star)' });
  assert.equal(wb.c6['--shl-c'], 'var(--shl-c-starw)');
  const bb = suitSquareStyles(suitPick(new Chess('4k3/8/8/4b3/8/2N3R1/8/4K3 b - - 0 1'), 'e5'));
  assert.deepEqual(bb.e5, { '--shl-em': 'var(--shl-eb-star)' });
  assert.equal(bb.g3['--shl-d'], 'var(--shl-d-starb)');
  // nothing picked: nothing added
  assert.deepEqual(suitSquareStyles(null), {});
  assert.deepEqual(suitSquareStyles({ code: 'xQ', square: 'd4', caps: [] }), {});
});

test('a capture on a coordinate square: the other diagonal, flipped boards too, and no top right pip under a badge', () => {
  // flipped: h5 carries the 5
  const flip = suitSquareStyles({ code: 'bQ', square: 'd5', caps: ['h5', 'd4'] }, { orientation: 'black' });
  assert.equal(flip.h5['--shl-alt'], '1');
  assert.equal(flip.d4['--shl-alt'], undefined);
  // the same square on an upright board carries nothing
  assert.equal(suitSquareStyles({ code: 'bQ', square: 'd5', caps: ['h5'] }).h5['--shl-alt'], undefined);
  // no coordinates printed: no square moves its corners
  assert.equal(suitSquareStyles({ code: 'wQ', square: 'd4', caps: ['a4'] }, { notation: false }).a4['--shl-alt'], undefined);
  // the last move's badge on a5 (the a-file's 5): the top right pip is left out, the bottom left one stays
  const badged = suitSquareStyles({ code: 'wP', square: 'b4', caps: ['a5', 'c5'] }, { badge: 'a5' });
  assert.deepEqual(badged.a5, { '--shl-c': 'none', '--shl-d': 'var(--shl-d-heart)', '--shl-alt': '1' });
  // a badge on a square with no coordinate: top left and bottom right, clear of the badge's top right corner
  const clear = suitSquareStyles({ code: 'wP', square: 'b4', caps: ['a5', 'c5'] }, { badge: 'c5' });
  assert.deepEqual(clear.c5, { '--shl-c': 'var(--shl-c-heart)', '--shl-d': 'var(--shl-d-heart)' });
  // flipped, a badge on h5
  const fb = suitSquareStyles({ code: 'bN', square: 'f6', caps: ['h5'] }, { orientation: 'black', badge: 'h5' });
  assert.deepEqual(fb.h5, { '--shl-c': 'none', '--shl-d': 'var(--shl-d-club)', '--shl-alt': '1' });
});

test('the quiet pip: 34% of the square from 11 to 30 px, centered, the halo and the star\'s outline as Chess Arcade draws them', () => {
  const at = (p) => {
    const m = p.transform.match(/^translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)$/);
    return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
  };
  // the box: the 20-unit pip plus its halo (2.6 round it; 3.65 for the star)
  const box = (p, pad) => at(p).k * (20 + 2 * pad);
  const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
  near(box(quietPip('heart', 86, 0, 0), 2.6), 0.34 * 86);
  near(box(quietPip('heart', 100, 0, 0), 2.6), 30); // capped
  near(box(quietPip('heart', 20, 0, 0), 2.6), 11); // a floor on a small phone square
  near(box(quietPip('star', 60, 0, 0), 3.65), 0.34 * 60);
  // the pip's own center (10, 10) lands on the square's center
  for (const suit of ['heart', 'diamond', 'spade', 'club', 'star']) {
    const p = quietPip(suit, 72, 300, 108);
    const t = at(p);
    near(t.x + 10 * t.k, 300);
    near(t.y + 10 * t.k, 108);
    assert.equal(p.d, PIP[suit]);
  }
  assert.equal(quietPip('heart', 72, 0, 0).halo, 4.8);
  assert.equal(quietPip('star', 72, 0, 0).halo, 6.9);
  assert.equal(quietPip('star', 72, 0, 0).star, true);
  assert.equal(quietPip('club', 72, 0, 0).star, false);
  assert.equal(quietPip('cup', 72, 0, 0), null);
});

test('the Card Crown set prints its own suits on Court Cards: White Q R N the narrow diamond, Black Q clubs, the rest the deck\'s', () => {
  assert.deepEqual(SET_SUITS, { cardCrown: { wQ: 'kdiamond', wR: 'kdiamond', wN: 'kdiamond', bQ: 'club' } });
  const crown = Object.fromEntries(Object.keys(SUIT_OF).map((c) => [c, suitOf(c, 'cardCrown')]));
  assert.deepEqual(crown, {
    wK: 'heart', wQ: 'kdiamond', wP: 'heart', wR: 'kdiamond', wN: 'kdiamond', wB: 'star',
    bK: 'spade', bQ: 'club', bP: 'spade', bR: 'club', bN: 'club', bB: 'star',
  });
  // every other set, and none, wears the Court Cards set's suits; a set name that isn't one changes nothing
  for (const set of [null, undefined, 'default', 'courtCards', 'minimalOne', 'constructor', '__proto__', 5]) {
    for (const c of Object.keys(SUIT_OF)) assert.equal(suitOf(c, set), SUIT_OF[c], `${c} ${set}`);
  }
  assert.equal(suitOf('constructor'), null);
  assert.equal(suitOf('toString', 'cardCrown'), null);
  // the narrow diamond has its drawing (Chess Arcade's gen_suithl.py PIP.kdiamond)
  assert.equal(PIP.kdiamond, 'M10 0L16.3 10 10 20 3.7 10z');
});

test('a pick carries its set when given: the emblem, the corners and the pip take its suits', () => {
  const g = new Chess(QUEEN);
  const p = suitPick(g, 'd4', { set: 'cardCrown' });
  assert.deepEqual(p, { code: 'wQ', square: 'd4', caps: p.caps, set: 'cardCrown' });
  const s = suitSquareStyles(p);
  assert.deepEqual(s.d4, { '--shl-em': 'var(--shl-eb-kdiamond)' });
  assert.deepEqual(s.d5, { '--shl-c': 'var(--shl-c-kdiamond)', '--shl-d': 'var(--shl-d-kdiamond)' });
  assert.deepEqual(s.a4, { '--shl-c': 'var(--shl-c-kdiamond)', '--shl-d': 'var(--shl-d-kdiamond)', '--shl-alt': '1' });
  // Black's queen: clubs, on a face (d5)
  const b = suitSquareStyles(suitPick(new Chess(QUEEN.replace(' w ', ' b ')), 'd5', { set: 'cardCrown' }));
  assert.deepEqual(b.d5, { '--shl-em': 'var(--shl-ef-club)' });
  assert.equal(b.d4['--shl-c'], 'var(--shl-c-club)');
  // a rook and a knight: the diamond too; the king: the deck's heart
  const r = suitSquareStyles(suitPick(new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), 'a1', { set: 'cardCrown' }));
  assert.deepEqual(r.a1, { '--shl-em': 'var(--shl-eb-kdiamond)' });
  const n = suitSquareStyles(suitPick(new Chess(), 'g1', { set: 'cardCrown' }));
  assert.deepEqual(n.g1, { '--shl-em': 'var(--shl-eb-kdiamond)' });
  const k = suitSquareStyles(suitPick(new Chess(), 'e1', { set: 'cardCrown' }));
  assert.deepEqual(k.e1, { '--shl-em': 'var(--shl-eb-heart)' });
  // without a set (or the Court Cards set) the pick is as it was
  assert.deepEqual(suitPick(g, 'd4', { captures: false, set: null }), { code: 'wQ', square: 'd4', caps: [] });
  assert.deepEqual(suitSquareStyles(suitPick(g, 'd4', { set: 'courtCards' })).d4, { '--shl-em': 'var(--shl-eb-heart)' });
  // the narrow diamond's quiet pip: its own drawing, the same box as every suit
  const qp = quietPip('kdiamond', 72, 300, 108);
  assert.equal(qp.d, PIP.kdiamond);
  assert.equal(qp.star, false);
  assert.equal(qp.halo, 4.8);
});

test('the stylesheet has every token a pick can name, Card Crown\'s narrow diamond included', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const suits = new Set([...Object.values(SUIT_OF), ...Object.values(SET_SUITS).flatMap((m) => Object.values(m))]);
  for (const suit of suits) {
    for (const k of ['ef', 'eb']) assert.match(css, new RegExp(`--shl-${k}-${suit}: url\\("data:image/svg\\+xml,`), `--shl-${k}-${suit}`);
    for (const pip of suit === 'star' ? ['starw', 'starb'] : [suit]) {
      assert.match(css, new RegExp(`--shl-c-${pip}: url\\("data:image/svg\\+xml,`), `--shl-c-${pip}`);
      assert.match(css, new RegExp(`--shl-d-${pip}: (url\\("data:image/svg\\+xml,|var\\(--shl-c-${pip}\\))`), `--shl-d-${pip}`);
    }
  }
  // the narrow diamond drawn in court red, as Chess Arcade's (its corner pip is Chess Arcade's own token, byte for byte)
  assert.match(css.match(/--shl-c-kdiamond: url\("([^"]+)"\)/)[1], /M10 0L16\.3 10 10 20 3\.7 10z' fill='%23b3192e'/);
});
