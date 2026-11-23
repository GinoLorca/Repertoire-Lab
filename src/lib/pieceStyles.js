// Chess Arcade's piece styles, in Repertoire Lab: which set a board draws on
// each theme, and the numbers behind how it's drawn. Pure, so
// tests/pieceStyles.test.mjs covers it under plain Node.
//
// The sets themselves — names, descriptions, each theme's own set, each
// theme's piece colors, the drawings — are Chess Arcade's, word for word, in
// pieceArt.gen.js (written by hand with `npm run sync:pieces`). What's decided
// here is Repertoire Lab's:
//
//   · which of them it offers (RL_PIECE_STYLES): a set Chess Arcade adds later
//     shows here only once its look has been ported and seen in screenshots;
//   · the pick, kept per theme in settings.pieceStyleBySkin ({ [theme]: set }).
//     It has no default on purpose (see settingsDefaults.js): no entry means
//     "this theme's own set", and picking a theme's own set removes the entry,
//     so a later change to that theme's set reaches you too;
//   · how big a set is drawn in Repertoire Lab's full-square piece box
//     (PIECE_FIT), and, for pictures CSS can't reach (data URLs), each theme's
//     drawing filter as numbers (THEME_DRAWING_FILTERS).
import {
  PIECE_STYLE_ORDER as CA_ORDER, PIECE_STYLE_LABELS, PIECE_STYLE_HINTS, PIECE_STYLE_DEFAULTS, PIECE_SHARED,
  PIECE_TOKENS, RIM_CREAM,
} from './pieceArt.gen.js';
import { SKIN_ORDER, skinId } from './skins';

export { PIECE_STYLE_LABELS, PIECE_STYLE_HINTS };

// The sets Repertoire Lab offers: one appears here only once its look is
// ported and has been seen in screenshots.
export const RL_PIECE_STYLES = ['default', 'wavyCoach', 'rimLight', 'royalMinimal', 'courtCards', 'cardCrown', 'minimalOne', 'minimalTwo'];
// …in Chess Arcade's order, as its Settings row offers them.
export const PIECE_STYLE_ORDER = CA_ORDER.filter((k) => RL_PIECE_STYLES.includes(k));
// The three piece colors a theme can give every set (Chess Arcade's names).
export const PIECE_TOKEN_NAMES = ['--pw-white-fill', '--pw-black-fill', '--pw-stroke'];
// react-chessboard's own two inks for the Cburnett TREES (src/lib/pieces.jsx
// re-exports them): what a board with no inks of its own is drawn in.
export const DEFAULT_PIECE_LIGHT = '#ffffff';
export const DEFAULT_PIECE_DARK = '#000000';
// Q3 (the user decides from side-by-side screenshots): 'rl' draws the Default
// Chess Set in each theme's own Repertoire Lab inks, exactly as today; 'ca' in
// Chess Arcade's: a theme's piece colors where it gives them (PIECE_TOKENS),
// else the cream and brown Chess Arcade's Default set falls back to
// (CA_DEFAULT_INKS, from its PIECE_SVG_DEFAULT). TREES have two inks, so with
// 'ca' White's outline is Black's color, where Chess Arcade has a third
// (--pw-stroke). Custom keeps its own inks either way. (lib/theme boardPieces)
// 'ca' also gives the Default set Chess Arcade's shadow (applySkin puts
// data-pinks="ca" on <html>; styles.css, the @pieces block).
export const DEFAULT_SET_INKS = 'rl';
export const CA_DEFAULT_INKS = { white: '#f4ecd6', black: '#20180c' };
// Every theme a pick can be kept for.
export const PIECE_THEMES = [...SKIN_ORDER, 'custom'];

// Object.prototype.hasOwnProperty, as theme.js has it, not Object.hasOwn: this
// runs as the app starts (applySkin, every board), and the build is for Safari
// 14 (Vite's target, no polyfills), where Object.hasOwn (15.4) isn't there
// (tests/supportFloor.test.mjs keeps it out of src/).
const own = (obj, key) => obj != null && typeof obj === 'object' && typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
const isMap = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

// A set Repertoire Lab offers and Chess Arcade still has. Anything else —
// a set from a newer build, a typo, 'constructor', a number — is not one.
export const isPieceStyle = (k) => typeof k === 'string' && RL_PIECE_STYLES.includes(k) && own(PIECE_STYLE_LABELS, k);

// A theme's own set: Chess Arcade's default for it, if Repertoire Lab offers
// that set; otherwise the Default Chess Set.
export function themePieceStyle(skin, defaults = PIECE_STYLE_DEFAULTS) {
  const set = own(defaults, skin) ? defaults[skin] : undefined;
  return isPieceStyle(set) ? set : 'default';
}

// The set a board draws: the pick kept for this theme, else the theme's own.
export function pieceStyleOf(settings, skin = skinId(settings)) {
  const map = settings?.pieceStyleBySkin;
  const saved = isMap(map) && own(map, skin) ? map[skin] : undefined;
  return isPieceStyle(saved) ? saved : themePieceStyle(skin);
}

// The whole new pieceStyleBySkin after picking `key` on `skin` (setSettings
// merges shallowly, so the map is always written whole). A copy: the settings
// passed in are never changed, and entries for other themes, even ones this
// build doesn't know, are kept. Picking the theme's own set removes its entry
// (follow the theme); a set or theme that isn't one changes nothing.
export function withPieceStyle(settings, skin, key) {
  const map = isMap(settings?.pieceStyleBySkin) ? { ...settings.pieceStyleBySkin } : {};
  if (!isPieceStyle(key) || !PIECE_THEMES.includes(skin)) return map;
  if (key === themePieceStyle(skin)) delete map[skin];
  else map[skin] = key;
  return map;
}

// Which drawings a set uses: Court Cards uses Default's (its look is CSS).
export const drawingOf = (set) => (own(PIECE_SHARED, set) ? PIECE_SHARED[set] : 'default');
// Drawn with Repertoire Lab's own Cburnett TREES (src/lib/pieces.jsx), in the
// theme's inks: the Default and Court Cards sets.
export const drawnByTrees = (set) => drawingOf(set) === 'default';

// A color Custom's piece inks may hold (they go inline on the page): hex,
// rgb()/hsl(), or a plain name. Anything else is no color.
const COLOR = /^(#[0-9a-f]{3,8}|(?:rgba?|hsla?)\([\d\s.,%/+-]+\)|[a-z]+)$/i;
const cssColor = (v) => (typeof v === 'string' && COLOR.test(v.trim()) ? v.trim() : null);

// The piece colors a theme gives every set, as the page's inline variables:
// { '--pw-white-fill', '--pw-black-fill', '--pw-stroke' }, null where it gives
// none (that set's own color shows).
//   · a theme Chess Arcade colors (Drive-Thru, Rosé, Chess Book, Uptown, Court
//     Cards): its colors for this face ('light', else 'dark');
//   · Custom: your White and Black; the outline stays each set's own, as Chess
//     Arcade's Custom keeps it with no outline color (Black's color as the
//     outline would erase Wavy Coach's light rim on Black);
//   · any other theme: none.
export function pieceTokens(settings, skin = skinId(settings), face = 'dark') {
  const out = Object.fromEntries(PIECE_TOKEN_NAMES.map((n) => [n, null]));
  if (skin === 'custom') {
    out['--pw-white-fill'] = cssColor(settings?.pieceLight);
    out['--pw-black-fill'] = cssColor(settings?.pieceDark);
    return out;
  }
  if (!own(PIECE_TOKENS, skin)) return out;
  const t = face === 'light' ? PIECE_TOKENS[skin].light : (PIECE_TOKENS[skin].dark ?? PIECE_TOKENS[skin].light);
  out['--pw-white-fill'] = t?.white ?? null;
  out['--pw-black-fill'] = t?.black ?? null;
  out['--pw-stroke'] = t?.stroke ?? null;
  return out;
}

// ---- colors as literals, for pictures CSS can't reach ------------------------

const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
const channel = (s, max) => (s.endsWith('%') ? (parseFloat(s) / 100) * max : parseFloat(s));
// '#rgb', '#rrggbb' (and with alpha), 'rgb(r, g, b)', 'rgb(r g b / a)', white,
// black → [r, g, b, a] (0-255, alpha 0-1); anything else → null.
export function parseColor(color) {
  if (typeof color !== 'string') return null;
  const c = color.trim().toLowerCase();
  if (own(NAMED, c)) return [...NAMED[c]];
  let m = c.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    const h = m[1].length <= 4 ? [...m[1]].map((x) => x + x).join('') : m[1];
    const v = [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255));
    return [v[0], v[1], v[2], v[3] / 255];
  }
  m = c.match(/^rgba?\(\s*([^)]*)\)$/);
  if (!m) return null;
  const parts = m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4 || parts.some((p) => !/^-?(\d+\.?\d*|\.\d+)%?$/.test(p))) return null;
  const [r, g, b] = parts.slice(0, 3).map((p) => channel(p, 255));
  const a = parts[3] === undefined ? 1 : channel(parts[3], 1);
  return [r, g, b, a];
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const formatColor = ([r, g, b, a]) => {
  const [R, G, B] = [r, g, b].map((v) => Math.round(clamp(v, 0, 255)));
  return a < 1 ? `rgba(${R}, ${G}, ${B}, ${Math.round(a * 1000) / 1000})` : `rgb(${R}, ${G}, ${B})`;
};

// Rim Light's cream for a theme's White, as Chess Arcade works it out:
// rgb(from var(--pw-white-fill, #fff) calc(r * .957) calc(g * .925) calc(b * .839)).
// No White (or one that isn't a color) → the cream of Chess Arcade's own #fff.
export function rimCream(white) {
  const c = parseColor(white ?? RIM_CREAM.base) ?? parseColor(RIM_CREAM.base);
  return formatColor([c[0] * RIM_CREAM.r, c[1] * RIM_CREAM.g, c[2] * RIM_CREAM.b, c[3]]);
}

// Splits 'var(--name, fallback)' at the top level: [start, end, name, fallback|null].
function nextVar(text, from) {
  const at = text.indexOf('var(', from);
  if (at < 0) return null;
  let depth = 0;
  let comma = -1;
  for (let i = at + 3; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        const inner = text.slice(at + 4, i);
        const name = (comma < 0 ? inner : text.slice(at + 4, comma)).trim();
        return [at, i + 1, name, comma < 0 ? null : text.slice(comma + 1, i).trim()];
      }
    } else if (text[i] === ',' && depth === 1 && comma < 0) comma = i;
  }
  return null;
}

// A drawing's style value with every var() made literal, for a picture CSS
// can't reach: a theme piece color from `tokens` (pieceTokens), or the
// drawing's own fallback; --pw-rim-white is Rim Light's cream of the White in
// `tokens`; --crown-* (Card Crown's own colors) and anything else, the
// fallback. A var() with no fallback and no value is 'inherit', as in a
// browser. Values without var() come back as they are.
export function literalColor(value, tokens = {}, depth = 0) {
  if (typeof value !== 'string' || !value.includes('var(') || depth > 8) return value;
  const token = (n) => (own(tokens, n) && typeof tokens[n] === 'string' && tokens[n] ? tokens[n] : null);
  let out = '';
  let from = 0;
  for (let v = nextVar(value, 0); v; v = nextVar(value, from)) {
    const [start, end, name, fallback] = v;
    let lit;
    if (name === '--pw-rim-white') lit = rimCream(token('--pw-white-fill'));
    else if (PIECE_TOKEN_NAMES.includes(name) && token(name)) lit = token(name);
    else lit = fallback ?? 'inherit';
    out += value.slice(from, start) + literalColor(lit, tokens, depth + 1);
    from = end;
  }
  return out + value.slice(from);
}

// ---- sizes ---------------------------------------------------------------------

// Q13 (the user decides from side-by-side screenshots): 'rl' draws a set at
// Repertoire Lab's own piece size (about 88% of the square, standing where
// RL's Cburnett pieces stand), so switching sets doesn't make pieces jump;
// 'ca' draws it exactly as Chess Arcade does (80% of the square, centered).
export const PIECE_FIT_MODE = 'rl';
// Where RL's Cburnett base line sits in its square (87-90%).
export const FIT_BASE = 0.89;
// How big each set Chess Arcade draws is drawn in RL's full-square piece box:
// `scale` of the square, and `base`, the set's lowest painted y in its 100 box,
// outlines included (measured by the UI kit, test-kits/repertoire-lab/pieces,
// section fit, 2026-11-22: the drawings rasterized in the browser). Wavy Coach's
// king is a fifth bigger than its other pieces (Chess Arcade's drawing: its
// base hangs ten units lower), so that set is drawn a little smaller, which
// keeps the king's cross 3.5% inside the top of the square; its other pieces
// stand above the king's base, as in Chess Arcade. Sets drawn with TREES are
// never fitted.
export const PIECE_FIT = {
  wavyCoach: { scale: 0.85, base: 100.05 },
  rimLight: { scale: 0.88, base: 92.35 },
  royalMinimal: { scale: 0.88, base: 92 },
  cardCrown: { scale: 0.88, base: 92.35 },
  minimalOne: { scale: 0.88, base: 92 },
  minimalTwo: { scale: 0.88, base: 92 },
};
const CA_SCALE = 0.8;
const round2 = (v) => Math.round(v * 100) / 100;

// The viewBox an art set is drawn with, so it sits in RL's square as PIECE_FIT
// says: a box w = 100 / scale wide, centered across, with `base` at FIT_BASE
// of the way down. null for a TREES set or one with no fit.
export function fitViewBox(set, mode = PIECE_FIT_MODE) {
  if (drawnByTrees(set) || !own(PIECE_FIT, set)) return null;
  if (mode === 'ca') {
    const w = 100 / CA_SCALE;
    return `${round2(50 - w / 2)} ${round2(50 - w / 2)} ${round2(w)} ${round2(w)}`;
  }
  const { scale, base } = PIECE_FIT[set];
  const w = 100 / scale;
  return `${round2(50 - w / 2)} ${round2(base - FIT_BASE * w)} ${round2(w)} ${round2(w)}`;
}

// ---- theme filters as numbers ----------------------------------------------------

// The theme drawing filters, as numbers, for pictures CSS can't reach (data
// URLs): each theme's filter on a piece's drawing, its drop-shadows left out.
// Must equal src/styles.css (tests/pieceStyles.test.mjs checks).
export const THEME_DRAWING_FILTERS = {
  gameboy: [['sepia', 1], ['saturate', 6], ['hueRotate', 45], ['brightness', 0.75], ['contrast', 1.1]],
  hustler: [['grayscale', 0.92], ['contrast', 1.12], ['brightness', 1.03], ['saturate', 0.85]], // the art sets' rule
  outerspace: [['sepia', 0.3], ['saturate', 1.5], ['hueRotate', -6], ['contrast', 1.1], ['brightness', 1.03]], // no glow
};

// A CSS filter list → steps like THEME_DRAWING_FILTERS's, drop-shadow() and
// url() left out: 'sepia(1) hue-rotate(45deg) drop-shadow(…)' →
// [['sepia', 1], ['hueRotate', 45]]. Amounts in % become fractions; hue-rotate
// in degrees (deg, turn, rad, grad).
export function parseFilter(text) {
  const out = [];
  const src = String(text ?? '');
  for (let i = 0; i < src.length;) {
    const m = src.slice(i).match(/^\s*([a-z-]+)\(/i);
    if (!m) break;
    let depth = 0;
    let end = i + m[0].length - 1;
    for (; end < src.length; end += 1) {
      if (src[end] === '(') depth += 1;
      else if (src[end] === ')' && (depth -= 1) === 0) break;
    }
    const name = m[1].toLowerCase();
    const arg = src.slice(i + m[0].length, end).trim();
    i = end + 1;
    if (name === 'drop-shadow' || name === 'url') continue;
    if (name === 'hue-rotate') {
      const a = arg.match(/^(-?\d*\.?\d+)(deg|turn|rad|grad)?$/);
      const k = { deg: 1, turn: 360, rad: 180 / Math.PI, grad: 0.9 }[a?.[2] ?? 'deg'];
      out.push(['hueRotate', a ? Number(a[1]) * k : NaN]);
    } else {
      out.push([name.replace(/-([a-z])/g, (x, c) => c.toUpperCase()), arg === '' ? 1 : arg.endsWith('%') ? parseFloat(arg) / 100 : Number(arg)]);
    }
  }
  return out;
}

// The Filter Effects spec's matrices, in sRGB, as browsers apply CSS filter
// functions: each a 3x4 matrix (rgb rows, then an offset) on 0-1 channels.
const lerpRow = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function stepMatrix(name, s) {
  switch (name) {
    case 'grayscale': {
      const t = 1 - clamp(s, 0, 1);
      return [
        [0.2126 + 0.7874 * t, 0.7152 - 0.7152 * t, 0.0722 - 0.0722 * t, 0],
        [0.2126 - 0.2126 * t, 0.7152 + 0.2848 * t, 0.0722 - 0.0722 * t, 0],
        [0.2126 - 0.2126 * t, 0.7152 - 0.7152 * t, 0.0722 + 0.9278 * t, 0],
      ];
    }
    case 'sepia': {
      const t = 1 - clamp(s, 0, 1);
      return [
        [0.393 + 0.607 * t, 0.769 - 0.769 * t, 0.189 - 0.189 * t, 0],
        [0.349 - 0.349 * t, 0.686 + 0.314 * t, 0.168 - 0.168 * t, 0],
        [0.272 - 0.272 * t, 0.534 - 0.534 * t, 0.131 + 0.869 * t, 0],
      ];
    }
    case 'saturate':
      return [
        [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0],
        [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0],
        [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0],
      ];
    case 'hueRotate': {
      const a = (s * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      return [
        [0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928, 0],
        [0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283, 0],
        [0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072, 0],
      ];
    }
    case 'brightness':
      return [[s, 0, 0, 0], [0, s, 0, 0], [0, 0, s, 0]];
    case 'contrast':
      return [[s, 0, 0, 0.5 - 0.5 * s], [0, s, 0, 0.5 - 0.5 * s], [0, 0, s, 0.5 - 0.5 * s]];
    case 'invert': {
      const t = clamp(s, 0, 1);
      return [lerpRow([1, 0, 0, 0], [-1, 0, 0, 1], t), lerpRow([0, 1, 0, 0], [0, -1, 0, 1], t), lerpRow([0, 0, 1, 0], [0, 0, -1, 1], t)];
    }
    default:
      throw new Error(`pieceStyles: no matrix for the ${name} filter`);
  }
}

// A literal color through a theme's drawing filter: '#rrggbb' | 'rgb(…)' →
// 'rgb(r, g, b)', each step's matrix applied in sRGB and clamped to [0, 1]
// after each step (as browsers do), rounded at the end. Anything that isn't a
// plain color (none, url(#…), currentColor) comes back as it is.
export function filterColor(color, steps) {
  const c = parseColor(color);
  if (!c || !Array.isArray(steps) || !steps.length) return color;
  let v = [c[0] / 255, c[1] / 255, c[2] / 255];
  for (const [name, amount] of steps) {
    const m = stepMatrix(name, amount);
    v = m.map((row) => clamp(row[0] * v[0] + row[1] * v[1] + row[2] * v[2] + row[3], 0, 1));
  }
  return formatColor([v[0] * 255, v[1] * 255, v[2] * 255, c[3]]);
}
