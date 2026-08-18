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
