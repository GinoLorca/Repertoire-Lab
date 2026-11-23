// The pieces as the boards draw them (src/lib/pieces.jsx, lib/theme.js): every
// set, the Default set exactly as before, the pictures (data URLs) of each,
// the look a board is handed (boardPieces), and what applySkin puts on <html>
// (data-pset, the theme's piece colors).
//
// pieces.jsx is JSX, which plain Node can't load: esbuild turns it into a
// module here, for this file only (as tests/legalDots.test.mjs does). It's
// Vite's own esbuild, found from Vite's package, wherever npm puts it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PIECE_ART, PIECE_TOKENS } from '../src/lib/pieceArt.gen.js';
import {
  RL_PIECE_STYLES, PIECE_TOKEN_NAMES, PIECE_THEMES, THEME_DRAWING_FILTERS, fitViewBox, drawnByTrees, literalColor,
  filterColor, rimCream, pieceStyleOf, pieceTokens, DEFAULT_SET_INKS,
} from '../src/lib/pieceStyles.js';
import { SKINS } from '../src/lib/skins.js';
import { boardPieces, boardColors, applySkin } from '../src/lib/theme.js';
import { svgToTree, treeToSvg } from '../scripts/lib/arcadePieces.mjs';

const { transformSync } = createRequire(import.meta.resolve('vite/package.json'))('esbuild');
registerHooks({
  load(url, context, next) {
    if (!url.endsWith('.jsx')) return next(url, context);
    const { code } = transformSync(readFileSync(fileURLToPath(url), 'utf8'), { loader: 'jsx', format: 'esm', jsx: 'transform' });
    return { format: 'module', source: code, shortCircuit: true };
  },
});
const { makePieces, piecesFor, pieceImage, DEFAULT_PIECE_LIGHT, DEFAULT_PIECE_DARK } = await import('../src/lib/pieces.jsx');

// What HEAD (61b3aa9, before any piece style) drew: makePieces' markup for all
// 12 pieces in Tournament Felt's inks at 60px, and pieceImage's data URLs.
const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/pieceRender.golden.json', import.meta.url), 'utf8'));
const CODES = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'];
const ART = RL_PIECE_STYLES.filter((s) => !drawnByTrees(s));
const draw = (pieces, code, squareWidth = 60) => renderToStaticMarkup(React.createElement(pieces[code], { squareWidth }));
// HEAD's markup with what this change adds and nothing else: the set's name on
// the span, and the drawing marked as decoration.
const asNow = (html, set) => html
  .replace(/^<span data-pc="(\w\w)"/, `<span data-pc="$1" data-ps="${set}"`)
  .replace('viewBox="0 0 45 45">', 'viewBox="0 0 45 45" aria-hidden="true" focusable="false">');
const svgOf = (url) => decodeURIComponent(url.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));

test('the Default set draws byte for byte as before (only data-ps and aria-hidden added)', () => {
  const [light, dark] = GOLDEN.inks;
  const pieces = makePieces(light, dark);
  for (const code of CODES) assert.equal(draw(pieces, code, GOLDEN.squareWidth), asNow(GOLDEN.pieces[code], 'default'), code);
  assert.equal(draw(makePieces(), 'wK'), asNow(GOLDEN.piecesDefaultInks.wK, 'default'), 'react-chessboard’s own inks');
  // …the same through piecesFor, and the Court Cards set is the same drawing, named
  const viaLook = piecesFor({ set: 'default', light, dark });
  const cards = piecesFor({ set: 'courtCards', light, dark });
  for (const code of CODES) {
    assert.equal(draw(viaLook, code), asNow(GOLDEN.pieces[code], 'default'), `piecesFor ${code}`);
    assert.equal(draw(cards, code), asNow(GOLDEN.pieces[code], 'courtCards'), `courtCards ${code}`);
  }
});

test('Chess Arcade’s sets: named, fitted, in their CSS colors, decoration only', () => {
  const wK = draw(makePieces('#123456', '#654321', 'minimalOne'), 'wK');
  assert.match(wK, /^<span data-pc="wK" data-ps="minimalOne" style="width:60px;height:60px;display:block"><svg /);
  assert.ok(wK.includes(`viewBox="${fitViewBox('minimalOne')}"`), wK.slice(0, 300));
  assert.ok(wK.includes('fill:var(--pw-white-fill,#fff)'), 'the set’s own color, behind the theme’s variable');
  assert.ok(wK.includes('aria-hidden="true"') && wK.includes('focusable="false"'));
  assert.ok(!/#123456|#654321/.test(wK), 'a TREES ink never reaches an art set');
  for (const set of ART) {
    const pieces = makePieces(undefined, undefined, set);
    assert.deepEqual(Object.keys(pieces).sort(), [...CODES].sort(), set);
    for (const code of CODES) {
      const html = draw(pieces, code, 50);
      assert.ok(html.startsWith(`<span data-pc="${code}" data-ps="${set}" style="width:50px;height:50px;display:block">`), `${set} ${code}`);
      assert.ok(html.includes(`viewBox="${fitViewBox(set)}"`), `${set} ${code} fitted`);
      assert.ok(!/LIGHT|DARK/.test(html), `${set} ${code}: no ink placeholders`);
      // every drawing element of the tree is drawn, in order
      const tags = (n, out = []) => { if (Array.isArray(n)) n.forEach((x) => tags(x, out)); else if (n) { out.push(n.t); tags(n.c, out); } return out; };
      assert.deepEqual(html.match(/<(svg|g|path|circle)\b/g).map((t) => t.slice(1)), tags(PIECE_ART[set][code]), `${set} ${code} elements`);
    }
  }
});

test('a set is drawn once and handed back: one map per look, the same drawing every render', () => {
  const a = piecesFor({ set: 'rimLight', light: '#111111', dark: '#222222' });
  assert.equal(piecesFor({ set: 'rimLight', light: null, dark: null }), a, 'an art set is one map whatever the inks');
  const wK1 = a.wK({ squareWidth: 40 });
  const wK2 = a.wK({ squareWidth: 80 });
  assert.equal(wK1.props.children, wK2.props.children, 'the same svg element at any size');
  const t1 = piecesFor({ set: 'default', light: '#f7f0dd', dark: '#20180c' });
  assert.equal(piecesFor({ set: 'default', light: '#f7f0dd', dark: '#20180c' }), t1);
  assert.notEqual(piecesFor({ set: 'default', light: '#f7f0de', dark: '#20180c' }), t1, 'a TREES set: a map per ink pair');
  // an unknown set, a key from the prototype: the Default set
  for (const bad of ['nope', 'constructor', '__proto__', 7, null, undefined]) {
    assert.match(draw(piecesFor({ set: bad }), 'wQ'), /^<span data-pc="wQ" data-ps="default"/, String(bad));
  }
});

test('piecesFor keeps the 16 looks used last', () => {
  const mine = piecesFor({ set: 'default', light: '#000001', dark: '#000002' });
  for (let i = 0; i < 30; i += 1) {
    piecesFor({ set: 'default', light: `#1000${String(i).padStart(2, '0')}`, dark: '#000000' });   // a color picker dragged
    assert.equal(piecesFor({ set: 'default', light: '#000001', dark: '#000002' }), mine, `still there after ${i + 1}`);   // the board in use asks again
  }
  for (let i = 0; i < 16; i += 1) piecesFor({ set: 'default', light: `#2000${String(i).padStart(2, '0')}`, dark: '#000000' });
  assert.notEqual(piecesFor({ set: 'default', light: '#000001', dark: '#000002' }), mine, 'not asked for in 16 looks: made again');
});

test('the Default and Court Cards sets’ pictures are byte for byte as before, whatever the theme', () => {
  for (const [key, url] of Object.entries(GOLDEN.images)) {
    const [code, light, dark, opacity] = key.split('|');
    const look = { set: 'default', light, dark };
    assert.equal(pieceImage(code, look, Number(opacity)), url, key);
    assert.equal(pieceImage(code, { ...look, skin: 'gameboy', tokens: { '--pw-white-fill': '#abcdef' } }, Number(opacity)), url, `${key} on Game Boy`);
    assert.equal(pieceImage(code, { ...look, set: 'courtCards', skin: 'felt' }, Number(opacity)), url, `${key} as Court Cards`);
  }
  assert.equal(pieceImage('xX', { set: 'default' }), null);
  assert.equal(pieceImage('xX', { set: 'minimalOne' }), null);
});

// The picture expected for an art set: the drawing, each style value made
// literal (the theme's piece colors, else the set's own) and through the
// theme's drawing filter, in the fitted viewBox at `opacity`.
function expectedArt(set, code, skin, tokens, opacity) {
  const steps = THEME_DRAWING_FILTERS[skin] ?? null;
  const map = (n) => {
    if (Array.isArray(n)) return n.map(map);
    const p = { ...n.p };
    if (p.style) p.style = Object.fromEntries(Object.entries(p.style).map(([k, v]) => [k, steps ? filterColor(literalColor(v, tokens), steps) : literalColor(v, tokens)]));
    if (n.t === 'svg') Object.assign(p, { viewBox: fitViewBox(set), opacity });
    return 'c' in n ? { t: n.t, p, c: map(n.c) } : { t: n.t, p };
  };
  return treeToSvg(map(PIECE_ART[set][code]));
}

test('Chess Arcade’s sets as pictures: literal colors, the theme’s filter, fitted', () => {
  const none = Object.fromEntries(PIECE_TOKEN_NAMES.map((n) => [n, null]));
  for (const set of ART) {
    for (const code of CODES) {
      for (const [skin, tokens] of [['felt', none], ['gameboy', none], ['hustler', none], ['drivethru', pieceTokens({ skin: 'drivethru' }, 'drivethru', 'light')]]) {
        const url = pieceImage(code, { set, skin, light: null, dark: null, tokens }, 0.32);
        const svg = svgOf(url);
        assert.ok(!svg.includes('var('), `${set} ${code} ${skin}: no var()`);
        assert.equal(svg, expectedArt(set, code, skin, tokens, 0.32), `${set} ${code} ${skin}`);
        assert.doesNotThrow(() => svgToTree(svg), `${set} ${code} ${skin} reads back`);
      }
      // Game Boy: as green as the pieces around it — nothing pure white is left (black stays black: its filter
      // keeps 0 at 0, in the browser too)
      const gb = svgOf(pieceImage(code, { set, skin: 'gameboy', tokens: none }, 1));
      assert.ok(!/(fill|stroke):(#fff\b|#ffffff\b|rgb\(255, 255, 255\)|white\b)/i.test(gb), `${set} ${code}: nothing white on Game Boy`);
      assert.notEqual(pieceImage(code, { set, skin: 'gameboy', tokens: none }, 0.3), pieceImage(code, { set, skin: 'felt', tokens: none }, 0.3), `${set} ${code}: the theme shows`);
    }
  }
  // Rim Light on Drive-Thru: the cream of the theme's gold, the theme's grape outline
  const rim = svgOf(pieceImage('wP', { set: 'rimLight', skin: 'drivethru', tokens: pieceTokens({ skin: 'drivethru' }, 'drivethru', 'light') }, 1));
  assert.ok(rim.includes(`fill:${rimCream('#ffc72c')}`) && rimCream('#ffc72c') === 'rgb(244, 184, 37)', rim.slice(0, 300));
  assert.ok(rim.includes('stroke:#5b2c8e'), 'Black’s color is Rim Light’s outline');
  // Card Crown keeps its own colors on every theme
  const crown = svgOf(pieceImage('wQ', { set: 'cardCrown', skin: 'drivethru', tokens: pieceTokens({ skin: 'drivethru' }, 'drivethru', 'light') }, 1));
  assert.ok(crown.includes('fill:#f2e6cb') && !crown.includes('#ffc72c'), crown.slice(0, 300));
});

test('boardPieces: the set, its inks and the theme’s piece colors, for every board', () => {
  const nulls = Object.fromEntries(PIECE_TOKEN_NAMES.map((n) => [n, null]));
  assert.deepEqual(boardPieces({ skin: 'gameboy' }, 'dark'), { set: 'minimalOne', skin: 'gameboy', light: null, dark: null, tokens: nulls });
  // Default picked on Game Boy: today's look, in Game Boy's own inks (Q3's 'rl' answer; 'ca' below)
  assert.deepEqual(boardPieces({ skin: 'gameboy', pieceStyleBySkin: { gameboy: 'default' } }, 'light', 'rl'),
    { set: 'default', skin: 'gameboy', light: '#e8f0c0', dark: '#0f380f', tokens: nulls });
  const felt = boardPieces({ skin: 'felt', theme: 'light' }, undefined, 'rl');
  assert.deepEqual([felt.set, felt.light, felt.dark], ['default', SKINS.felt.light.pieceLight, SKINS.felt.light.pieceDark], 'the theme from settings');
  assert.deepEqual(boardPieces({}, 'dark'), { set: 'default', skin: 'custom', light: DEFAULT_PIECE_LIGHT, dark: DEFAULT_PIECE_DARK, tokens: nulls });
  const custom = boardPieces({ pieceLight: '#e8d9b0', pieceDark: '#3a2a1a', pieceStyleBySkin: { custom: 'minimalTwo' } }, 'dark');
  assert.deepEqual(custom, { set: 'minimalTwo', skin: 'custom', light: null, dark: null,
    tokens: { '--pw-white-fill': '#e8d9b0', '--pw-black-fill': '#3a2a1a', '--pw-stroke': null } });
  // the Court Cards set looks the same on every theme: the Court Cards theme's inks
  for (const theme of ['light', 'dark']) {
    const onFelt = boardPieces({ skin: 'felt', pieceStyleBySkin: { felt: 'courtCards' } }, theme);
    assert.deepEqual([onFelt.set, onFelt.light, onFelt.dark], ['courtCards', SKINS.cards[theme].pieceLight, SKINS.cards[theme].pieceDark], theme);
    const own = boardPieces({ skin: 'cards' }, theme);
    assert.deepEqual([own.set, own.light, own.dark], ['courtCards', SKINS.cards[theme].pieceLight, SKINS.cards[theme].pieceDark], `cards ${theme}`);
    assert.equal(own.tokens['--pw-white-fill'], PIECE_TOKENS.cards[theme].white);
  }
  const dt = boardPieces({ skin: 'drivethru' }, 'dark');
  assert.deepEqual(dt, { set: 'rimLight', skin: 'drivethru', light: null, dark: null,
    tokens: { '--pw-white-fill': '#ffc72c', '--pw-black-fill': '#5b2c8e', '--pw-stroke': '#2a0e05' } });
  // Q3's switch: 'rl' keeps Repertoire Lab's inks; 'ca' takes Chess Arcade's for the Default set on a theme. The
  // user decides from screenshots, so either is one line (DEFAULT_SET_INKS) and each answer is checked by name
  assert.ok(['rl', 'ca'].includes(DEFAULT_SET_INKS), DEFAULT_SET_INKS);
  assert.deepEqual(boardPieces({ skin: 'bauhaus' }, 'light'), boardPieces({ skin: 'bauhaus' }, 'light', DEFAULT_SET_INKS), 'the switch’s answer by default');
  const ca = (s, theme) => { const l = boardPieces(s, theme, 'ca'); return [l.set, l.light, l.dark]; };
  assert.deepEqual(ca({ skin: 'bauhaus' }, 'light'), ['default', '#f4ecd6', '#20180c'], 'a theme with no piece colors: CA Default’s own');
  assert.deepEqual(ca({ skin: 'drivethru', pieceStyleBySkin: { drivethru: 'default' } }, 'dark'), ['default', '#ffc72c', '#5b2c8e']);
  assert.deepEqual(ca({ skin: 'custom', pieceLight: '#e8d9b0', pieceDark: '#3a2a1a' }, 'dark'), ['default', '#e8d9b0', '#3a2a1a'], 'Custom keeps its own');
  assert.deepEqual(ca({ skin: 'felt', pieceStyleBySkin: { felt: 'courtCards' } }, 'light'), ['courtCards', SKINS.cards.light.pieceLight, SKINS.cards.light.pieceDark]);
  assert.deepEqual(ca({ skin: 'gameboy' }, 'light'), ['minimalOne', null, null], 'art sets: no inks either way');
  // every TREES board is drawn in boardColors' inks (with the built-in pair as the fallback)
  for (const skin of PIECE_THEMES) {
    for (const theme of ['light', 'dark']) {
      const s = { skin, pieceStyleBySkin: { [skin]: 'default' } };
      const c = boardColors(s, theme);
      const look = boardPieces(s, theme, 'rl');
      assert.deepEqual([look.light, look.dark], [c.pieceLight ?? DEFAULT_PIECE_LIGHT, c.pieceDark ?? DEFAULT_PIECE_DARK], `${skin} ${theme}`);
      assert.ok(!('inks' in look), `${skin} ${theme}: 'rl' looks are as they were`);
    }
  }
});

test('Q3’s other answer (\'ca\'): the Default set in Chess Arcade’s colors, a theme’s own variable kept (Uptown’s line colors)', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  // Uptown: each Black officer's detail lines (and the knight's mane) are drawn in its line's color through
  // --ux-pl (Chess Arcade's --pw-detail there): with Chess Arcade's inks the variable stays, its color the fallback
  for (const [face, white] of [['light', '#ffffff'], ['dark', '#fafaf6']]) {
    const s = { skin: 'uptown', pieceStyleBySkin: { uptown: 'default' } };
    const ca = boardPieces(s, face, 'ca');
    assert.equal(PIECE_TOKENS.uptown[face].white, white);
    assert.deepEqual([ca.set, ca.light, ca.dark, ca.inks], ['default', `var(--ux-pl, ${white})`, PIECE_TOKENS.uptown[face].black, 'ca'], face);
    const rl = boardPieces(s, face, 'rl');
    assert.deepEqual([ca.light, ca.dark], [rl.light, rl.dark], `${face}: Uptown's colors are Chess Arcade's already, so both answers draw it alike`);
  }
  for (const [code, line] of [['bK', '#ff6b5e'], ['bQ', '#e58bdd'], ['bR', '#7fa6ff'], ['bB', '#fccc0a'], ['bN', '#8fd16a']]) {
    assert.ok(css.includes(`:root[data-skin="uptown"] [data-piece="${code}"] { --ux-pl: ${line}; }`), `${code}'s line color is the variable`);
  }
  // every theme: a variable ink keeps its variable; a plain one is the theme's piece color, else CA Default's own;
  // Custom keeps its own inks and the plain look
  for (const skin of PIECE_THEMES) {
    for (const face of ['light', 'dark']) {
      const s = { skin, pieceStyleBySkin: { [skin]: 'default' }, pieceLight: '#e8d9b0', pieceDark: '#3a2a1a' };
      const rl = boardPieces(s, face, 'rl');
      const ca = boardPieces(s, face, 'ca');
      const tag = `${skin} ${face}`;
      if (skin === 'custom') { assert.deepEqual(ca, rl, tag); continue; }
      const want = (rlInk, color) => (/^var\(--/.test(rlInk) ? `var(${rlInk.match(/^var\((--[\w-]+)/)[1]}, ${color})` : color);
      assert.equal(ca.light, want(rl.light, ca.tokens['--pw-white-fill'] ?? '#f4ecd6'), `${tag} White`);
      assert.equal(ca.dark, want(rl.dark, ca.tokens['--pw-black-fill'] ?? '#20180c'), `${tag} Black`);
      assert.equal(ca.inks, 'ca', tag);
      // another set is the same look either way
      const art = { ...s, pieceStyleBySkin: { [skin]: 'minimalOne' } };
      assert.deepEqual(boardPieces(art, face, 'ca'), boardPieces(art, face, 'rl'), `${tag} ONE`);
    }
  }
});

test('Q3’s \'ca\' pictures: the Default set in Chess Arcade’s colors through the theme’s drawing filter, as on the board', () => {
  const recolor = (svg, steps) => svg.replace(/(fill|stroke):([^;"]+)/g, (m, prop, v) => `${prop}:${filterColor(v, steps)}`);
  for (const skin of Object.keys(THEME_DRAWING_FILTERS)) {
    for (const face of ['light', 'dark']) {
      const look = boardPieces({ skin, pieceStyleBySkin: { [skin]: 'default' } }, face, 'ca');
      assert.deepEqual([look.light, look.dark, look.inks], ['#f4ecd6', '#20180c', 'ca'], `${skin} ${face}`);
      for (const code of CODES) {
        const tag = `${skin} ${face} ${code}`;
        const plain = svgOf(pieceImage(code, { set: 'default', light: look.light, dark: look.dark }, 0.32));
        const got = svgOf(pieceImage(code, look, 0.32));
        assert.equal(got, recolor(plain, THEME_DRAWING_FILTERS[skin]), tag);
        assert.ok(!/#f4ecd6|#20180c/.test(got), `${tag}: no cream or brown left`);
        assert.ok(got.includes('viewBox="0 0 45 45"') && got.includes('opacity="0.32"'), tag);
      }
    }
  }
  // Game Boy: the cream turns screen green
  const gb = svgOf(pieceImage('wP', boardPieces({ skin: 'gameboy', pieceStyleBySkin: { gameboy: 'default' } }, 'light', 'ca'), 1));
  assert.ok(gb.includes(`fill:${filterColor('#f4ecd6', THEME_DRAWING_FILTERS.gameboy)}`), gb.slice(0, 300));
  // a theme with no drawing filter: the plain picture in those colors; Uptown's keeps its variable (a picture shows
  // the fallback)
  for (const skin of ['felt', 'bauhaus', 'drivethru', 'uptown', 'cards']) {
    const look = boardPieces({ skin, pieceStyleBySkin: { [skin]: 'default' } }, 'light', 'ca');
    for (const code of CODES) assert.equal(pieceImage(code, look, 0.3), pieceImage(code, { set: 'default', light: look.light, dark: look.dark }, 0.3), `${skin} ${code}`);
  }
  // the flag is the Default set's only: Court Cards and the art sets are drawn as they are
  for (const code of CODES) {
    const cc = { set: 'courtCards', skin: 'gameboy', light: '#e8f0c0', dark: '#0f380f', tokens: {} };
    assert.equal(pieceImage(code, { ...cc, inks: 'ca' }, 0.3), pieceImage(code, cc, 0.3), `courtCards ${code}`);
    const one = { set: 'minimalOne', skin: 'gameboy', light: null, dark: null, tokens: {} };
    assert.equal(pieceImage(code, { ...one, inks: 'ca' }, 0.3), pieceImage(code, one, 0.3), `minimalOne ${code}`);
  }
});

// A page with only what applySkin touches.
function fakePage() {
  const props = new Map();
  const attrs = new Map();
  const root = {
    dataset: {},
    classList: { toggle() {} },
    style: { setProperty: (n, v) => props.set(n, v), removeProperty: (n) => props.delete(n) },
    removeAttribute: (n) => { attrs.delete(n); delete root.dataset[n.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())]; },
  };
  globalThis.document = { documentElement: root, querySelector: () => null };
  return { root, props };
}

test('applySkin puts the set on <html> and the theme’s piece colors inline, on every theme and Custom', () => {
  const { root, props } = fakePage();
  try {
    const sequence = [];
    for (const skin of PIECE_THEMES) for (const theme of ['light', 'dark']) sequence.push([skin, theme]);
    sequence.push(['drivethru', 'light'], ['felt', 'light'], ['uptown', 'dark'], ['custom', 'dark']);    // a set color never lingers
    for (const [skin, theme] of sequence) {
      for (const settings of [{ skin }, { skin, pieceStyleBySkin: { [skin]: 'wavyCoach' }, pieceLight: '#e8d9b0', pieceDark: '#3a2a1a' }]) {
        if (skin === 'custom') delete settings.skin;
        applySkin(settings, theme);
        const tag = `${skin} ${theme} ${JSON.stringify(settings)}`;
        assert.equal(root.dataset.pset, pieceStyleOf(settings), tag);
        assert.equal(root.dataset.pinks, DEFAULT_SET_INKS === 'ca' ? 'ca' : undefined, `${tag}: Q3's switch, its shadow half`);
        const want = pieceTokens(settings, skin, theme);
        for (const name of PIECE_TOKEN_NAMES) assert.equal(props.get(name) ?? null, want[name], `${tag} ${name}`);
        if (Object.hasOwn(PIECE_TOKENS, skin)) assert.equal(props.get('--pw-white-fill'), PIECE_TOKENS[skin][theme].white, tag);
        if (skin === 'custom') {
          assert.equal(root.dataset.skin, undefined, 'Custom has no data-skin');
          assert.equal(props.get('--pw-stroke'), undefined, 'Custom: each set keeps its own outline');
        } else assert.equal(root.dataset.skin, skin);
      }
    }
    applySkin({ skin: 'gameboy' }, 'light');
    assert.equal(root.dataset.pset, 'minimalOne');
    assert.ok(PIECE_TOKEN_NAMES.every((n) => !props.has(n)), 'Game Boy gives no piece colors');
  } finally {
    delete globalThis.document;
  }
});
