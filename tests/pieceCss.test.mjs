// The piece CSS in src/styles.css (build step R5 of the piece styles): the theme rules that light a piece's drawing
// key on lib/pieces' span (data-pc, with data-ps = its set) and leave the Court Cards Chess Set alone; the @pieces
// block holds what belongs to a set (Rim Light's cream, Chess Arcade's shadow, the Court Cards set, the theme cards'
// filters). Read as text, like cardsOrnaments.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cssRules, declarations } from '../scripts/lib/arcadePieces.mjs';
import { RIM_CREAM } from '../src/lib/pieceArt.gen.js';

const CSS = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const BEGIN = '/* @pieces */';
const END = '/* @pieces:end */';
const block = () => CSS.slice(CSS.indexOf(BEGIN), CSS.indexOf(END) + END.length);
const rulesOf = (css) => cssRules(`<style>${css}</style>`);
const ALL = rulesOf(CSS);
const OUTSIDE = rulesOf(CSS.slice(0, CSS.indexOf(BEGIN)) + CSS.slice(CSS.indexOf(END) + END.length));
const PIECES = rulesOf(block());
const decl = (r, name) => declarations(r.body).filter(([n]) => n === name).map(([, v]) => v);
const parts = (sel) => {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  return [...out, cur].map((s) => s.trim()).filter(Boolean);
};

test('the @pieces block: once, right after the Court Cards ornaments, after every theme\'s piece rules', () => {
  assert.equal(CSS.split(BEGIN).length, 2, 'one block');
  assert.equal(CSS.split(END).length, 2, 'one end');
  assert.equal(CSS.indexOf(BEGIN), CSS.indexOf('/* @cards:ornaments:end */\n') + '/* @cards:ornaments:end */\n'.length,
    'right after @cards:ornaments:end (the ornaments stay right after @cards:board:end)');
  assert.ok(CSS.indexOf(BEGIN) > CSS.indexOf('/* @cards:board:end */'));
  assert.ok(!/:has\(/.test(block().replace(/\/\*[\s\S]*?\*\//g, '')), 'no :has() in the block');
});

test('every theme rule on a piece\'s drawing keys on the span and leaves the Court Cards set alone', () => {
  const drawing = OUTSIDE.filter((r) => /data-skin="/.test(r.selector) && /\[data-(piece|pc)\b/.test(r.selector) && decl(r, 'filter').length);
  const skins = new Set();
  for (const r of drawing) {
    for (const sel of parts(r.selector)) {
      const skin = sel.match(/data-skin="(\w+)"/)[1];
      skins.add(skin);
      assert.ok(!/\[data-piece[^\]]*\]\s+svg/.test(sel), `${sel}: keyed on react-chessboard's [data-piece] svg`);
      assert.ok(/ > \[data-pc[^\]]*\](\[data-ps="default"\]|:not\(\[data-ps="default"\]\))?(:not\(\[data-ps="courtCards"\]\))? > svg$/.test(sel.replace(/>/g, ' > ').replace(/\s+/g, ' ')),
        `${sel}: not the span's own svg`);
      assert.ok(/\[data-ps="default"\]/.test(sel) || /:not\(\[data-ps="courtCards"\]\)/.test(sel), `${sel}: reaches the Court Cards set`);
      assert.ok(!/:has\(/.test(sel), `${sel}: :has()`);
      // the picker's form (no :not(.promotion-option)) is Game Boy's only, as Chess Arcade's .promo-picker rule
      if (skin === 'gameboy') assert.ok(/:not\(\.bpv-sq\)\s*>/.test(sel) && !/promotion-option/.test(sel), `${sel}: Game Boy's picker form`);
      else assert.ok(/:not\(\.bpv-sq\):not\(\.promotion-option\)\s*>/.test(sel), `${sel}: the board's form`);
    }
  }
  assert.deepEqual([...skins].sort(), ['drivethru', 'gameboy', 'hustler', 'outerspace', 'rose', 'uptown']);
  // Hustler's rims are the Default set's; its other sets go plain monochrome
  const hustler = drawing.filter((r) => r.selector.includes('data-skin="hustler"'));
  assert.equal(hustler.filter((r) => r.selector.includes('[data-ps="default"]') && /drop-shadow/.test(decl(r, 'filter')[0])).length, 2, 'two rims, Default only');
  assert.equal(hustler.filter((r) => r.selector.includes(':not([data-ps="default"])') && !/drop-shadow/.test(decl(r, 'filter')[0])).length, 1, 'the art sets: no rim');
});

test('Uptown\'s line tabs are the square\'s and never under the Court Cards set', () => {
  const tabs = ALL.filter((r) => r.selector.includes('data-skin="uptown"') && /::after$/.test(r.selector) && /\[data-piece/.test(r.selector));
  assert.equal(tabs.length, 1);
  assert.match(tabs[0].selector, /^:root\[data-skin="uptown"\]:not\(\[data-pset="courtCards"\]\) \[data-square\] \[data-piece\]/);
});

test('the Court Cards set\'s rules key on the set, not on the theme, and its palette is the theme\'s own colors', () => {
  for (const r of ALL) {
    if (!/\[data-pc\b/.test(r.selector)) continue;
    assert.ok(!r.selector.includes('data-skin="cards"'), `${r.selector}: keyed on the theme`);
  }
  const cc = PIECES.filter((r) => /--cc-(pl|pd|pip|pipc|halo|px)\b/.test(r.body) || /::(before|after)$/.test(r.selector));
  assert.ok(cc.length >= 20, 'the set\'s rules are in the block');
  for (const r of cc) for (const sel of parts(r.selector)) assert.ok(sel.includes('[data-ps="courtCards"]'), `${sel}: not the set's`);
  // the set's --ccs-* by day and after dark equal the Court Cards theme's --cc-* (so that theme looks as it did)
  const tok = (sel) => Object.fromEntries(declarations(ALL.find((r) => r.selector === sel && /--cc(s)?-pip-w/.test(r.body)).body));
  const day = tok(':root[data-skin="cards"][data-theme="light"]');
  const night = tok(':root[data-skin="cards"]');
  for (const [set, theme] of [[tok('[data-pc][data-ps="courtCards"]'), day], [tok(':root[data-theme="dark"] [data-pc][data-ps="courtCards"]'), night]]) {
    assert.deepEqual(
      [set['--ccs-pip-w'], set['--ccs-pip-b'], set['--ccs-halo-w'], set['--ccs-halo-b'], set['--ccs-gilt']],
      [theme['--cc-pip-w'], theme['--cc-pip-b'], theme['--cc-halo-w'], theme['--cc-halo-b'], theme['--cc-gilt-hi']],
    );
  }
  assert.ok(!/var\(--cc-(gilt-hi|pip-w|pip-b|halo-w|halo-b)\)/.test(block()), 'the set reads its own --ccs-*');
});

test('the theme cards\' resets come after every pip rule (they tie them at (0,3,1))', () => {
  const b = block();
  const lastPip = Math.max(b.lastIndexOf(':not([data-pc$="P"])::before'), b.lastIndexOf(':not([data-pc$="P"])::after'));
  const reset = b.indexOf('.board-preview [data-pc][data-ps="courtCards"]::before');
  assert.ok(lastPip > 0 && reset > lastPip, 'the resets come last');
  const r = PIECES.find((x) => x.selector === '.board-preview [data-pc][data-ps="courtCards"]::before,.board-preview [data-pc][data-ps="courtCards"]::after');
  assert.ok(r && decl(r, 'content')[0] === 'none');
  assert.ok(PIECES.some((x) => x.selector === '.board-preview [data-pc][data-ps="courtCards"]' && decl(x, 'filter')[0] === 'none'));
});

test('Chess Arcade\'s shadow: its own sets only, on the themes that cast none of their own; Q3\'s switch for Default', () => {
  const r = PIECES.filter((x) => decl(x, 'filter').includes('drop-shadow(0 1px 1.5px rgba(0,0,0,0.4))'));
  assert.equal(r.length, 1);
  const [sets, q3] = parts(r[0].selector);
  for (const skin of ['drivethru', 'rose', 'chessbook', 'uptown']) {
    assert.ok(sets.includes(`:not([data-skin="${skin}"])`), skin);
    assert.ok(q3.includes(`:not([data-skin="${skin}"])`), skin);
  }
  assert.ok(sets.includes(':not([data-ps="default"]):not([data-ps="courtCards"])') && sets.includes(':not(.bpv-sq):not(.promotion-option)>'));
  assert.ok(q3.startsWith(':root[data-pinks="ca"][data-skin]') && q3.endsWith('[data-pc][data-ps="default"]'));
});

test('Rim Light\'s cream is Chess Arcade\'s (the numbers pieceArt.gen.js carries), worked out on each piece', () => {
  const rim = PIECES.filter((x) => x.selector === '[data-pc]' && decl(x, '--pw-rim-white').length);
  assert.equal(rim.length, 2);
  assert.deepEqual(rim[0].at, []);
  assert.equal(decl(rim[0], '--pw-rim-white')[0], `var(--pw-white-fill,${RIM_CREAM.plain})`);
  assert.deepEqual(rim[1].at, ['@supports (color: rgb(from red r g b))']);
  assert.equal(decl(rim[1], '--pw-rim-white')[0],
    `rgb(from var(--pw-white-fill,${RIM_CREAM.base}) calc(r * ${RIM_CREAM.r}) calc(g * ${RIM_CREAM.g}) calc(b * ${RIM_CREAM.b}))`);
});

test('the piece CSS recorded as ported (check:pieces --record-css): a sha256 per group of Chess Arcade\'s piece CSS', () => {
  const rec = JSON.parse(readFileSync(new URL('../src/lib/pieceCss.ported.json', import.meta.url), 'utf8'));
  assert.equal(typeof rec.from, 'string');
  assert.ok(!/(^|\s)(~|\/(Users|home|private|tmp|var))\//.test(rec.from), 'names a commit and a file, never a local path');
  for (const key of ['base', 'set:courtCards', 'set:cardCrown', 'theme:gameboy', 'theme:hustler', 'theme:outerspace', 'theme:uptown']) {
    assert.ok(Object.hasOwn(rec.groups, key), key);
  }
  for (const [key, sha] of Object.entries(rec.groups)) assert.match(sha, /^[0-9a-f]{64}$/, key);
});

// R6 and R8: Settings' Piece style row and the game cards' thumbnails.
test('the Piece style row: four across (two even rows) or two on a phone, 44px buttons, a ring for the keyboard', () => {
  const sel = (s) => ALL.filter((r) => parts(r.selector).includes(s));
  const grid = sel('.piece-style-choices').flatMap((r) => decl(r, 'grid-template-columns'));
  assert.deepEqual(grid, ['repeat(auto-fit,minmax(max(120px,calc(25% - 8px)),1fr))']);
  const card = sel('.piece-style-choices .theme-card');
  assert.deepEqual(card.flatMap((r) => decl(r, 'min-height')), ['44px']);
  assert.deepEqual(card.flatMap((r) => decl(r, 'min-width')), ['0'], 'no 150px floor: the grid decides the width');
  assert.match(sel('.piece-style-choices .theme-card:focus-visible').flatMap((r) => decl(r, 'outline')).join(), /^2px solid var\(--accent\)$/);
});

test('the thumbnails (MiniBoard) draw the set as pictures: no glyph styles left, nothing a piece rule could reach', () => {
  const mb = ALL.filter((r) => /\.mb-piece/.test(r.selector));
  assert.deepEqual(mb.map((r) => r.selector.trim()), ['.mb-piece']);
  assert.deepEqual(decl(mb[0], 'background-size'), ['100% 100%']);
  assert.ok(!mb.some((r) => decl(r, 'color').length || decl(r, '-webkit-text-stroke').length));
  const jsx = readFileSync(new URL('../src/components/MiniBoard.jsx', import.meta.url), 'utf8');
  // data-pc / data-ps would put the board's piece rules (shadows, suits) on a thumbnail
  assert.ok(!/data-pc=|data-ps=/.test(jsx), 'MiniBoard marks its pieces data-mb, its set data-set');
  assert.match(jsx, /pieceImage\(code, look, 1\)/);
});
