// What a device running the PREVIOUS version of the app actually has on it,
// for tests of "the first sync after an update".
//
// Taking the stamp off a state isn't enough on its own: a real device coming
// from the previous version also has that version's storage — one unkeyed
// sync record and one unkeyed baseline (holding no settings), and no stamped
// baselines at all. Stripping only the stamp models a device that can't
// exist (an unstamped state next to stamped baselines), and measures the
// careful path instead of the migration a real update goes through.
import { asDevice } from './firebase.mjs';
import { get, set } from './idb.mjs';

const PRE_UPDATE = Symbol('pre-update');

// The state as the previous version saved it. The mark isn't enumerable, so
// nothing about it reaches the engine.
export function markPreUpdate(state) {
  const { syncGen: _gone, ...rest } = state;
  Object.defineProperty(rest, PRE_UPDATE, { value: true, enumerable: false });
  return rest;
}

export const isPreUpdate = (state) => Boolean(state?.[PRE_UPDATE]);

// Rewrites the device's sync storage into the previous version's layout.
export async function downgradeStorage(device, uid = 'student1') {
  await asDevice(device, async () => {
    const stored = await get(`repertoire-lab-sync-base-v2:${uid}`);
    const newest = stored?.history?.[0]?.value ?? stored?.value ?? null;
    const meta = await get(`repertoire-lab-sync-v2:${uid}`);
    let base = null;
    if (newest) { const { settings: _s, ...rest } = newest; base = rest; }
    await set('repertoire-lab-sync-base-v1', base);
    await set('repertoire-lab-sync-v1', meta ? { ...meta, deviceId: await get('repertoire-lab-device-id') } : null);
    await set(`repertoire-lab-sync-base-v2:${uid}`, null);
    await set(`repertoire-lab-sync-v2:${uid}`, null);
  });
}
