// When each setting was last changed on purpose, and how two copies of the
// settings are settled by it (src/lib/settingStamps.js). The sync's own
// tests (sync-matrix-structure) run the same rule through real devices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAMPS, stampsOf, stampChanges, settleSettings } from '../src/lib/settingStamps.js';

test('a changed setting is stamped; an untouched one is not, and nothing changed is the same object back', () => {
  const before = { engineArrows: true, volume: 1 };
  const after = stampChanges(before, { ...before, engineArrows: false }, 1000);
  assert.deepEqual(stampsOf(after), { engineArrows: 1000 });
  assert.equal(after.engineArrows, false);
  const same = { ...after };
  assert.equal(stampChanges(after, same, 2000), same, 'no setting differs: nothing to stamp');
  assert.equal(stampChanges(after, after, 2000), after);
  // A record that's equal by value isn't a change either (a new object each time).
  const withRecord = { ...after, shortcuts: { flipBoard: 'f' } };
  const again = { ...withRecord, shortcuts: { flipBoard: 'f' } };
  assert.equal(stampChanges(withRecord, again, 3000), again);
  // null, undefined and missing are one thing, as they are after a trip to the account.
  assert.deepEqual(stampsOf(stampChanges({ a: 1 }, { a: 1, background: null }, 5)), {});
});

test('the stamps stay with the settings when they are replaced whole, and a removed setting is stamped too', () => {
  const before = { engineArrows: false, volume: 0.5, [STAMPS]: { engineArrows: 1000, volume: 900 } };
  // Reset to the defaults: a new object with no stamps of its own.
  const reset = stampChanges(before, { engineArrows: true, volume: 0.5 }, 2000);
  assert.deepEqual(stampsOf(reset), { engineArrows: 2000, volume: 900 });
  const removed = stampChanges(before, { volume: 0.5, [STAMPS]: before[STAMPS] }, 3000);
  assert.deepEqual(stampsOf(removed), { engineArrows: 3000, volume: 900 });
});

test('a stamp never goes backwards, whatever this device\'s clock says', () => {
  const before = { engineArrows: true, [STAMPS]: { engineArrows: 5000 } };
  const after = stampChanges(before, { ...before, engineArrows: false }, 1000);
  assert.equal(stampsOf(after).engineArrows, 5001);
});

test('with no baseline, each setting goes to the later decision; equal stamps keep the merge\'s choice, or the account\'s when asked', () => {
  const local = { engineArrows: true, volume: 0.3, theme: 'dark', evalBar: true, [STAMPS]: { volume: 200 } };
  const remote = { engineArrows: false, volume: 1, theme: 'light', evalBar: true, [STAMPS]: { engineArrows: 300, volume: 100 } };
  // The old whole-object rule picked this device's: its "on" would have gone up.
  const kept = settleSettings(local, local, remote);
  assert.equal(kept.engineArrows, false, 'the account\'s later decision');
  assert.equal(kept.volume, 0.3, 'this device\'s later decision');
  assert.equal(kept.theme, 'dark', 'no stamps either side: the merge\'s choice');
  assert.deepEqual(stampsOf(kept), { engineArrows: 300, volume: 200 });
  const careful = settleSettings(local, local, remote, { tie: 'remote' });
  assert.equal(careful.theme, 'light', 'a stale state: the account\'s stands where the stamps can\'t say');
  assert.equal(careful.volume, 0.3);
  // …but a setting the account doesn't have at all is kept.
  assert.equal(settleSettings({ ...local, coordSize: 'large' }, { ...local, coordSize: 'large' }, remote, { tie: 'remote' }).coordSize, 'large');
});

test('with a baseline: an older copy written back is refused, a later decision wins, and records keep both sides\' entries', () => {
  const base = { engineArrows: false, hints: false, videoSpots: {}, [STAMPS]: { engineArrows: 500 } };
  // The account's "on" carries no stamp: someone's copy from before the change.
  const stale = { engineArrows: true, hints: false, videoSpots: {} };
  const mine = { ...base };
  // (The merge alone reads it as the account's change, and takes it.)
  const out = settleSettings({ ...mine, engineArrows: true }, mine, stale, { base });
  assert.equal(out.engineArrows, false);
  assert.deepEqual(stampsOf(out), { engineArrows: 500 });
  // A change made elsewhere since, properly stamped, is taken.
  const news = { ...base, engineArrows: true, [STAMPS]: { engineArrows: 900 } };
  assert.equal(settleSettings({ ...mine, engineArrows: true }, mine, news, { base }).engineArrows, true);
  // One switch decided on both: the later decision, whichever side the merge prefers.
  const here = { ...base, hints: true, [STAMPS]: { engineArrows: 500, hints: 700 } };
  const there = { ...base, hints: 'always', [STAMPS]: { engineArrows: 500, hints: 800 } };
  assert.equal(settleSettings({ ...here }, here, there, { base }).hints, 'always');
  assert.equal(settleSettings({ ...there }, there, here, { base }).hints, 'always');
  // Flipped and flipped back here, after the other side's change: by its value it looks untouched.
  const back = { ...base, [STAMPS]: { engineArrows: 500, hints: 950 } };
  assert.equal(settleSettings({ ...back, hints: 'always' }, back, there, { base }).hints, false);
  // Records were merged entry by entry: both sides' entries stay.
  const a = { ...base, videoSpots: { caro: { at: 1 } }, [STAMPS]: { engineArrows: 500, videoSpots: 600 } };
  const b = { ...base, videoSpots: { london: { at: 2 } }, [STAMPS]: { engineArrows: 500, videoSpots: 650 } };
  const both = { caro: { at: 1 }, london: { at: 2 } };
  assert.deepEqual(settleSettings({ ...a, videoSpots: both }, a, b, { base }).videoSpots, both);
  assert.equal(stampsOf(settleSettings({ ...a, videoSpots: both }, a, b, { base })).videoSpots, 650);
});

test('settings with no stamps anywhere come out exactly as the merge chose them', () => {
  const local = { engineArrows: true, volume: 0.3 };
  const remote = { engineArrows: false, volume: 1 };
  const chosen = { engineArrows: false, volume: 0.3 };
  assert.deepEqual(settleSettings(chosen, local, remote, { base: { engineArrows: true, volume: 1 } }), chosen);
  assert.deepEqual(settleSettings(local, local, remote), local);
  assert.equal(STAMPS in settleSettings(local, local, remote), false);
});
