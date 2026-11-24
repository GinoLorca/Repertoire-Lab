// Piece styles — src/lib/pieceStyles.js: which of Chess Arcade's sets a board
// draws on each theme, the pick kept per theme, the colors a theme gives every
// set, and the numbers behind drawing them in Repertoire Lab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RL_PIECE_STYLES, PIECE_STYLE_ORDER, PIECE_STYLE_LABELS, PIECE_STYLE_HINTS, PIECE_TOKEN_NAMES, PIECE_THEMES,
  isPieceStyle, themePieceStyle, pieceStyleOf, withPieceStyle, drawingOf, drawnByTrees, pieceTokens, rimCream,
  literalColor, parseColor, PIECE_FIT, PIECE_FIT_MODE, FIT_BASE, fitViewBox, THEME_DRAWING_FILTERS, parseFilter, filterColor,
} from '../src/lib/pieceStyles.js';
import { PIECE_ART } from '../src/lib/pieceArt.gen.js';
import { cssRules, declarations } from '../scripts/lib/arcadePieces.mjs';
import { SKIN_ORDER } from '../src/lib/skins.js';

const OWN = {
  felt: 'default', hustler: 'wavyCoach', bauhaus: 'bauhausOriginal', gameboy: 'minimalOne', outerspace: 'default',
  drivethru: 'rimLight', rose: 'royalMinimal', chessbook: 'default', uptown: 'default', cards: 'courtCards', custom: 'default',
};

test('each theme’s own set, as Chess Arcade’s (Game Boy: Minimal Chess ONE)', () => {
  assert.deepEqual(PIECE_THEMES, [...SKIN_ORDER, 'custom']);
  for (const [skin, set] of Object.entries(OWN)) {
    assert.equal(themePieceStyle(skin), set, skin);
    assert.equal(pieceStyleOf({ skin }), set, `${skin}, nothing picked`);
  }
  assert.equal(pieceStyleOf({}), 'default', 'no skin is Custom');
  assert.equal(pieceStyleOf({ skin: 'nope' }), 'default', 'an unknown theme is Custom');
  // a Chess Arcade default naming a set Repertoire Lab doesn't offer is the Default set
  assert.equal(themePieceStyle('gameboy', { gameboy: 'newSet' }), 'default');
  assert.equal(themePieceStyle('gameboy', { gameboy: 'constructor' }), 'default');
  assert.equal(themePieceStyle('constructor'), 'default');
  assert.equal(themePieceStyle('toString', {}), 'default');
});

test('the sets offered: Chess Arcade’s nine, its names and descriptions, in its order', () => {
  assert.deepEqual(PIECE_STYLE_ORDER, ['default', 'wavyCoach', 'rimLight', 'royalMinimal', 'courtCards', 'cardCrown', 'minimalOne', 'minimalTwo', 'bauhausOriginal']);
  assert.deepEqual(PIECE_STYLE_ORDER.map((k) => PIECE_STYLE_LABELS[k]), [
    'Default Chess Set', 'Wavy Coach Chess Set', 'Rim Light Chess Set', 'Royal Minimal Chess Set', 'Court Cards Chess Set',
    'Card Crown Chess Set', 'Minimal Chess ONE', 'Minimal Chess TWO', 'Bauhaus Original',
  ]);
  for (const k of PIECE_STYLE_ORDER) assert.ok(typeof PIECE_STYLE_HINTS[k] === 'string' && PIECE_STYLE_HINTS[k].length > 10, k);
  assert.deepEqual([...RL_PIECE_STYLES].sort(), [...PIECE_STYLE_ORDER].sort());
  for (const k of RL_PIECE_STYLES) assert.ok(isPieceStyle(k), k);
  for (const k of ['nope', 'constructor', '__proto__', 'toString', 'hasOwnProperty', '', null, undefined, 3, {}, ['default']]) {
    assert.equal(isPieceStyle(k), false, String(k));
  }
});

test('a pick is kept per theme; anything that isn’t a set falls back to the theme’s own', () => {
  const s = { skin: 'gameboy', pieceStyleBySkin: { gameboy: 'minimalTwo', felt: 'cardCrown' } };
  assert.equal(pieceStyleOf(s), 'minimalTwo');
  assert.equal(pieceStyleOf(s, 'felt'), 'cardCrown');
  assert.equal(pieceStyleOf(s, 'hustler'), 'wavyCoach', 'another theme: its own set');
  assert.equal(pieceStyleOf({ ...s, skin: 'felt' }), 'cardCrown');
  for (const bad of ['nope', 'constructor', '__proto__', 'toString', 7, null, { set: 'x' }]) {
    assert.equal(pieceStyleOf({ skin: 'gameboy', pieceStyleBySkin: { gameboy: bad } }), 'minimalOne', String(bad));
  }
  // a map that isn't one, or a theme that only exists on the prototype
  for (const map of [null, 'minimalTwo', ['minimalTwo'], 5]) assert.equal(pieceStyleOf({ skin: 'gameboy', pieceStyleBySkin: map }), 'minimalOne');
  assert.equal(pieceStyleOf({ skin: 'custom', pieceStyleBySkin: {} }, 'constructor'), 'default');
  const parsed = JSON.parse('{"skin":"gameboy","pieceStyleBySkin":{"__proto__":"minimalTwo"}}');
  assert.equal(pieceStyleOf(parsed), 'minimalOne');
});

test('picking: the whole new map, the theme’s own set clears its entry, nothing else changes', () => {
  const s = { skin: 'gameboy', pieceStyleBySkin: { felt: 'cardCrown', hustler: 'default', future: 'someSet' } };
  const frozen = JSON.stringify(s);
  assert.deepEqual(withPieceStyle(s, 'gameboy', 'minimalTwo'), { felt: 'cardCrown', hustler: 'default', future: 'someSet', gameboy: 'minimalTwo' });
  assert.deepEqual(withPieceStyle(s, 'felt', 'default'), { hustler: 'default', future: 'someSet' }, 'Felt’s own set: follow the theme');
  assert.deepEqual(withPieceStyle(s, 'hustler', 'wavyCoach'), { felt: 'cardCrown', future: 'someSet' }, 'Hustler’s own set');
  assert.deepEqual(withPieceStyle(s, 'rose', 'royalMinimal'), s.pieceStyleBySkin, 'its own set, nothing saved: nothing to clear');
  assert.deepEqual(withPieceStyle(s, 'custom', 'minimalOne').custom, 'minimalOne');
  for (const bad of ['nope', 'constructor', '__proto__', 4, null]) assert.deepEqual(withPieceStyle(s, 'gameboy', bad), s.pieceStyleBySkin, String(bad));
  for (const skin of ['nope', '__proto__', 'constructor', undefined]) assert.deepEqual(withPieceStyle(s, skin, 'minimalTwo'), s.pieceStyleBySkin, String(skin));
  assert.notEqual(withPieceStyle(s, 'gameboy', 'nope'), s.pieceStyleBySkin, 'always a copy');
  assert.equal(JSON.stringify(s), frozen, 'the settings passed in are never changed');
  assert.deepEqual(withPieceStyle({}, 'gameboy', 'minimalTwo'), { gameboy: 'minimalTwo' });
  assert.deepEqual(withPieceStyle({ pieceStyleBySkin: ['x'] }, 'gameboy', 'minimalTwo'), { gameboy: 'minimalTwo' });
  // what's picked reads back
  const after = { skin: 'gameboy', pieceStyleBySkin: withPieceStyle(s, 'gameboy', 'rimLight') };
  assert.equal(pieceStyleOf(after), 'rimLight');
  assert.equal(Object.getPrototypeOf(withPieceStyle(JSON.parse('{"pieceStyleBySkin":{"__proto__":{"x":1}}}'), 'gameboy', 'rimLight')), Object.prototype);
});

test('which drawings: Court Cards uses Default’s; both are drawn with RL’s own TREES', () => {
  assert.equal(drawingOf('courtCards'), 'default');
  assert.equal(drawingOf('minimalOne'), 'minimalOne');
  assert.equal(drawingOf('nope'), 'default');
  assert.equal(drawingOf('constructor'), 'default');
  assert.deepEqual(RL_PIECE_STYLES.filter(drawnByTrees), ['default', 'courtCards']);
  for (const set of RL_PIECE_STYLES.filter((k) => !drawnByTrees(k))) assert.ok(Object.hasOwn(PIECE_ART, set), set);
});

test('piece colors a theme gives every set, by day and at night', () => {
  const none = { '--pw-white-fill': null, '--pw-black-fill': null, '--pw-stroke': null };
  assert.deepEqual(Object.keys(none), PIECE_TOKEN_NAMES);
  assert.deepEqual(pieceTokens({ skin: 'drivethru' }, 'drivethru', 'light'), { '--pw-white-fill': '#ffc72c', '--pw-black-fill': '#5b2c8e', '--pw-stroke': '#3a1408' });
  assert.deepEqual(pieceTokens({ skin: 'drivethru' }, 'drivethru', 'dark'), { '--pw-white-fill': '#ffc72c', '--pw-black-fill': '#5b2c8e', '--pw-stroke': '#2a0e05' });
  assert.deepEqual(pieceTokens({}, 'rose', 'dark'), { '--pw-white-fill': '#fff8f3', '--pw-black-fill': '#4a1230', '--pw-stroke': '#3a0f24' });
  assert.deepEqual(pieceTokens({}, 'chessbook', 'dark'), pieceTokens({}, 'chessbook', 'light'), 'Chess Book: the same at night');
  assert.deepEqual(pieceTokens({}, 'uptown', 'light')['--pw-white-fill'], '#ffffff');
  assert.deepEqual(pieceTokens({}, 'cards', 'dark'), { '--pw-white-fill': '#f6f1e4', '--pw-black-fill': '#181923', '--pw-stroke': '#141520' });
  for (const skin of ['felt', 'hustler', 'bauhaus', 'gameboy', 'outerspace', 'constructor', 'nope']) {
    assert.deepEqual(pieceTokens({ skin }, skin, 'light'), none, skin);
  }
  // Custom: your White and Black; the outline stays each set's own
  assert.deepEqual(pieceTokens({ skin: 'custom', pieceLight: '#f0e0c0', pieceDark: '#102030' }, 'custom', 'dark'), { '--pw-white-fill': '#f0e0c0', '--pw-black-fill': '#102030', '--pw-stroke': null });
  assert.deepEqual(pieceTokens({ skin: 'custom', pieceLight: null, pieceDark: null }, 'custom'), none, 'Custom untouched: each set’s own colors');
  assert.deepEqual(pieceTokens({ pieceLight: 'red; background:url(x)', pieceDark: 'url(https://example.com/x)' }, 'custom'), none, 'only colors go inline');
  assert.deepEqual(pieceTokens({ skin: 'custom', pieceLight: 'rgb(1, 2, 3)' }), { ...none, '--pw-white-fill': 'rgb(1, 2, 3)' });
});

test('Rim Light’s cream, worked out as Chess Arcade does', () => {
  assert.equal(rimCream('#ffc72c'), 'rgb(244, 184, 37)');
  assert.equal(rimCream(null), 'rgb(244, 236, 214)');
  assert.equal(rimCream('#fff'), 'rgb(244, 236, 214)');
  assert.equal(rimCream('not a color'), 'rgb(244, 236, 214)');
  assert.deepEqual(parseColor('#ffc72c80'), [255, 199, 44, 128 / 255]);
  assert.deepEqual(parseColor('rgb(10 20 30 / 50%)'), [10, 20, 30, 0.5]);
  assert.equal(parseColor('var(--x)'), null);
});

test('a drawing’s colors made literal, for a picture CSS can’t reach', () => {
  const rose = pieceTokens({}, 'rose', 'light');
  assert.equal(literalColor('var(--pw-white-fill,#fff)', rose), '#fff8f3');
  assert.equal(literalColor('var(--pw-white-fill,#fff)', {}), '#fff', 'no theme color: the drawing’s own');
  assert.equal(literalColor('var(--pw-stroke, #3d3f3e)', pieceTokens({}, 'felt')), '#3d3f3e');
  assert.equal(literalColor('var(--pw-black-fill,#17171a)', rose), '#5a1e3d');
  assert.equal(literalColor('var(--pw-rim-white,#f4ecd6)', pieceTokens({}, 'drivethru', 'light')), 'rgb(244, 184, 37)');
  assert.equal(literalColor('var(--pw-rim-white,#f4ecd6)', {}), 'rgb(244, 236, 214)');
  assert.equal(literalColor('var(--crown-cream,#f2e6cb)', rose), '#f2e6cb', 'Card Crown’s own colors stay its own');
  assert.equal(literalColor('var(--crown-navy, var(--pw-stroke, #1f2f52))', {}), '#1f2f52');
  assert.equal(literalColor('var(--other)', rose), 'inherit');
  assert.equal(literalColor('url(#cc-lam-w) var(--pw-white-fill,#fbf7ec)', rose), 'url(#cc-lam-w) #fff8f3');
  assert.equal(literalColor('#123456', rose), '#123456');
  assert.equal(literalColor('none', rose), 'none');
  assert.equal(literalColor('var(--pw-white-fill,#fff)', { '--pw-white-fill': null }), '#fff');
  // Bauhaus Original's Black: its details and thin edge take a theme's detail color where a page gives one
  // (--pw-detail: Uptown's line colors, in CSS), else the theme's White, else the set's own cream
  assert.equal(literalColor('var(--pw-detail,var(--pw-white-fill,#fff4df))', rose), '#fff8f3');
  assert.equal(literalColor('var(--pw-detail,var(--pw-white-fill,#fff4df))', {}), '#fff4df');
  // every color in every drawing comes out literal
  const tokens = pieceTokens({}, 'drivethru', 'dark');
  for (const [set, codes] of Object.entries(PIECE_ART)) {
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      for (const v of Object.values(n.p?.style ?? {})) assert.doesNotMatch(literalColor(v, tokens), /var\(/, `${set}: ${v}`);
      if (n.c) walk(n.c);
    };
    Object.values(codes).forEach(walk);
  }
});

test('sizes: an art set fits RL’s square at its scale with its base on RL’s base line; TREES sets aren’t fitted', () => {
  // Q13 is decided by the user from screenshots: either answer is one line (PIECE_FIT_MODE), so what's
  // checked here names its answer, and the default follows the switch
  assert.ok(['rl', 'ca'].includes(PIECE_FIT_MODE), PIECE_FIT_MODE);
  assert.equal(fitViewBox('default'), null);
  assert.equal(fitViewBox('courtCards'), null);
  assert.equal(fitViewBox('nope'), null);
  for (const set of RL_PIECE_STYLES.filter((k) => !drawnByTrees(k))) {
    assert.ok(Object.hasOwn(PIECE_FIT, set), `${set} has a fit`);
    assert.equal(fitViewBox(set), fitViewBox(set, PIECE_FIT_MODE), `${set}: the switch's answer by default`);
    const [x0, y0, w, h] = fitViewBox(set, 'rl').split(' ').map(Number);
    assert.equal(w, h, `${set}: square`);
    assert.ok(Math.abs(w - 100 / PIECE_FIT[set].scale) < 0.01, `${set}: ${PIECE_FIT[set].scale} of the square`);
    assert.ok(Math.abs((x0 + w / 2) - 50) < 0.01, `${set}: centered across`);
    assert.ok(Math.abs((PIECE_FIT[set].base - y0) / w - FIT_BASE) < 0.001, `${set}: its base at ${FIT_BASE} of the square`);
    // the other answer to Q13: exactly Chess Arcade's 80%, centered
    assert.equal(fitViewBox(set, 'ca'), '-12.5 -12.5 125 125');
  }
  assert.equal(fitViewBox('minimalOne', 'rl'), '-6.82 -9.14 113.64 113.64', 'base 92 (measured) at .89 of a box 100 / .88 wide');
  assert.equal(fitViewBox('bauhausOriginal', 'rl'), '-6.82 -9.14 113.64 113.64', 'Bauhaus Original: the same fit (Black\'s edge on 92)');
  assert.equal(fitViewBox('wavyCoach', 'rl'), '-8.82 -4.66 117.65 117.65', 'Wavy Coach a little smaller: its king inside the square');
});

test('theme filters as numbers: a color through Game Boy’s, Hustler’s and Outer Space’s', () => {
  const gb = THEME_DRAWING_FILTERS.gameboy;
  // worked out apart from this code, from the Filter Effects matrices (clamped after each step)
  assert.equal(filterColor('#ffffff', gb), 'rgb(147, 198, 139)', 'white turns screen-green');
  assert.equal(filterColor('#f7f4e8', gb), 'rgb(112, 198, 99)');
  assert.equal(filterColor('#ffc72c', THEME_DRAWING_FILTERS.hustler), 'rgb(219, 215, 202)');
  assert.equal(filterColor('#111516', THEME_DRAWING_FILTERS.outerspace), 'rgb(9, 12, 10)');
  // black stays black under Game Boy's filter, as on the page (its contrast step clamps it)
  assert.equal(filterColor('#000000', gb), 'rgb(0, 0, 0)');
  assert.equal(filterColor('rgb(255, 255, 255)', gb), 'rgb(147, 198, 139)');
  assert.notEqual(filterColor('#ffffff', gb), 'rgb(255, 255, 255)');
  for (const v of ['none', 'url(#cc-lam-w)', 'currentColor', 'inherit']) assert.equal(filterColor(v, gb), v);
  assert.equal(filterColor('#123456', []), '#123456');
  assert.throws(() => filterColor('#fff', [['blur', 2]]), /no matrix for the blur filter/);
  assert.deepEqual(parseFilter('sepia(1) saturate(6) hue-rotate(45deg) brightness(0.75) contrast(1.1)'), gb);
  assert.deepEqual(parseFilter('grayscale(92%) hue-rotate(.5turn) drop-shadow(0 0 2px rgba(0, 0, 0, .5)) url(#f)'), [['grayscale', 0.92], ['hueRotate', 180]]);
  assert.deepEqual(parseFilter('none'), []);
});

test('THEME_DRAWING_FILTERS equals the drawing filters in src/styles.css', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const rules = cssRules(`<style>${css}</style>`);
  for (const [skin, steps] of Object.entries(THEME_DRAWING_FILTERS)) {
    // every filter on a piece's drawing in that theme (drop shadows left out) is that chain: on its boards
    // (data-skin) and on its card in Settings (data-pv)
    for (const attr of ['data-skin', 'data-pv']) {
      const chains = rules
        .filter((r) => r.selector.includes(`${attr}="${skin}"`) && /\[data-(piece|pc)\b/.test(r.selector))
        .flatMap((r) => declarations(r.body).filter(([n]) => n === 'filter').map(([, v]) => [r.selector, parseFilter(v)]))
        .filter(([, chain]) => chain.length);
      assert.ok(chains.length >= 1, `${skin}: no drawing filter on its pieces (${attr}) in styles.css`);
      for (const [selector, chain] of chains) assert.deepEqual(chain, steps, `${skin}: ${selector}`);
    }
  }
});
