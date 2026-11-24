// The letters held down, as the boards read them (lib/penHold): a letter whose
// release the browser never reports must not stay the pen (2026-11-24: after
// Cmd+R every arrow was red, whatever letter was held).
import test from 'node:test';
import assert from 'node:assert/strict';

const on = {};
globalThis.window = { addEventListener: (t, fn) => { (on[t] ??= []).push(fn); } };
const { watchHeldKeys, heldKeys, markDrawn, onRelease, resetHeldKeys } = await import('../src/lib/penHold.js');
const { reviewPenColor, reviewPens } = await import('../src/lib/arrowProfiles.js');
watchHeldKeys();

const fire = (t, key, x = {}) => on[t].forEach((fn) => fn({
  key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key, target: { tagName: 'DIV' }, ...x,
}));
const down = (key, x) => fire('keydown', key, x);
const up = (key, x) => fire('keyup', key, x);
const color = () => reviewPenColor('gamereview', heldKeys());
const of = (k) => reviewPens('gamereview').find((p) => p.key === k).color;

test('each letter held gives its colour, and none once it is let go', () => {
  resetHeldKeys();
  for (const p of reviewPens('gamereview')) {
    down(p.key); assert.equal(color(), p.color, p.key);
    up(p.key); assert.equal(color(), null, p.key);
  }
});
test('Cmd+R, whose R is never released, leaves nothing held', () => {
  resetHeldKeys();
  down('Meta', { metaKey: true }); down('r', { metaKey: true }); up('Meta');
  assert.equal(color(), null);
  down('b'); assert.equal(color(), of('b')); up('b');
  down('w'); assert.equal(color(), of('w')); up('w');
  assert.equal(color(), null);
});
test('a page that only sees the R of Cmd+R', () => {
  resetHeldKeys();
  down('r', { metaKey: true });
  assert.equal(color(), null);
});
test('a letter held, then Command: the letter is let go (its release may never come)', () => {
  resetHeldKeys();
  down('r'); down('Meta', { metaKey: true }); up('Meta');
  assert.equal(color(), null);
});
test('a release lost some other way: the next letter takes its place for good', () => {
  resetHeldKeys();
  down('r'); down('y');
  assert.equal(color(), of('y'));
  up('y'); assert.equal(color(), null);
});
test('rolling from one letter to the next keeps the second', () => {
  resetHeldKeys();
  down('r'); down('b'); up('r');
  assert.equal(color(), of('b'));
});
test('let go with Option down, where the release has another name', () => {
  resetHeldKeys();
  down('r'); down('Alt', { altKey: true }); up('®', { code: 'KeyR', altKey: true });
  assert.equal(heldKeys().has('r'), false);
  assert.equal(heldKeys().has('alt'), true);
  up('Alt'); assert.equal(heldKeys().size, 0);
});
test('a letter that is also a shortcut still waits for its release, and not when it drew', () => {
  resetHeldKeys();
  let n = 0;
  down('b'); onRelease('b', () => { n += 1; }); up('b');
  assert.equal(n, 1);
  down('b'); onRelease('b', () => { n += 1; }); markDrawn(); up('b');
  assert.equal(n, 1);
  down('b'); onRelease('b', () => { n += 1; }); down('Meta', { metaKey: true }); up('b', { metaKey: true }); up('Meta');
  assert.equal(n, 1);
});
