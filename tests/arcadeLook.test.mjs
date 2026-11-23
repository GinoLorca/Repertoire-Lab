// What Repertoire Lab hands Chess Arcade's frames as its look (src/lib/arcadeLook.js currentLook): the theme, its
// colors, and the piece set its boards draw, by name, as lib/theme.js paints it on <html> (data-pset); Custom's
// outline only for a set drawn in two inks (the Default and Court Cards sets), so every other set keeps its own.
// scripts/check-arcade.mjs checks the frame's side in a browser; this is the page's side, under plain Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// arcadeLook.js's hook reads the store; currentLook doesn't, so the store is a stand-in here (store.jsx brings the
// whole app with it).
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '../store' && context.parentURL?.endsWith('/src/lib/arcadeLook.js')) {
      return { url: 'data:text/javascript,export const useStore = () => ({ state: { settings: {} } });', shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { currentLook } = await import('../src/lib/arcadeLook.js');

// A page: <html>'s data attributes and the computed tokens currentLook reads.
function page(dataset) {
  globalThis.document = { documentElement: { dataset } };
  globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => ({ '--accent': '#3fb950', '--bg': '#14171d', '--panel': '#1c2028' }[n] ?? '') });
}
const CUSTOM = { skin: 'custom', theme: 'dark', squareLight: '#e9dcc0', squareDark: '#7b5a3c', pieceLight: '#f1e6cf', pieceDark: '#2b1d12' };

test('the set goes across by name: the one <html data-pset> names, Default when nothing is painted', () => {
  page({ skin: 'gameboy', theme: 'light', pset: 'minimalOne' });
  const l = currentLook({ skin: 'gameboy', theme: 'light' });
  assert.equal(l.skin, 'gameboy');
  assert.equal(l.theme, 'light');
  assert.equal(l.pieces, 'minimalOne');
  assert.equal(l.colors.pieceStroke, null);
  page({ skin: 'felt', theme: 'dark' });
  assert.equal(currentLook({ skin: 'felt' }).pieces, 'default');
});

test('Custom: its outline is Black’s ink for a set drawn in two inks, and the set’s own for every other', () => {
  for (const set of ['default', 'courtCards']) {
    page({ theme: 'dark', pset: set });
    const l = currentLook(CUSTOM);
    assert.equal(l.skin, 'custom');
    assert.equal(l.colors.pieceStroke, '#2b1d12', set);
    assert.equal(l.colors.pieceBlack, '#2b1d12', set);
  }
  for (const set of ['wavyCoach', 'rimLight', 'royalMinimal', 'cardCrown', 'minimalOne', 'minimalTwo']) {
    page({ theme: 'dark', pset: set });
    const l = currentLook(CUSTOM);
    assert.equal(l.pieces, set);
    assert.equal(l.colors.pieceStroke, null, set);
    assert.equal(l.colors.pieceWhite, '#f1e6cf', set);
  }
  // untouched Custom: no ink of its own, so no outline either (the frame's set keeps its own)
  page({ theme: 'dark', pset: 'default' });
  assert.equal(currentLook({ skin: 'custom', theme: 'dark' }).colors.pieceStroke, null);
});

test('a named theme never sends an outline: the frame knows the theme’s own', () => {
  for (const [skin, set] of [['drivethru', 'rimLight'], ['chessbook', 'default'], ['cards', 'courtCards'], ['uptown', 'default']]) {
    page({ skin, theme: 'light', pset: set });
    const l = currentLook({ skin, theme: 'light' });
    assert.equal(l.pieces, set);
    assert.equal(l.colors.pieceStroke, null, skin);
  }
});
