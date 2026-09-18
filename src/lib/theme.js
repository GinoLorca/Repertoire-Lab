import { SKINS, SKIN_TOKENS } from './skins';

// Which palette 'auto' should be showing right now. Light during the day,
// dark in the evening — the boundaries are settings so they can be tuned.
export function themeForHour(hour, lightFrom = 7, darkFrom = 19) {
  if (lightFrom === darkFrom) return 'dark';
  if (lightFrom < darkFrom) return hour >= lightFrom && hour < darkFrom ? 'light' : 'dark';
  // Wrapped window (e.g. light from 19:00 to 07:00) — rare, but honour it.
  return hour >= lightFrom || hour < darkFrom ? 'light' : 'dark';
}

export function resolveTheme(settings, now = new Date()) {
  const mode = settings?.theme ?? 'dark';
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
export function applySkin(settings, theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const skin = SKINS[settings?.skin];
  // The wallpaper is part of the theme but not everyone wants a picture
  // behind their repertoire — off leaves the palette and drops the floor.
  root.classList.toggle('no-skin-wall', settings?.skinWallpaper === false);
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
