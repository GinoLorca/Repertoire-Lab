// Chess Arcade's piece sets as Repertoire Lab reads them (scripts/lib/
// arcadePieces.mjs) and keeps them (src/lib/pieceArt.gen.js, written by hand
// with `npm run sync:pieces`).
//
// None of this reads the Game Review copy: the hourly sync runs `npm test` on
// every new copy, and a Chess Arcade piece change must never turn that red.
// Chess Arcade's page is stood in for by small made-up ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PIECE_CODES, extractArcadePieces, pieceCssGroups, svgToTree, treeToSvg, canonSvg, pieceDataSha, pieceArtModule,
  dataFromModule, describeDrift, drawingGeometry, treesFromPiecesJsx,
} from '../scripts/lib/arcadePieces.mjs';
import * as gen from '../src/lib/pieceArt.gen.js';
import { RL_PIECE_STYLES, PIECE_THEMES, drawnByTrees, pieceStyleOf } from '../src/lib/pieceStyles.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// ---- a made-up Chess Arcade page --------------------------------------------

const art = (fill, extra = '') => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(50,88) scale(.8) translate(-50,-88)"><path id="path6570" style="fill:var(--pw-white-fill,${fill});stroke:var(--pw-stroke,#111);stroke-width:2.3" d="M10 90 L50 10 L90 90 Z"/>
  <circle style="fill:var(--pw-black-fill,#222)" cx="50" cy="40" r="6"/>${extra}</g></svg>`;
const drawings = (fill, codes = PIECE_CODES, extra = '') => Object.fromEntries(codes.map((c) => [c, art(fill, extra)]));
const CSS = `
  :root{ --pw-rim-white:var(--pw-white-fill,#f4ecd6); }
  @supports (color:rgb(from red r g b)){ :root{ --pw-rim-white:rgb(from var(--pw-white-fill,#fff) calc(r*.957) calc(g*.925) calc(b*.839)); } }
  :root[data-skin="felt"]{ --bg:#000; }
  :root[data-skin="rose"]{
    --bg:#111; --pw-white-fill:#fff8f3; --pw-black-fill:#5a1e3d; --pw-stroke:#6b2a44;
  }
  @media (prefers-color-scheme: dark){
    :root[data-skin="rose"]:not([data-theme="light"]){ --pw-white-fill:#fff8f3; --pw-black-fill:#4a1230; --pw-stroke:#3a0f24; }
  }
  :root[data-skin="rose"][data-theme="dark"]{ --pw-white-fill:#fff8f3; --pw-black-fill:#4a1230; --pw-stroke:#3a0f24; }
  :root[data-skin="book"]{ --pw-white-fill:#fbf8f1; --pw-black-fill:#1c1a17; --pw-stroke:#1c1a17; }
  .piece-wrap{ width:80%; height:80%; filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.4)); }
  /* a comment with a { brace in it */
  :root[data-skin="gameboy"] .piece-wrap svg{ filter:sepia(1) saturate(6); }
  :root[data-pset="courtCards"] .piece-wrap svg{ filter:none; --ccs-gilt:#d9ad55; }
  :root[data-skin="uptown"]:not([data-pset="courtCards"]) .piece-wrap::after{ content:"}"; }
  .board{ color:red; }
`;
function page({
  consts = { PIECE_SVG_DEFAULT: drawings('#fff'), PIECE_SVG_ONE: drawings('#eee') },
  sets = '{ default: PIECE_SVG_DEFAULT, one: PIECE_SVG_ONE, courtCards: PIECE_SVG_DEFAULT }',
  defaults = "{ felt:'default', rose:'one', book:'default' }",
  hints = "{ default:'The classic set.', one:'One\\u2019s own set, \\'flat\\'.', courtCards:'Cards.' }",
  skins = ['felt', 'rose', 'book'],
  css = CSS,
} = {}) {
  return `<!doctype html><html><head><style>${css}</style></head><body>
  <div class="field"><div class="toggle-row" id="skin-row">
    ${skins.map((s) => `<button class="toggle" data-val="${s}">${s === 'rose' ? 'Ros&eacute;' : s}</button>`).join('\n    ')}
  </div></div>
  <div class="field"><div class="toggle-row" id="piece-style-row">
    <button class="toggle active" data-val="default">Default Chess Set</button>
    <button class="toggle" data-val="one">One &#8212; Flat</button>
    <button class="toggle" data-val="courtCards">Court Cards Chess Set</button>
  </div></div>
<script>
(function(){
${Object.entries(consts).map(([k, v]) => `  const ${k} = ${JSON.stringify(v)};`).join('\n')}
  const PIECE_SETS = ${sets};
  const PIECE_STYLE_DEFAULTS = ${defaults};
  const wall = '<style>.h{font-family:serif}</style>';
    const PIECE_STYLE_HINTS = ${hints};
})();
</script></body></html>`;
}
const THEMES = ['felt', 'rose', 'book'];

test('a page: its sets, names, descriptions, defaults, themes, colors and drawings', () => {
  const d = extractArcadePieces(page(), { themes: THEMES });
  assert.deepEqual(d.order, ['default', 'one', 'courtCards']);
  assert.deepEqual(d.labels, { default: 'Default Chess Set', one: 'One — Flat', courtCards: 'Court Cards Chess Set' });
  assert.equal(d.hints.one, 'One’s own set, \'flat\'.');
  assert.deepEqual(d.defaults, { felt: 'default', rose: 'one', book: 'default' });
  assert.deepEqual(d.skins, ['felt', 'rose', 'book']);
  assert.deepEqual(d.shared, { default: 'default', one: 'one', courtCards: 'default' }, 'Court Cards draws with Default’s drawings');
  assert.deepEqual(Object.keys(d.art), ['default', 'one']);
  assert.deepEqual(d.tokens, {
    rose: {
      light: { white: '#fff8f3', black: '#5a1e3d', stroke: '#6b2a44' },
      dark: { white: '#fff8f3', black: '#4a1230', stroke: '#3a0f24' },
    },
    book: {
      light: { white: '#fbf8f1', black: '#1c1a17', stroke: '#1c1a17' },
      dark: { white: '#fbf8f1', black: '#1c1a17', stroke: '#1c1a17' },
    },
  }, 'no night block: the night colors are the day ones');
  assert.deepEqual(d.rim, { base: '#fff', r: 0.957, g: 0.925, b: 0.839, plain: '#f4ecd6' });
  assert.deepEqual(d.missingThemes, []);
  // the drawing, as a tree: the stray id gone, the style split and camelCased
  const wK = d.art.one.wK;
  assert.equal(wK.t, 'svg');
  assert.deepEqual(wK.p, { viewBox: '0 0 100 100', xmlns: 'http://www.w3.org/2000/svg' });
  assert.equal(wK.c.t, 'g', 'one child: a node, not a list');
  assert.deepEqual(wK.c.c[0].p, {
    style: { fill: 'var(--pw-white-fill,#eee)', stroke: 'var(--pw-stroke,#111)', strokeWidth: '2.3' }, d: 'M10 90 L50 10 L90 90 Z',
  });
  assert.deepEqual(wK.c.c[1], { t: 'circle', p: { style: { fill: 'var(--pw-black-fill,#222)' }, cx: '50', cy: '40', r: '6' } });
});

test('a theme Chess Arcade doesn’t have comes back in missingThemes, without throwing', () => {
  const d = extractArcadePieces(page({ skins: ['felt', 'rose'] }), { themes: THEMES });
  assert.deepEqual(d.missingThemes, ['book']);
});

test('what a page can’t be read for throws arcadePieces: …, and says what', () => {
  const throws = (html, what) => assert.throws(() => extractArcadePieces(html, { themes: THEMES }), (err) => {
    assert.match(err.message, /^arcadePieces: /);
    assert.match(err.message, what);
    return true;
  });
  // a renamed const: PIECE_SETS names a drawing that isn't there
  throws(page({ consts: { PIECE_SVG_DEFAULT: drawings('#fff'), PIECE_SVG_FLAT: drawings('#eee') } }), /PIECE_SETS — one uses PIECE_SVG_ONE/);
  // PIECE_SETS itself renamed
  throws(page().replace('const PIECE_SETS =', 'const PIECE_KITS ='), /PIECE_SETS — expected one line/);
  // a set missing a piece
  throws(page({ consts: { PIECE_SVG_DEFAULT: drawings('#fff'), PIECE_SVG_ONE: drawings('#eee', PIECE_CODES.slice(1)) } }), /PIECE_SVG_ONE — has the wrong pieces \(no wP\)/);
  // a picture, a script, a link, text, an outside reference in a drawing
  for (const [extra, why] of [
    ['<image href="x.png"/>', /<image> isn't a drawing element/],
    ['<script>alert(1)</script>', /<script> isn't a drawing element/],
    ['<path onload="x()" d="M0 0"/>', /has onload/],
    ['<path style="fill:url(https://example.com/x.svg#a)" d="M0 0"/>', /refers outside the drawing/],
    ['<path fill="url(data:image/png;base64,AA)" d="M0 0"/>', /refers outside the drawing/],
    ['hello', /has text in it/],
    ['<!-- note -->', /markup it can't read/],
    ['<path class="x" d="M0 0"/>', /has class, an attribute this doesn't let through/],
  ]) {
    throws(page({ consts: { PIECE_SVG_DEFAULT: drawings('#fff'), PIECE_SVG_ONE: drawings('#eee', PIECE_CODES, extra) } }), why);
  }
  // 'constructor' (or any Object.prototype name) as a key, anywhere
  throws(page({ sets: '{ default: PIECE_SVG_DEFAULT, constructor: PIECE_SVG_ONE, courtCards: PIECE_SVG_DEFAULT }' }), /PIECE_SETS — "constructor" can't be used as a key/);
  throws(page({ defaults: "{ felt:'default', constructor:'one' }" }), /PIECE_STYLE_DEFAULTS — "constructor"/);
  throws(page({ defaults: "{ felt:'default', rose:'__proto__' }" }), /PIECE_STYLE_DEFAULTS — "__proto__"/);
  throws(page().replace('data-val="one"', 'data-val="toString"'), /#piece-style-row — "toString"/);
  // a default naming a set the row doesn't offer; a value written another way
  throws(page({ defaults: "{ felt:'default', rose:'two' }" }), /gives rose two, which #piece-style-row doesn't offer/);
  throws(page({ defaults: "{ felt:'default', rose:\"one\" }" }), /PIECE_STYLE_DEFAULTS — has something this can't read/);
  // a set the row offers with no description
  throws(page({ hints: "{ default:'The classic set.', courtCards:'Cards.' }" }), /PIECE_STYLE_HINTS — has no description of one/);
  // night colors that disagree with their prefers-color-scheme copy
  throws(page({ css: CSS.replace(':not([data-theme="light"]){ --pw-white-fill:#fff8f3; --pw-black-fill:#4a1230;', ':not([data-theme="light"]){ --pw-white-fill:#fff8f3; --pw-black-fill:#000000;') }), /rose's night colors differ/);
  // Rim Light's cream gone
  throws(page({ css: CSS.replace(/--pw-rim-white:rgb[^;]*;/, '') }), /--pw-rim-white — expected one rule of each kind/);
});

test('a drawing goes into a tree and comes back out', () => {
  const tree = svgToTree('<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg">\n  <path fill-rule="evenodd" clip-rule="nonzero" stroke-width="1.5" data-x="1" d="M1 1"></path>\n</svg>');
  assert.deepEqual(tree, {
    t: 'svg', p: { viewBox: '0 0 45 45', xmlns: 'http://www.w3.org/2000/svg' },
    c: { t: 'path', p: { fillRule: 'evenodd', clipRule: 'nonzero', strokeWidth: '1.5', d: 'M1 1' } },
  });
  const svg = treeToSvg({
    t: 'svg', p: { viewBox: '0 0 45 45' },
    c: [{ t: 'path', p: { fillRule: 'evenodd', strokeWidth: '2', clipRule: 'evenodd', style: { strokeLinejoin: 'round', fillOpacity: '1' }, d: 'M0 0' } }, { t: 'g', p: {} }],
  });
  assert.equal(svg, '<svg viewBox="0 0 45 45"><path fill-rule="evenodd" stroke-width="2" clip-rule="evenodd" d="M0 0" style="stroke-linejoin:round;fill-opacity:1"></path><g></g></svg>');
  assert.equal(canonSvg('<svg  xmlns="a" viewBox="0 0 1 1">\n <path id="p1" style=" fill : red ;stroke:blue; " d="M0"/></svg>'),
    '<svg viewBox="0 0 1 1" xmlns="a"><path d="M0" style="fill:red;stroke:blue"></path></svg>');
});

test('the module: what sync:pieces writes reads back as the same data, and is the same every time', async () => {
  const d = extractArcadePieces(page(), { themes: THEMES });
  const text = pieceArtModule(d, '1234abc A commit (index.html)');
  assert.equal(pieceArtModule(extractArcadePieces(page(), { themes: THEMES }), '1234abc A commit (index.html)'), text);
  assert.ok(text.endsWith('};\n'));
  const mod = await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
  assert.equal(mod.PIECE_DATA_SHA, pieceDataSha(d));
  assert.equal(pieceDataSha(dataFromModule(mod)), mod.PIECE_DATA_SHA);
  assert.deepEqual(Object.keys(mod.PIECE_ART), ['one'], 'Default’s drawings stay out: RL draws them with TREES');
  assert.equal(mod.PIECE_ART_FROM, '1234abc A commit (index.html)');
  // what moved, in words
  const moved = extractArcadePieces(page({ defaults: "{ felt:'one', rose:'one', book:'default' }", hints: "{ default:'The classic set.', one:'Changed.', courtCards:'Cards.' }" }), { themes: THEMES });
  assert.notEqual(pieceDataSha(moved), mod.PIECE_DATA_SHA);
  assert.deepEqual(describeDrift(dataFromModule(mod), moved), [
    'the descriptions of one',
    "felt's own set: default in pieceArt.gen.js, one in Chess Arcade",
  ]);
});

test('the piece CSS, in groups: by set, by theme, the rest; whitespace doesn’t count, a change does', () => {
  const groups = pieceCssGroups(page());
  assert.deepEqual(Object.keys(groups), ['base', 'set:courtCards', 'theme:book', 'theme:gameboy', 'theme:rose', 'theme:uptown']);
  const reflowed = CSS.replace(/; /g, ';\n      ').replace(/\{ /g, '{\n  ').replace(/ \}/g, '\n}').replace(/, /g, ',');
  assert.notEqual(reflowed, CSS);
  assert.deepEqual(pieceCssGroups(page({ css: reflowed })), groups);
  const changed = pieceCssGroups(page({ css: CSS.replace('sepia(1)', 'sepia(.9)') }));
  assert.deepEqual(Object.keys(groups).filter((k) => groups[k] !== changed[k]), ['theme:gameboy']);
  // a theme's other tokens are not piece CSS: only its piece colors are
  const bg = pieceCssGroups(page({ css: CSS.replace('--bg:#111;', '--bg:#222;') }));
  assert.deepEqual(bg, groups);
});

// ---- the module that's committed ------------------------------------------------

test('pieceArt.gen.js is what sync:pieces wrote: its fingerprint matches what it holds', () => {
  assert.equal(pieceDataSha(dataFromModule(gen)), gen.PIECE_DATA_SHA);
  assert.match(gen.PIECE_DATA_SHA, /^[0-9a-f]{64}$/);
  assert.ok(!Object.hasOwn(gen.PIECE_ART, 'default'));
});

test('every drawing in it goes out to markup and back unchanged', () => {
  let n = 0;
  for (const [set, codes] of Object.entries(gen.PIECE_ART)) {
    assert.deepEqual(Object.keys(codes).sort(), [...PIECE_CODES].sort(), set);
    for (const [code, tree] of Object.entries(codes)) {
      assert.deepEqual(svgToTree(treeToSvg(tree), `${set}.${code}`), tree, `${set}.${code}`);
      n += 1;
    }
  }
  assert.ok(n >= 12);
});

test('every set Repertoire Lab offers can be drawn, and every theme resolves to one of them', () => {
  for (const set of RL_PIECE_STYLES) {
    assert.ok(drawnByTrees(set) || (Object.hasOwn(gen.PIECE_ART, set) && Object.keys(gen.PIECE_ART[set]).length === 12), set);
  }
  for (const skin of PIECE_THEMES) assert.ok(RL_PIECE_STYLES.includes(pieceStyleOf({ skin }, skin)), skin);
  for (const skin of PIECE_THEMES) assert.ok(gen.ARCADE_SKINS.includes(skin), `Chess Arcade has ${skin}`);
});

test('RL’s own TREES, read as text the way check:pieces holds Chess Arcade’s Default against them', () => {
  // (Chess Arcade's Default itself is compared by scripts/check-pieces.mjs, against the copy: a soft warning.)
  const trees = treesFromPiecesJsx(read('../src/lib/pieces.jsx'));
  assert.deepEqual(Object.keys(trees).sort(), [...PIECE_CODES].sort());
  for (const code of PIECE_CODES) {
    const g = drawingGeometry(trees[code]);
    assert.ok(g.length >= 2 && g[0][0] === 'svg', code);
    assert.deepEqual(drawingGeometry(svgToTree(treeToSvg(trees[code]))), g, code);
  }
});

// ---- the hourly sync never writes it ----------------------------------------------

test('the hourly Game Review sync never writes or commits the piece module', () => {
  const workflow = read('../.github/workflows/sync-arcade.yml');
  const adds = workflow.split('\n').filter((l) => /\bgit add\b/.test(l));
  assert.ok(adds.length >= 1);
  for (const l of adds) assert.doesNotMatch(l, /pieceArt|pieceCss|src\/lib\/\*|src\/lib\s*$|-A\s*$/, l);
  const code = read('../scripts/sync-arcade.mjs').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /arcadePieces|pieceArt\.gen|sync-pieces/);
  // …and the soft step only warns
  assert.match(workflow, /check-pieces\.mjs/);
  const step = workflow.slice(workflow.indexOf('Piece styles still in step?'));
  assert.match(step.slice(0, 400), /continue-on-error: true/);
});
