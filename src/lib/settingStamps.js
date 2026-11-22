// When each setting was last changed by a person — on whichever device.
//
// Settings travel between devices as one object, and several of the sync's
// paths used to decide that object whole: a tab that had sat open through a
// few other syncs, a device keeping a look of its own, a setting touched while
// a sync was in flight. Each could hand the account its entire, older set of
// settings, and every other device then took it. Turn the engine's arrows off
// on the Mac and a few seconds later they were back on — because a tablet
// that had never touched them sent its own "on" along with something else.
//
// So each setting carries the time it was last changed on purpose
// (settings.changedAt[key], written by the store for every action a person
// takes), and the sync settles each one by it (settleSettings): the later
// decision wins, and a setting nobody changed is never anybody's news.
//
// Kept inside the settings themselves so it goes wherever they go — the
// account, a backup file, an app from before this that only carries it along.
//
// Plain module: the store and the sync engine both read it, and the sync
// tests run it under plain Node.

export const STAMPS = 'changedAt';

const NONE = Object.freeze({});
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const stampsOf = (settings) => (isObj(settings?.[STAMPS]) ? settings[STAMPS] : NONE);

// A missing key, undefined and null are one thing here, as they are once a
// value has been to the account and back.
const alike = (a, b) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// A person just changed `before` into `after`: every setting that differs is
// stamped now. A stamp never goes backwards — a device whose clock runs behind
// still out-stamps the value it is replacing.
export function stampChanges(before, after, now = Date.now()) {
  if (!isObj(after) || after === before) return after;
  const was = stampsOf(before);
  let at = null;
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after)])) {
    if (key === STAMPS || alike(before?.[key], after[key])) continue;
    at = at ?? { ...was };
    at[key] = Math.max(now, (was[key] ?? 0) + 1);
  }
  // The stamps stay with the settings whatever replaced them (a restore from
  // a file, a reset to the defaults).
  const next = at ?? was;
  if (after[STAMPS] === next || (next === NONE && after[STAMPS] === undefined)) return after;
  return { ...after, [STAMPS]: next };
}

// Each setting, settled between this device and the account.
//
//   chosen  what the sync's own merge decided (field by field against the
//           baseline, or one side whole where there is no baseline)
//   local   this device's settings
//   remote  the account's
//   base    the settings both last agreed on, when the merge had them
//   tie     with no baseline and equal stamps: 'chosen' keeps the merge's
//           choice, 'remote' takes the account's (a state older than anything
//           this device remembers is more likely stale than changed)
//   same    equality (the sync's own, which knows pictures by their hash)
//
// A plain setting (a switch, a number, a name) goes to whichever side decided
// it later — which also refuses an old copy written back over the account's,
// and keeps a switch flipped and flipped back, which by its value alone looks
// untouched. Equal stamps — most settings, most of the time — leave the
// merge's own choice standing.
export function settleSettings(chosen, local, remote, { base = null, tie = 'chosen', same = alike } = {}) {
  const L = local ?? {};
  const R = remote ?? {};
  const out = { ...(chosen ?? {}) };
  const tl = stampsOf(L);
  const tr = stampsOf(R);
  const tb = stampsOf(base);
  const take = (key, from) => { if (from[key] === undefined) delete out[key]; else out[key] = from[key]; };
  const at = {};
  const keys = new Set([...Object.keys(L), ...Object.keys(R), ...Object.keys(out)]);
  keys.delete(STAMPS);
  for (const key of keys) {
    const l = tl[key] ?? 0;
    const r = tr[key] ?? 0;
    const stamp = Math.max(l, r);
    if (!same(L[key], R[key])) {
      const records = isObj(L[key]) && isObj(R[key]);
      if (base && records) {
        // Two records (the reviews in progress, the places in videos): the
        // merge went through them entry by entry and kept both sides' — unless
        // one side's is from before what was last agreed on.
        const b = tb[key] ?? 0;
        if (r < b && l >= b) take(key, L);
        else if (l < b && r >= b) take(key, R);
      } else if (l > r) {
        take(key, L);
      } else if (r > l) {
        take(key, R);
      } else if (!base && tie === 'remote' && R[key] !== undefined) {
        take(key, R);
      }
    }
    if (stamp) at[key] = stamp;
  }
  if (Object.keys(at).length) out[STAMPS] = at; else delete out[STAMPS];
  return out;
}
