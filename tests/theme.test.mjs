// Dark | Light | Auto | System (Settings, Appearance) — src/lib/theme.js: which palette each choice shows, System following
// the device (prefers-color-scheme) as it turns, and the boards and the Game Review frame taking the resolved one.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTheme, systemTheme, watchSystemTheme, themeForHour, boardColors, applyTheme, applySkin,
} from '../src/lib/theme.js';
import { SKINS } from '../src/lib/skins.js';
import { DEFAULT_SETTINGS } from '../src/lib/settingsDefaults.js';

// A device: light or dark, that can turn; listeners counted.
function device(light, { old = false } = {}) {
  const heard = new Set();
  const mq = {
    get matches() { return light; },
    ...(old
      ? { addListener: (f) => heard.add(f), removeListener: (f) => heard.delete(f) }
      : { addEventListener: (t, f) => t === 'change' && heard.add(f), removeEventListener: (t, f) => heard.delete(f) }),
  };
  globalThis.matchMedia = (q) => { assert.equal(q, '(prefers-color-scheme: light)'); return mq; };
  return { turn: (l) => { light = l; [...heard].forEach((f) => f({ matches: l })); }, heard };
}
afterEach(() => { delete globalThis.matchMedia; delete globalThis.document; });

const noon = new Date(2026, 10, 24, 12);
const night = new Date(2026, 10, 24, 23);

test('a new account is dark, as before; the fixed choices and Auto never ask the device', () => {
  globalThis.matchMedia = () => { throw new Error('asked the device'); };
  assert.equal(DEFAULT_SETTINGS.theme, 'dark');
  assert.equal(resolveTheme(undefined), 'dark');
  assert.equal(resolveTheme({ theme: 'dark' }), 'dark');
  assert.equal(resolveTheme({ theme: 'light' }), 'light');
  assert.equal(resolveTheme({ theme: 'auto' }, noon), 'light');
  assert.equal(resolveTheme({ theme: 'auto' }, night), 'dark');
  assert.equal(resolveTheme({ theme: 'auto', lightFrom: 20, darkFrom: 8 }, night), 'light');
  assert.equal(themeForHour(12, 7, 7), 'dark');
});

test('System is the device’s own, whatever the clock says, and turns with it', () => {
  const d = device(true);
  assert.equal(systemTheme(), 'light');
  assert.equal(resolveTheme({ theme: 'system' }, night), 'light');
  d.turn(false);
  assert.equal(resolveTheme({ theme: 'system' }, noon), 'dark');
  assert.equal(resolveTheme({ theme: 'system', lightFrom: 0, darkFrom: 23 }, noon), 'dark');
});

test('System where the browser can’t say is dark, and watching it is nothing', () => {
  assert.equal(resolveTheme({ theme: 'system' }), 'dark');
  watchSystemTheme(() => assert.fail())();
  globalThis.matchMedia = () => { throw new Error('no'); };
  assert.equal(resolveTheme({ theme: 'system' }), 'dark');
  watchSystemTheme(() => assert.fail())();
});

test('watchSystemTheme: called at each turn, until it’s stopped (and in a Safari without addEventListener)', () => {
  for (const old of [false, true]) {
    const d = device(true, { old });
    let n = 0;
    const stop = watchSystemTheme(() => { n += 1; });
    d.turn(false);
    d.turn(true);
    assert.equal(n, 2);
    stop();
    d.turn(false);
    assert.equal(n, 2);
    assert.equal(d.heard.size, 0);
  }
});

test('the boards take the resolved palette: System on a dark device is the theme’s dark board', () => {
  const d = device(false);
  for (const id of Object.keys(SKINS)) {
    assert.deepEqual(boardColors({ skin: id, theme: 'system' }), boardColors({ skin: id, theme: 'dark' }), id);
    d.turn(true);
    assert.deepEqual(boardColors({ skin: id, theme: 'system' }), boardColors({ skin: id, theme: 'light' }), id);
    d.turn(false);
  }
});

test('the page only ever wears light or dark (what the Game Review frame is handed), never the word system', () => {
  const props = {};
  const html = {
    dataset: {}, style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } },
    classList: { toggle() {} }, removeAttribute: (a) => { delete html.dataset[a.replace('data-', '')]; },
  };
  globalThis.document = { documentElement: html, querySelector: () => null };
  const d = device(true);
  const s = { theme: 'system', skin: 'cards' };
  for (const l of [true, false, true]) {
    d.turn(l);
    const mode = resolveTheme(s);
    applyTheme(mode);
    applySkin(s, mode);
    assert.equal(html.dataset.theme, l ? 'light' : 'dark');
    assert.equal(props['--bg'], SKINS.cards[l ? 'light' : 'dark']['--bg']);
  }
});
