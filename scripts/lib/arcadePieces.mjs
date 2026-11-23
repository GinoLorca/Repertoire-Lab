// Chess Arcade's piece sets, read out of its index.html (or out of Repertoire
// Lab's copy of it, public/arcade/review.<hash>.html, which is the same page
// with a bridge added).
//
// Pure functions only: no files, no network, nothing from src/. Two scripts use
// them, and neither runs on its own schedule into the app:
//
//   scripts/sync-pieces.mjs   by hand, in a Repertoire Lab change that gets
//                             screenshots: writes src/lib/pieceArt.gen.js
//   scripts/check-pieces.mjs  says (warns, never fails the hourly job) when
//                             Chess Arcade's piece data or piece CSS has moved
//                             ahead of what Repertoire Lab's boards draw
//
// What's read, and where it sits in Chess Arcade:
//
//   · the sets, their order and their names: the Settings row
//     <div class="toggle-row" id="piece-style-row"> and its buttons
//   · the themes: the row id="skin-row", the same way
//   · each set's description: const PIECE_STYLE_HINTS = {…}; (one line)
//   · each theme's own set: const PIECE_STYLE_DEFAULTS = {…}; (one line)
//   · which drawings each set uses: const PIECE_SETS = {…}; (Court Cards
//     reuses the Default drawings; its look is CSS)
//   · the drawings: const PIECE_SVG_* = {…}; — 12 standalone <svg> strings each,
//     as JSON on one line
//   · each theme's piece colors: --pw-white-fill / --pw-black-fill / --pw-stroke
//     on :root[data-skin="X"] (by day) and :root[data-skin="X"][data-theme="dark"]
//     (at night, with an identical copy inside @media (prefers-color-scheme: dark))
//   · Rim Light's cream: the two --pw-rim-white rules
//
// Anything that isn't where it's expected throws `arcadePieces: <what> — …`,
// in the spirit of sync-arcade.mjs's replaceOnce: a Chess Arcade that moved on
// in a way this doesn't know about is better stopped here than half-read.
import { createHash } from 'node:crypto';

export const PIECE_CODES = ['wP', 'wN', 'wB', 'wR', 'wQ', 'wK', 'bP', 'bN', 'bB', 'bR', 'bQ', 'bK'];

const fail = (what, why) => {
  throw new Error(`arcadePieces: ${what} — ${why}`);
};

// A key that would land on Object.prototype ('constructor', '__proto__', …)
// is never a set or a theme: refuse it rather than write it into a map.
function safeKey(key, what) {
  if (typeof key !== 'string' || !/^\w+$/.test(key) || key === '__proto__' || key in Object.prototype) {
    fail(what, `${JSON.stringify(key)} can't be used as a key`);
  }
  return key;
}
const own = (obj, key) => obj != null && Object.hasOwn(obj, key);

// ---- text in the page -------------------------------------------------------

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', Eacute: 'É', egrave: 'è',
  agrave: 'à', ecirc: 'ê', ccedil: 'ç', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–',
  hellip: '…', middot: '·', times: '×',
};
export function decodeEntities(text, what = 'text') {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    if (own(NAMED, e)) return NAMED[e];
    return fail(what, `an entity this doesn't know: ${m}`);
  });
}

// The body of a '…' string in Chess Arcade's code, escapes and all.
function jsString(body, what) {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, e) => {
    if (e[0] === 'u' && e.length > 1) return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    const simple = { n: '\n', t: '\t', r: '\r', "'": "'", '"': '"', '\\': '\\' };
    if (own(simple, e)) return simple[e];
    return fail(what, `an escape this doesn't know: ${m}`);
  });
}

// `^<indent>const NAME = {…};$` — exactly one, on one line.
function oneLineObject(html, name, indent) {
  const re = new RegExp(`^${indent}const ${name} = \\{(.*)\\};[ \\t]*$`, 'gm');
  const found = [...html.matchAll(re)];
  if (found.length !== 1) fail(name, `expected one line "${indent}const ${name} = {…};", found ${found.length}`);
  return found[0][1];
}

// key:value pairs of a one-line object literal. Everything in it must be read:
// a value written another way (double quotes, a template, a call) would
// otherwise be skipped without a word.
function pairs(body, valueRe, what) {
  const re = new RegExp(`(\\w+)\\s*:\\s*${valueRe}`, 'g');
  const out = [];
  let rest = body;
  for (const m of body.matchAll(re)) {
    out.push(m);
    rest = rest.replace(m[0], '');
  }
  if (rest.replace(/[\s,]/g, '') !== '') fail(what, `has something this can't read: ${JSON.stringify(rest.trim().slice(0, 60))}`);
  const seen = new Set();
  for (const m of out) {
    safeKey(m[1], what);
    if (seen.has(m[1])) fail(what, `names ${m[1]} twice`);
    seen.add(m[1]);
  }
  return out;
}

// A Settings row of buttons: [[data-val, label], …] in the page's order.
function toggleRow(html, id) {
  const re = new RegExp(`<div\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</div>`, 'g');
  const rows = [...html.matchAll(re)];
  if (rows.length !== 1) fail(`#${id}`, `expected one row, found ${rows.length}`);
  const inner = rows[0][1];
  const buttons = [...inner.matchAll(/<button\b[^>]*?\bdata-val="(\w+)"[^>]*>([^<]+)<\/button>/g)];
  const count = (inner.match(/<button\b/g) ?? []).length;
  if (!buttons.length || buttons.length !== count) fail(`#${id}`, `read ${buttons.length} of its ${count} buttons`);
  const seen = new Set();
  return buttons.map((m) => {
    const key = safeKey(m[1], `#${id}`);
    if (seen.has(key)) fail(`#${id}`, `has ${key} twice`);
    seen.add(key);
    const label = decodeEntities(m[2], `#${id}`).replace(/\s+/g, ' ').trim();
    if (!label) fail(`#${id}`, `${key} has no name`);
    return [key, label];
  });
}

// ---- the page's CSS ---------------------------------------------------------

// The text of the page's own <style> elements: never a '<style>' that is only
// text inside its code (Chess Arcade's script holds some, in its wallpapers).
function styleText(html) {
  const page = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const css = [...page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  if (!css.length) fail('the CSS', 'no <style> found');
  return css.join('\n');
}

function skipString(css, i) {
  const q = css[i];
  for (let j = i + 1; j < css.length; j += 1) {
    if (css[j] === '\\') j += 1;
    else if (css[j] === q) return j + 1;
  }
  return fail('the CSS', 'a string that never ends');
}
function skipComment(css, i) {
  const end = css.indexOf('*/', i + 2);
  return end < 0 ? fail('the CSS', 'a comment that never ends') : end + 2;
}
function closingBrace(css, open, to) {
  let depth = 0;
  for (let i = open; i < to;) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { i = skipComment(css, i); continue; }
    if (c === '"' || c === "'") { i = skipString(css, i); continue; }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return fail('the CSS', 'a { with no }');
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const squash = (s) => stripComments(s).replace(/\s+/g, ' ').trim();
// Whitespace that can't change what a selector means goes, so a reflowed rule
// reads as the same rule.
const normSelector = (s) => squash(s).replace(/\s*([>+~,])\s*/g, '$1').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
const normValue = (s) => squash(s).replace(/\s*,\s*/g, ',').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');

function scan(css, from, to, at, out) {
  let start = from;
  for (let i = from; i < to;) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { i = skipComment(css, i); continue; }
    if (c === '"' || c === "'") { i = skipString(css, i); continue; }
    if (c === ';') { i += 1; start = i; continue; } // @import, @charset: not rules
    if (c === '}') fail('the CSS', 'a } with no {');
    if (c === '{') {
      const prelude = squash(css.slice(start, i));
      const end = closingBrace(css, i, to);
      if (/^@(media|supports|layer|container|document|scope)\b/i.test(prelude)) scan(css, i + 1, end, [...at, normValue(prelude)], out);
      else if (!prelude.startsWith('@')) out.push({ at, selector: normSelector(prelude), body: css.slice(i + 1, end) });
      // (@keyframes, @font-face, @page, @property hold no style rules)
      i = end + 1;
      start = i;
      continue;
    }
    i += 1;
  }
}

// Every style rule of the page, in source order, with the @media/@supports it
// sits in: { at: ['@media (…)'], selector, body }.
export function cssRules(html) {
  const css = styleText(html);
  const out = [];
  scan(css, 0, css.length, [], out);
  return out;
}

// A rule's declarations as [name, value] pairs, comments and extra whitespace
// gone. (A ';' inside a string or url() doesn't split.)
export function declarations(body) {
  const out = [];
  let depth = 0;
  let start = 0;
  const text = stripComments(body);
  const push = (s) => {
    const at = s.indexOf(':');
    if (at > 0) out.push([s.slice(0, at).trim(), normValue(s.slice(at + 1))]);
  };
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === '"' || c === "'") { i = skipString(text, i); continue; }
    if (c === '(' || c === '{') depth += 1;
    else if (c === ')' || c === '}') depth -= 1;
    else if (c === ';' && depth === 0) {
      push(text.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  push(text.slice(start));
  return out;
}

const TOKEN_FIELDS = { '--pw-white-fill': 'white', '--pw-black-fill': 'black', '--pw-stroke': 'stroke' };

function pieceTokens(rules) {
  const found = { light: {}, dark: {}, media: {} };
  for (const rule of rules) {
    const ds = declarations(rule.body).filter(([n]) => own(TOKEN_FIELDS, n));
    if (!ds.length) continue;
    let face = null;
    let m;
    if (!rule.at.length && (m = rule.selector.match(/^:root\[data-skin="(\w+)"\]$/))) face = 'light';
    else if (!rule.at.length && (m = rule.selector.match(/^:root\[data-skin="(\w+)"\]\[data-theme="dark"\]$/))) face = 'dark';
    else if (rule.at.length === 1 && /prefers-color-scheme:\s*dark/.test(rule.at[0])
      && (m = rule.selector.match(/^:root\[data-skin="(\w+)"\]:not\(\[data-theme="light"\]\)$/))) face = 'media';
    if (!face) continue; // a set's or a piece's own colors, not a theme's
    const skin = safeKey(m[1], 'piece colors');
    if (own(found[face], skin)) fail('piece colors', `two rules give ${skin}'s ${face === 'light' ? 'day' : 'night'} piece colors (${rule.selector})`);
    const t = { white: null, black: null, stroke: null };
    for (const [n, v] of ds) t[TOKEN_FIELDS[n]] = v;
    found[face][skin] = t;
  }
  const tokens = {};
  for (const skin of Object.keys(found.light)) {
    const light = found.light[skin];
    const dark = found.dark[skin] ?? null;
    const media = found.media[skin] ?? null;
    if (JSON.stringify(dark) !== JSON.stringify(media)) {
      fail('piece colors', `${skin}'s night colors differ between [data-theme="dark"] and its prefers-color-scheme copy`);
    }
    tokens[skin] = { light, dark: dark ?? light };
  }
  for (const skin of [...Object.keys(found.dark), ...Object.keys(found.media)]) {
    if (!own(found.light, skin)) fail('piece colors', `${skin} has night piece colors but none by day`);
  }
  return tokens;
}

// --pw-rim-white, both ways Chess Arcade writes it: the cream worked out from
// the theme's White, and the plain fallback for a browser without relative
// colors.
function rimCream(css) {
  const num = '(\\d*\\.?\\d+)';
  const rel = [...css.matchAll(new RegExp(
    `--pw-rim-white\\s*:\\s*rgb\\(\\s*from\\s+var\\(\\s*--pw-white-fill\\s*,\\s*(#[0-9a-fA-F]{3,8})\\s*\\)\\s+`
    + `calc\\(\\s*r\\s*\\*\\s*${num}\\s*\\)\\s+calc\\(\\s*g\\s*\\*\\s*${num}\\s*\\)\\s+calc\\(\\s*b\\s*\\*\\s*${num}\\s*\\)\\s*\\)`, 'g'))];
  const plain = [...css.matchAll(/--pw-rim-white\s*:\s*var\(\s*--pw-white-fill\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/g)];
  if (rel.length !== 1 || plain.length !== 1) {
    fail('--pw-rim-white', `expected one rule of each kind, found ${rel.length} worked out and ${plain.length} plain`);
  }
  const [, base, r, g, b] = rel[0];
  return { base: base.toLowerCase(), r: Number(r), g: Number(g), b: Number(b), plain: plain[0][1].toLowerCase() };
}

// ---- the drawings -----------------------------------------------------------

const TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line']);
const ATTRS = new Set([
  'viewBox', 'xmlns', 'version', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'points', 'x1', 'y1', 'x2', 'y2',
  'transform', 'style', 'fill', 'stroke', 'stroke-width', 'opacity', 'fill-rule', 'clip-rule',
]);
const camel = (name) => (name.startsWith('--') ? name : name.replace(/-([a-z])/g, (m, c) => c.toUpperCase()));
const kebab = (name) => (name.startsWith('--') ? name : name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
const attrName = (name) => (name === 'viewBox' ? name : kebab(name));
const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// Only a reference to something inside the same drawing (url(#…)), never a
// file or a page.
function checkUrls(value, what) {
  for (const m of String(value).matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) {
    if (!m[2].startsWith('#')) fail(what, `refers outside the drawing: ${m[0]}`);
  }
  if (/url\(/i.test(String(value).replace(/url\(\s*(['"]?)#[^)'"]*\1\s*\)/gi, ''))) fail(what, `has a url( this can't read`);
}

function styleObject(text, what) {
  const out = {};
  for (const part of text.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) {
      if (part.trim()) fail(what, `a style it can't read: ${JSON.stringify(part.trim())}`);
      continue;
    }
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (!/^-{0,2}[a-zA-Z][\w-]*$/.test(name)) fail(what, `a style name it can't read: ${JSON.stringify(name)}`);
    checkUrls(value, what);
    out[camel(name)] = value;
  }
  return out;
}

// An XML-ish tokenizer for one standalone <svg> string: elements, attributes
// in double or single quotes, whitespace. Comments, CDATA, doctypes or a stray
// '<' throw.
function parseMarkup(svg, what) {
  const re = /<\/([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)((?:\s+[^\s=/>"']+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|([\s\S])/g;
  const root = { kids: [] };
  const stack = [root];
  for (const m of svg.matchAll(re)) {
    const [, close, open, attrs, self, text, other] = m;
    if (other !== undefined) fail(what, `markup it can't read at ${JSON.stringify(svg.slice(m.index, m.index + 30))}`);
    if (text !== undefined) {
      stack[stack.length - 1].kids.push({ text });
      continue;
    }
    if (close !== undefined) {
      const top = stack.pop();
      if (!top?.tag || top.tag !== close) fail(what, `</${close}> closes ${top?.tag ? `<${top.tag}>` : 'nothing'}`);
      continue;
    }
    const node = { tag: open, attrs: [], kids: [] };
    for (const a of attrs.matchAll(/([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      if (node.attrs.some(([n]) => n === a[1])) fail(what, `<${open}> has ${a[1]} twice`);
      node.attrs.push([a[1], decodeEntities(a[2] ?? a[3], what)]);
    }
    stack[stack.length - 1].kids.push(node);
    if (!self) stack.push(node);
  }
  if (stack.length !== 1) fail(what, `<${stack[stack.length - 1].tag}> is never closed`);
  return root.kids;
}

// One standalone <svg> string → Repertoire Lab's tree format, the one
// src/lib/pieces.jsx draws: { t, p: { …attributes, style: { camelCase } },
// c: node | node[] } (no c when there are no children, one node when there's
// one). Only drawing elements and attributes are let through; ids and data-*
// are dropped; scripts, links, pictures, text and outside references throw.
export function svgToTree(svg, what = 'a drawing') {
  const top = parseMarkup(svg, what).filter((n) => !(n.text !== undefined && !n.text.trim()));
  if (top.length !== 1 || top[0].tag !== 'svg') fail(what, 'expected exactly one <svg> element');
  const build = (node) => {
    if (!TAGS.has(node.tag)) fail(what, `<${node.tag}> isn't a drawing element this lets through`);
    const p = {};
    for (const [name, value] of node.attrs) {
      if (name === 'id' || name.startsWith('data-')) continue;
      if (/^on/i.test(name) || /(^|:)href$/i.test(name)) fail(what, `<${node.tag}> has ${name}`);
      if (!ATTRS.has(name)) fail(what, `<${node.tag}> has ${name}, an attribute this doesn't let through`);
      if (name === 'style') {
        const style = styleObject(value, what);
        if (Object.keys(style).length) p.style = style;
      } else {
        checkUrls(value, what);
        p[camel(name)] = value;
      }
    }
    const kids = [];
    for (const k of node.kids) {
      if (k.text !== undefined) {
        if (k.text.trim()) fail(what, `has text in it: ${JSON.stringify(k.text.trim().slice(0, 30))}`);
        continue;
      }
      kids.push(build(k));
    }
    const out = { t: node.tag, p };
    if (kids.length) out.c = kids.length === 1 ? kids[0] : kids;
    return out;
  };
  return build(top[0]);
}

// …and back: attribute and style names in kebab-case (fillRule → fill-rule),
// except viewBox. For tests, and for drawings made into pictures.
export function treeToSvg(node) {
  if (node == null || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map(treeToSvg).join('');
  const { style, ...props } = node.p ?? {};
  const attrs = Object.entries(props).map(([k, v]) => ` ${attrName(k)}="${escAttr(v)}"`).join('');
  const css = style ? Object.entries(style).map(([k, v]) => `${kebab(k)}:${v}`).join(';') : '';
  const kids = 'c' in node ? treeToSvg(node.c) : '';
  return `<${node.t}${attrs}${css ? ` style="${escAttr(css)}"` : ''}>${kids}</${node.t}>`;
}

// For comparing drawings as markup: no whitespace between tags, no ids,
// attributes sorted, style declarations trimmed.
export function canonSvg(svg) {
  const out = (nodes) => nodes.map((n) => {
    if (n.text !== undefined) return n.text.trim() ? n.text : '';
    const attrs = n.attrs
      .filter(([k]) => k !== 'id')
      .map(([k, v]) => [k, k === 'style' ? v.split(';').map((d) => d.trim()).filter(Boolean).map((d) => d.replace(/\s*:\s*/, ':')).join(';') : v])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
    return `<${n.tag}${attrs}>${out(n.kids)}</${n.tag}>`;
  }).join('');
  return out(parseMarkup(svg, 'canonSvg'));
}

// A drawing's shape, element by element in order — tag, d, transform, cx, cy,
// r — with its colors left out. How Chess Arcade's Default drawings are held
// against Repertoire Lab's own Cburnett TREES, which are the same art with the
// two inks made into placeholders.
export function drawingGeometry(tree) {
  const out = [];
  const walk = (n) => {
    if (n == null || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const p = n.p ?? {};
    out.push([n.t, p.d ?? null, p.transform ?? null, p.cx ?? null, p.cy ?? null, p.r ?? null].map((v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v)));
    walk(n.c);
  };
  walk(tree);
  return out;
}

// RL's TREES, read as text from src/lib/pieces.jsx (a .jsx file plain Node
// can't import): its one `const TREES = {…};` line.
export function treesFromPiecesJsx(text) {
  const found = [...text.matchAll(/^const TREES = (\{.*\});[ \t]*$/gm)];
  if (found.length !== 1) fail('src/lib/pieces.jsx', `expected one "const TREES = {…};" line, found ${found.length}`);
  return JSON.parse(found[0][1]);
}

// ---- all of it ----------------------------------------------------------------

// Everything Repertoire Lab takes from Chess Arcade's page about its pieces:
// { order, labels, hints, defaults, skins, shared, art, tokens, rim, missingThemes }.
// `themes` are Repertoire Lab's theme ids; any Chess Arcade's #skin-row doesn't
// have come back in missingThemes (the caller decides what that means).
export function extractArcadePieces(html, { themes = [] } = {}) {
  if (typeof html !== 'string' || !html) fail('the page', 'nothing to read');
  // In a copy, only Chess Arcade's own part: the bridge Repertoire Lab adds is not Chess Arcade's data.
  const cut = html.indexOf("// ---- Repertoire Lab's Game Review");
  const resume = cut >= 0 ? html.indexOf('</script>', cut) : -1;
  const page = cut < 0 ? html : html.slice(0, cut) + (resume >= 0 ? html.slice(resume) : '');

  const row = toggleRow(page, 'piece-style-row');
  const order = row.map(([k]) => k);
  const labels = Object.fromEntries(row);
  const skins = toggleRow(page, 'skin-row').map(([k]) => k);

  const hints = {};
  for (const m of pairs(oneLineObject(page, 'PIECE_STYLE_HINTS', '[ \\t]*'), "'((?:[^'\\\\]|\\\\.)*)'", 'PIECE_STYLE_HINTS')) {
    hints[m[1]] = jsString(m[2], 'PIECE_STYLE_HINTS');
  }
  const defaults = {};
  for (const m of pairs(oneLineObject(page, 'PIECE_STYLE_DEFAULTS', '  '), "'(\\w+)'", 'PIECE_STYLE_DEFAULTS')) {
    defaults[m[1]] = safeKey(m[2], 'PIECE_STYLE_DEFAULTS');
  }
  const setConsts = {};
  for (const m of pairs(oneLineObject(page, 'PIECE_SETS', '  '), '([A-Za-z_$][\\w$]*)', 'PIECE_SETS')) setConsts[m[1]] = m[2];

  // The drawings: every const PIECE_SVG_*, named after the first set that uses it.
  const consts = {};
  for (const m of page.matchAll(/^ {2}const (PIECE_SVG_[A-Z0-9_]+) = (\{.*\});[ \t]*$/gm)) {
    if (own(consts, m[1])) fail(m[1], 'is declared twice');
    consts[m[1]] = m[2];
  }
  const owner = {};
  const shared = {};
  for (const [set, name] of Object.entries(setConsts)) {
    if (!own(consts, name)) fail('PIECE_SETS', `${set} uses ${name}, which isn't a "const PIECE_SVG_… = {…};" line`);
    if (!own(owner, name)) owner[name] = set;
    shared[set] = owner[name];
  }
  const art = {};
  for (const [name, set] of Object.entries(owner)) {
    let json;
    try {
      json = JSON.parse(consts[name]);
    } catch (err) {
      fail(name, `isn't JSON (${err.message})`);
    }
    if (json == null || typeof json !== 'object' || Array.isArray(json)) fail(name, 'isn\'t an object of drawings');
    const codes = Object.keys(json);
    const missing = PIECE_CODES.filter((c) => !codes.includes(c));
    const extra = codes.filter((c) => !PIECE_CODES.includes(c));
    if (missing.length || extra.length) {
      fail(name, `has the wrong pieces${missing.length ? ` (no ${missing.join(', ')})` : ''}${extra.length ? ` (also ${extra.join(', ')})` : ''}`);
    }
    art[set] = {};
    for (const code of codes) {
      if (typeof json[code] !== 'string') fail(name, `${code} isn't an <svg> string`);
      art[set][code] = svgToTree(json[code], `${name}.${code}`);
    }
  }

  const css = cssRules(page);
  const tokens = pieceTokens(css);
  const rim = rimCream(styleText(page));

  // The pieces fit together: every set in the row is drawn, named and described;
  // every theme's own set is one of them.
  for (const k of order) {
    if (!own(shared, k)) fail('PIECE_SETS', `has no drawings for ${k}, which #piece-style-row offers`);
    if (!own(hints, k) || !hints[k].trim()) fail('PIECE_STYLE_HINTS', `has no description of ${k}`);
  }
  for (const [skin, set] of Object.entries(defaults)) {
    if (!order.includes(set)) fail('PIECE_STYLE_DEFAULTS', `gives ${skin} ${set}, which #piece-style-row doesn't offer`);
  }

  const missingThemes = themes.filter((t) => !skins.includes(t));
  return { order, labels, hints, defaults, skins, shared, art, tokens, rim, missingThemes };
}

// Which piece CSS of the page is which: every rule about a piece (its selector
// names .piece-wrap, data-pset=, .promo-picker or .pz-turn-icon) whole, and from
// any other rule only the piece colors it sets (--pw-*, --ccs-*, --crown-*).
// Grouped by the set it's for (data-pset="X" → set:X), else the theme
// (data-skin="X" → theme:X), else base — what's inside :not(…) doesn't count —
// and each group hashed, so a change reads as "the Court Cards set's CSS moved".
// → { [group]: sha256 }, groups sorted.
const PIECE_SELECTOR = /\.piece-wrap|data-pset=|\.promo-picker|\.pz-turn-icon/;
const PIECE_DECL = /^--(pw-|ccs-|crown-)/;
function withoutNot(selector) {
  let out = '';
  for (let i = 0; i < selector.length; i += 1) {
    if (selector.startsWith(':not(', i)) {
      let depth = 0;
      for (let j = i + 4; j < selector.length; j += 1) {
        if (selector[j] === '(') depth += 1;
        else if (selector[j] === ')' && (depth -= 1) === 0) { i = j; break; }
      }
      continue;
    }
    out += selector[i];
  }
  return out;
}
export function pieceCssGroups(html) {
  const groups = {};
  for (const rule of cssRules(html)) {
    const whole = PIECE_SELECTOR.test(rule.selector);
    const ds = declarations(rule.body).filter(([n]) => whole || PIECE_DECL.test(n));
    if (!whole && !ds.length) continue;
    const plain = withoutNot(rule.selector);
    const set = plain.match(/data-pset="(\w+)"/);
    const skin = plain.match(/data-skin="(\w+)"/);
    const key = set ? `set:${set[1]}` : skin ? `theme:${skin[1]}` : 'base';
    (groups[key] ??= []).push(`${[...rule.at, rule.selector].join(' ')}{${ds.map(([n, v]) => `${n}:${v}`).join(';')}}`);
  }
  return Object.fromEntries(Object.keys(groups).sort().map((k) => [k, sha256(groups[k].join('\n'))]));
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// What the generated module holds, by the names it exports.
export function dataFromModule(mod) {
  return {
    order: mod.PIECE_STYLE_ORDER, labels: mod.PIECE_STYLE_LABELS, hints: mod.PIECE_STYLE_HINTS,
    defaults: mod.PIECE_STYLE_DEFAULTS, skins: mod.ARCADE_SKINS, shared: mod.PIECE_SHARED,
    tokens: mod.PIECE_TOKENS, rim: mod.RIM_CREAM, art: mod.PIECE_ART,
  };
}

// Leaves Default's drawings out: Repertoire Lab draws Default (and Court Cards)
// with its own TREES.
const artOf = (data) => Object.fromEntries(Object.entries(data.art ?? {}).filter(([set]) => set !== 'default'));

// One fingerprint of everything the module holds: the sha256 (hex) of
// { order, labels, hints, defaults, skins, shared, tokens, rim, art }, keys in
// that order, art without Default's.
export function pieceDataSha(data) {
  const { order, labels, hints, defaults, skins, shared, tokens, rim } = data;
  return sha256(JSON.stringify({ order, labels, hints, defaults, skins, shared, tokens, rim, art: artOf(data) }));
}

// What moved between two readings (the module's, then Chess Arcade's), in words.
export function describeDrift(was, now) {
  const out = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const keys = (a, b) => [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
  const show = (v) => (v === undefined ? 'nothing' : typeof v === 'string' ? v : JSON.stringify(v));
  if (!same(was.order, now.order)) out.push(`the sets or their order: ${show(was.order?.join(', '))} in pieceArt.gen.js, ${show(now.order?.join(', '))} in Chess Arcade`);
  const changedKeys = (field) => keys(was[field], now[field]).filter((k) => !same(was[field]?.[k], now[field]?.[k]));
  const labels = changedKeys('labels');
  if (labels.length) out.push(`the names of ${labels.join(', ')}`);
  const hints = changedKeys('hints');
  if (hints.length) out.push(`the descriptions of ${hints.join(', ')}`);
  for (const k of changedKeys('defaults')) out.push(`${k}'s own set: ${show(was.defaults?.[k])} in pieceArt.gen.js, ${show(now.defaults?.[k])} in Chess Arcade`);
  if (!same(was.skins, now.skins)) out.push(`the themes: ${show(was.skins?.join(', '))} in pieceArt.gen.js, ${show(now.skins?.join(', '))} in Chess Arcade`);
  const shared = changedKeys('shared');
  if (shared.length) out.push(`which drawings ${shared.join(', ')} use${shared.length === 1 ? 's' : ''}`);
  const tokens = changedKeys('tokens');
  if (tokens.length) out.push(`the piece colors of ${tokens.join(', ')}`);
  if (!same(was.rim, now.rim)) out.push(`Rim Light's cream: ${show(was.rim)} in pieceArt.gen.js, ${show(now.rim)} in Chess Arcade`);
  const wa = artOf(was);
  const na = artOf(now);
  for (const set of keys(wa, na)) {
    if (same(wa[set], na[set])) continue;
    const codes = keys(wa[set], na[set]).filter((c) => !same(wa[set]?.[c], na[set]?.[c]));
    out.push(`the drawings of ${set}${codes.length && codes.length < 12 ? ` (${codes.join(', ')})` : ''}`);
  }
  return out;
}

// The text of src/lib/pieceArt.gen.js: deterministic (keys in source order,
// JSON with no spaces, one drawing per line, a trailing newline), so running
// the sync twice changes nothing.
export function pieceArtModule(data, from) {
  const j = (v) => JSON.stringify(v);
  const art = artOf(data);
  const artText = Object.entries(art).map(([set, codes]) => `  ${j(set)}: {\n${Object.entries(codes).map(([code, tree]) => `    ${j(code)}: ${j(tree)},`).join('\n')}\n  },`).join('\n');
  return `// Written by \`npm run sync:pieces\` (scripts/sync-pieces.mjs, scripts/lib/arcadePieces.mjs) from the Chess Arcade
// page named below. Don't edit. The hourly sync never rewrites it: Repertoire Lab's own boards change only with an
// RL change that gets screenshots. \`npm run check:pieces\` says when Chess Arcade has moved ahead of it.
//
// What's here is Chess Arcade's, word for word: its sets in the order its Settings row offers them, their names and
// descriptions, each theme's own set, which drawings each set uses (Court Cards uses Default's), each theme's piece
// colors (--pw-white-fill, --pw-black-fill, --pw-stroke; by day and at night), Rim Light's cream, and the drawings
// of every set that isn't drawn with Repertoire Lab's own Cburnett TREES (src/lib/pieces.jsx) — as trees, so nothing
// is parsed at run time. Which of them Repertoire Lab offers is src/lib/pieceStyles.js's RL_PIECE_STYLES.
export const PIECE_ART_FROM = ${j(String(from ?? ''))}; // information only
export const PIECE_DATA_SHA = ${j(pieceDataSha(data))}; // pieceDataSha() of everything below
export const PIECE_STYLE_ORDER = ${j(data.order)};
export const PIECE_STYLE_LABELS = ${j(data.labels)};
export const PIECE_STYLE_HINTS = ${j(data.hints)};
export const PIECE_STYLE_DEFAULTS = ${j(data.defaults)};
export const ARCADE_SKINS = ${j(data.skins)};
export const PIECE_SHARED = ${j(data.shared)};
export const PIECE_TOKENS = ${j(data.tokens)};
export const RIM_CREAM = ${j(data.rim)};
export const PIECE_ART = {
${artText}
};
`;
}
