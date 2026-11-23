// BoardArrows (src/components/BoardArrows.jsx), rendered: how see-through
// the arrows are. Every arrow Repertoire Lab draws on a board comes through
// it, each one a group at ARROW_OPACITY (.85 until 2026-11-22, then faded by
// ARROW_FADE to .55, Chess Arcade's arrow) with opaque parts inside, the
// halo among them, so an arrow's parts never darken one another.
//
// The component is JSX, which plain Node can't load: esbuild turns it into a
// module here, for this file only (as tests/legalDots.test.mjs does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const { transformSync } = createRequire(import.meta.resolve('vite/package.json'))('esbuild');
registerHooks({
  load(url, context, next) {
    if (!url.endsWith('.jsx')) return next(url, context);
    const { code } = transformSync(readFileSync(fileURLToPath(url), 'utf8'), { loader: 'jsx', format: 'esm', jsx: 'transform' });
    return { format: 'module', source: code, shortCircuit: true };
  },
});
const { default: BoardArrows, ARROW_FADE, ARROW_OPACITY } = await import('../src/components/BoardArrows.jsx');

const draw = (arrows, halo = false) => renderToStaticMarkup(React.createElement(BoardArrows, {
  arrows, boardWidth: 480, orientation: 'white', halo,
}));
const groups = (html) => html.match(/<g [^>]*>/g) ?? [];

test('the fade: .85 x .65, Chess Arcade\'s .55', () => {
  assert.equal(ARROW_FADE, 0.65);
  assert.equal(ARROW_OPACITY, 0.55);
});

test('each arrow is one group at that opacity, its parts opaque', () => {
  const arrows = [['e2', 'e4', '#2ecc71'], ['g1', 'f3', '#e5534b'], ['d1', 'h5', null]];
  for (const halo of [false, true]) {
    const html = draw(arrows, halo);
    const g = groups(html);
    assert.equal(g.length, arrows.length);
    for (const tag of g) assert.match(tag, /opacity="0\.55"/);
    // The only opacity anywhere is the groups': nothing inside adds its own.
    assert.equal((html.match(/opacity=/g) ?? []).length, arrows.length);
    assert.doesNotMatch(html, /opacity="0\.85"|stroke-opacity|fill-opacity/);
    // The halo is drawn inside its arrow's group, so it fades with it.
    if (halo) {
      for (const part of html.split('<g ').slice(1)) {
        assert.match(part.split('</g>')[0], /stroke="rgba\(0, 0, 0, 0\.45\)"/);
      }
    }
  }
});

test('the engine\'s colours keep their own alpha, under the same group', () => {
  const html = draw([['e2', 'e4', 'rgba(56, 176, 120, 0.92)'], ['d2', 'd4', 'rgba(59, 132, 235, 0.85)']]);
  assert.equal(groups(html).length, 2);
  for (const tag of groups(html)) assert.match(tag, /opacity="0\.55"/);
  assert.match(html, /stroke="rgba\(56, 176, 120, 0\.92\)"/);
  assert.match(html, /fill="rgba\(59, 132, 235, 0\.85\)"/);
});

test('nothing to draw: nothing drawn', () => {
  assert.equal(draw([]), '');
  assert.equal(draw([['e4', 'e4', '#2ecc71']]).includes('<g '), false);
});
