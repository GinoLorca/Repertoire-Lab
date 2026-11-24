import { SKINS, SKIN_TOKENS, skinId } from './skins';
import {
  DEFAULT_PIECE_LIGHT, DEFAULT_PIECE_DARK, DEFAULT_SET_INKS, CA_DEFAULT_INKS, PIECE_TOKEN_NAMES, pieceStyleOf, drawnByTrees,
  pieceTokens,
} from './pieceStyles';

// Which palette 'auto' should be showing right now. Light during the day,
// dark in the evening — the boundaries are settings so they can be tuned.
export function themeForHour(hour, lightFrom = 7, darkFrom = 19) {
  if (lightFrom === darkFrom) return 'dark';
  if (lightFrom < darkFrom) return hour >= lightFrom && hour < darkFrom ? 'light' : 'dark';
  // Wrapped window (e.g. light from 19:00 to 07:00) — rare, but honour it.
  return hour >= lightFrom || hour < darkFrom ? 'light' : 'dark';
}

// Which palette 'system' should be showing: the device's own light or dark
// setting. Dark, the app's own default, where the browser can't say.
const deviceLight = () => {
  try { return globalThis.matchMedia?.('(prefers-color-scheme: light)') ?? null; } catch { return null; }
};
export const systemTheme = () => (deviceLight()?.matches ? 'light' : 'dark');

// Calls back whenever the device turns light or dark; returns the way to stop.
export function watchSystemTheme(turned) {
  const mq = deviceLight();
  if (!mq) return () => {};
  if (!mq.addEventListener) { // Safari before 14
    mq.addListener?.(turned);
    return () => mq.removeListener?.(turned);
  }
  mq.addEventListener('change', turned);
  return () => mq.removeEventListener('change', turned);
}

export function resolveTheme(settings, now = new Date()) {
  const mode = settings?.theme ?? 'dark';
  if (mode === 'system') return systemTheme();
  if (mode !== 'auto') return mode;
  return themeForHour(now.getHours(), settings?.lightFrom ?? 7, settings?.darkFrom ?? 19);
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  // Keeps the iOS status bar and browser chrome in step with the page.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f6fa' : '#14171d');
}

// A skin from Chess Arcade, painted over the palette as inline custom
// properties on <html>. Inline beats the stylesheet's own :root, so a skin
// needs no extra CSS of its own and every rule in the app — which all read
// these tokens already — follows without being touched.
//
// Custom removes them all instead, which is why it looks like the app always
// has: there is nothing between the stylesheet and the page.
//
// The piece set goes on <html> too, with every theme and Custom: data-pset
// names the set the boards draw (lib/pieceStyles' pieceStyleOf), for rules
// about a square rather than the drawing (those key on the piece's own
// data-ps) and for the Game Review frame to follow. A theme's piece colors
// (--pw-white-fill, --pw-black-fill, --pw-stroke: Chess Arcade's, or Custom's
// White and Black) go inline beside its tokens; one it doesn't give is
// removed, so each set's own color shows.
export function applySkin(settings, theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const skin = SKINS[settings?.skin];
  // The wallpaper is part of the theme but not everyone wants a picture
  // behind their repertoire — off leaves the palette and drops the floor.
  root.classList.toggle('no-skin-wall', settings?.skinWallpaper === false);
  // Every theme ships artwork; one switched to its pattern (per theme, in
  // skinArtOff) shows the pattern underneath instead.
  root.classList.toggle('skin-pattern', !!(skin && settings?.skinArtOff?.[skin.id]));
  root.dataset.pset = pieceStyleOf(settings);
  // Q3's switch, its shadow half: with Chess Arcade's inks for the Default
  // set, its shadow too (styles.css, the @pieces block).
  if (DEFAULT_SET_INKS === 'ca') root.dataset.pinks = 'ca';
  else root.removeAttribute('data-pinks');
  const pieceInks = pieceTokens(settings, skinId(settings), theme);
  for (const name of PIECE_TOKEN_NAMES) {
    if (pieceInks[name]) root.style.setProperty(name, pieceInks[name]);
    else root.style.removeProperty(name);
  }
  if (!skin) {
    root.removeAttribute('data-skin');
    for (const token of SKIN_TOKENS) root.style.removeProperty(token);
    return;
  }
  const palette = skin[theme] ?? skin.dark;
  root.dataset.skin = skin.id;
  for (const token of SKIN_TOKENS) {
    if (palette[token]) root.style.setProperty(token, palette[token]);
    else root.style.removeProperty(token);
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && palette['--bg']) meta.setAttribute('content', palette['--bg']);
}

// What the boards should actually be painted in. A skin brings its own board
// and pieces; Custom uses the colours set in Settings, falling back to the
// built-in pair. Everything that draws a board goes through here so the two
// can never disagree.
export function boardColors(settings, theme = resolveTheme(settings)) {
  const skin = SKINS[settings?.skin];
  if (skin) {
    const palette = skin[theme] ?? skin.dark;
    return {
      squareLight: palette.boardLight,
      squareDark: palette.boardDark,
      pieceLight: palette.pieceLight,
      pieceDark: palette.pieceDark,
    };
  }
  return {
    squareLight: settings?.squareLight ?? null,
    squareDark: settings?.squareDark ?? null,
    pieceLight: settings?.pieceLight ?? null,
    pieceDark: settings?.pieceDark ?? null,
  };
}

// The pieces the boards should be drawn with, for lib/pieces (piecesFor,
// pieceImage): { set, skin, light, dark, tokens }. Like boardColors, every
// board goes through here, so a board, its promotion picker, the editor's tray
// and a Moments ghost can never disagree.
//   · set: the pick kept for this theme, else the theme's own (pieceStyleOf);
//   · light / dark: the inks of a set drawn with Repertoire Lab's TREES, the
//     board's own (boardColors, or react-chessboard's #fff / #000). The Court
//     Cards set on another theme keeps the Court Cards theme's inks, so it
//     looks the same wherever it's picked. null for Chess Arcade's drawings,
//     whose colors come from CSS;
//   · tokens: the theme's piece colors (pieceTokens), as applySkin puts them
//     on <html>, for pictures that can't read them there;
//   · inks: 'ca' only on a Default set drawn in Chess Arcade's colors (below),
//     so its pictures take the theme's drawing filter as the board's CSS does.
// `defaultInks` is Q3's switch (pieceStyles' DEFAULT_SET_INKS): 'ca' draws the
// Default set on a theme in Chess Arcade's colors instead of Repertoire Lab's.
// A theme ink that is a variable keeps its variable, with Chess Arcade's color
// as the fallback: Uptown's var(--ux-pl, …) is what draws each Black piece's
// detail lines (and the knight's mane) in its line's color, as Chess Arcade's
// --pw-detail does there.
const keepVar = (ink, color) => {
  const m = typeof ink === 'string' ? /^var\(\s*(--[\w-]+)\s*,/.exec(ink) : null;
  return m ? `var(${m[1]}, ${color})` : color;
};
export function boardPieces(settings, theme = resolveTheme(settings), defaultInks = DEFAULT_SET_INKS) {
  const skin = skinId(settings);
  const set = pieceStyleOf(settings, skin);
  const tokens = pieceTokens(settings, skin, theme);
  let light = null;
  let dark = null;
  let caInks = false;
  if (drawnByTrees(set)) {
    let inks = boardColors(settings, theme);
    if (set === 'courtCards' && skin !== 'cards') inks = SKINS.cards[theme] ?? SKINS.cards.dark;
    else if (set === 'default' && skin !== 'custom' && defaultInks === 'ca') {
      inks = {
        pieceLight: keepVar(inks.pieceLight, tokens['--pw-white-fill'] ?? CA_DEFAULT_INKS.white),
        pieceDark: keepVar(inks.pieceDark, tokens['--pw-black-fill'] ?? CA_DEFAULT_INKS.black),
      };
      caInks = true;
    }
    light = inks.pieceLight ?? DEFAULT_PIECE_LIGHT;
    dark = inks.pieceDark ?? DEFAULT_PIECE_DARK;
  }
  return caInks ? { set, skin, light, dark, tokens, inks: 'ca' } : { set, skin, light, dark, tokens };
}

// A custom background picture, painted behind everything by two fixed layers in
// styles.css. The veil over it is what keeps text readable — without one, a
// busy photo makes the whole app hard to read, so its strength is a setting
// rather than a fixed value.
// Your own picture, per theme. A photo chosen to sit behind Outer Space has no
// business behind Tournament Felt — and more to the point, one picture pinned
// across every theme means picking a theme can never change the wallpaper,
// which is the whole point of the theme having one.
//
// Settings written before this was per theme kept a single `background`. That
// picture belongs to Custom: it's the theme those settings were wearing.
export function backgroundFor(settings) {
  const id = SKINS[settings?.skin] ? settings.skin : 'custom';
  const map = settings?.backgrounds;
  if (map && Object.prototype.hasOwnProperty.call(map, id)) return map[id] ?? null;
  return id === 'custom' ? (settings?.background ?? null) : null;
}

export function applyBackground(settings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const image = backgroundFor(settings);
  root.classList.toggle('has-custom-bg', !!image);
  if (image) {
    root.style.setProperty('--custom-bg', `url("${image}")`);
    root.style.setProperty('--custom-bg-veil', String((settings?.backgroundVeil ?? 70) / 100));
    // How solid the cards and boards sitting on the picture are. Kept as a
    // percentage for color-mix, which is what lets a flat palette colour become
    // translucent without rewriting every swatch as rgba.
    root.style.setProperty('--surface-opacity', `${settings?.surfaceOpacity ?? 100}%`);
    root.style.setProperty('--board-opacity', String((settings?.boardOpacity ?? 100) / 100));
  } else {
    root.style.removeProperty('--custom-bg');
    root.style.removeProperty('--custom-bg-veil');
    root.style.removeProperty('--surface-opacity');
    root.style.removeProperty('--board-opacity');
  }
}
