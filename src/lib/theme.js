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

// A custom background picture, painted behind everything by two fixed layers in
// styles.css. The veil over it is what keeps text readable — without one, a
// busy photo makes the whole app hard to read, so its strength is a setting
// rather than a fixed value.
export function applyBackground(settings) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const image = settings?.background;
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
