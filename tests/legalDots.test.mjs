// LegalDots (src/components/LegalDots.jsx), rendered: without a Court Cards
// pick (every other theme) exactly what it has always drawn, its dots and
// rings; with one, the pips of the picked piece's suit on its quiet moves
// instead, and nothing on its captures (their corners are on the squares).
//
// The component is JSX, which plain Node can't load: esbuild turns it into a
// module here, for this file only. It's Vite's own esbuild, found from Vite's
// package (a declared dependency), wherever npm puts it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Chess } from 'chess.js';
import { squareCell } from '../src/lib/legalMoves.js';
import { PIP, suitPick } from '../src/lib/suitMarks.js';

const { transformSync } = createRequire(import.meta.resolve('vite/package.json'))('esbuild');
registerHooks({
  load(url, context, next) {
    if (!url.endsWith('.jsx')) return next(url, context);
    const { code } = transformSync(readFileSync(fileURLToPath(url), 'utf8'), { loader: 'jsx', format: 'esm', jsx: 'transform' });
    return { format: 'module', source: code, shortCircuit: true };
  },
});
const { default: LegalDots } = await import('../src/components/LegalDots.jsx');

const QUEEN = '4k2r/ppp2pbp/1n6/3q4/r2Q4/8/PPP2PPP/R3KBNR w KQk - 0 1';
const draw = (fen, square, boardWidth = 480, orientation = 'white', suited = false) => {
  const game = new Chess(fen);
  return renderToStaticMarkup(React.createElement(LegalDots, {
    game, square, boardWidth, orientation, suitPick: suited ? suitPick(game, square) : null,
  }));
};
const suited = (fen, square, boardWidth = 480, orientation = 'white') => draw(fen, square, boardWidth, orientation, true);
const circles = (html) => html.match(/<circle[^>]*\/?>(<\/circle>)?/g) ?? [];

// LegalDots as it drew before the suits (git 20cd5b1): the overlay, and one
// circle per destination, a ring round a capture, a dot on an empty square.
function drawnBefore(fen, square, boardWidth, orientation) {
  const g = new Chess(fen);
  const moves = [...new Map(g.moves({ square, verbose: true }).map((mv) => [mv.to, mv])).values()];
  const size = boardWidth / 8;
  return renderToStaticMarkup(React.createElement('svg', {
    width: boardWidth,
    height: boardWidth,
    viewBox: `0 0 ${boardWidth} ${boardWidth}`,
    style: { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11 },
  }, moves.map((mv) => {
    const c = squareCell(mv.to, orientation);
    const cx = (c.x + 0.5) * size;
    const cy = (c.y + 0.5) * size;
    return mv.captured
      ? React.createElement('circle', {
        key: mv.to, cx, cy, r: size * 0.42, fill: 'none', strokeWidth: size * 0.11, style: { stroke: 'var(--legal-ring, rgba(20, 23, 29, 0.32))' },
      })
      : React.createElement('circle', {
        key: mv.to, cx, cy, r: size * 0.16, strokeWidth: size * 0.05, style: { fill: 'var(--legal-dot, rgba(20, 23, 29, 0.34))', stroke: 'var(--legal-dot-edge, none)' },
      });
  })));
}

test('without a Court Cards pick, byte for byte as before: a queen with captures, a black bishop on a flipped board, a promotion and en passant', () => {
  for (const [fen, sq, w, o] of [
    [QUEEN, 'd4', 480, 'white'],
    [QUEEN.replace(' w ', ' b '), 'd5', 362, 'black'],
    ['4k3/8/8/4b3/8/2N3R1/8/4K3 b - - 0 1', 'e5', 517.5, 'black'],
    ['r3k3/1P6/8/8/8/8/8/4K3 w q - 0 1', 'b7', 400, 'white'],
    ['4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5', 344, 'white'],
  ]) {
    const before = drawnBefore(fen, sq, w, o);
    assert.ok(circles(before).length > 1, `${fen} ${sq}`);
    assert.equal(draw(fen, sq, w, o), before, `${fen} ${sq}`);
  }
});

test('the Court Cards pips: one per quiet move in the piece\'s suit, no dots, nothing on a capture (its corners are on the square)', () => {
  const html = suited(QUEEN, 'd4', 480);
  assert.match(html, /^<svg class="legal-dots suited" width="480" height="480" viewBox="0 0 480 480" style="position:absolute;inset:0;pointer-events:none;z-index:11">/);
  const group = html.match(/<g class="ld-pips w">.*<\/g>/)?.[0] ?? '';
  const pips = group.match(/<g transform="[^"]+"><path class="ld-halo"[^>]*><\/path><path class="ld-ink"[^>]*><\/path><\/g>/g) ?? [];
  assert.equal(pips.length, 14); // 18 moves, 4 of them captures
  assert.equal(circles(html).length, 0);
  for (const p of pips) {
    assert.equal(p.match(/ d="([^"]+)"/g).length, 2);
    assert.ok(p.includes(`d="${PIP.heart}"`));
    assert.match(p, /class="ld-halo" d="[^"]+" stroke-width="4.8"/);
  }
  // Black's: spades, its army's class
  const b = suited(QUEEN.replace(' w ', ' b '), 'd5', 480);
  assert.match(b, /<g class="ld-pips b">/);
  assert.ok(b.includes(`d="${PIP.spade}"`) && !b.includes(`d="${PIP.heart}"`));
  // a bishop: the Joker's star, inked heavier
  const bishop = suited('4k3/8/2n3r1/8/4B3/8/8/4K3 w - - 0 1', 'e4', 480);
  assert.ok(bishop.includes(`class="ld-ink star" d="${PIP.star}"`));
  assert.match(bishop, /stroke-width="6.9"/);
});

test('a pip sits on its own square, flipped boards included', () => {
  const html = suited(QUEEN, 'd4', 400, 'black'); // 50 px squares
  const t = html.match(/<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)">/);
  const [x, y, k] = t.slice(1).map(Number);
  // the first quiet move chess.js lists for the queen
  const first = new Chess(QUEEN).moves({ square: 'd4', verbose: true }).find((mv) => !mv.captured).to;
  const c = squareCell(first, 'black');
  assert.ok(Math.abs(x + 10 * k - (c.x + 0.5) * 50) < 0.01);
  assert.ok(Math.abs(y + 10 * k - (c.y + 0.5) * 50) < 0.01);
});

test('a pick with only captures draws nothing here (its corners are on the squares)', () => {
  // the a7 pawn, blocked by the knight: its one move is axb8, promoting
  const fen = 'nr2k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  assert.equal(suited(fen, 'a7'), '');
  assert.equal(circles(draw(fen, 'a7')).length, 1);
});

test('nothing to draw: no moves, no square, no board', () => {
  assert.equal(draw('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'd4'), ''); // an empty square
  assert.equal(draw(QUEEN, 'e8'), ''); // not the side to move: chess.js lists nothing
  assert.equal(renderToStaticMarkup(React.createElement(LegalDots, { game: new Chess(), square: null, boardWidth: 400 })), '');
});

test('the Card Crown set on Court Cards: its own pips (White Q R N the narrow diamond, Black Q clubs), the rest the deck\'s; a press too', () => {
  const crown = (fen, square) => {
    const game = new Chess(fen);
    return renderToStaticMarkup(React.createElement(LegalDots, {
      game, square, boardWidth: 480, orientation: 'white', suitPick: suitPick(game, square, { set: 'cardCrown' }),
    }));
  };
  const wq = crown(QUEEN, 'd4');
  assert.ok(wq.includes(`d="${PIP.kdiamond}"`) && !wq.includes(`d="${PIP.heart}"`));
  assert.match(wq, /<g class="ld-pips w">/);
  const bq = crown(QUEEN.replace(' w ', ' b '), 'd5');
  assert.ok(bq.includes(`d="${PIP.club}"`) && !bq.includes(`d="${PIP.spade}"`));
  // the king keeps the deck's heart; the Court Cards set (or none) keeps the queen's
  assert.ok(crown('4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'e1').includes(`d="${PIP.heart}"`));
  const game = new Chess(QUEEN);
  const cc = renderToStaticMarkup(React.createElement(LegalDots, {
    game, square: 'd4', boardWidth: 480, orientation: 'white', suitPick: suitPick(game, 'd4', { set: 'courtCards' }),
  }));
  assert.ok(cc.includes(`d="${PIP.heart}"`) && !cc.includes(`d="${PIP.kdiamond}"`));
  // (a press before the view has a pick, the pieceSet prop, is the kit's: a server render never sees a press)
});
