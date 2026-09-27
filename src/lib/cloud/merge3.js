// A three-way merge: this device, the cloud, and what they both looked like
// the last time they agreed.
//
// The two-way merge this replaces could only ask "local or remote?", and it
// always answered "remote" — so an edit made here was undone by the very next
// sync, because the cloud still held the version from before the edit. Rename
// a chapter, sync, and the old name came back. Delete a game, sync, and the
// other copy put it back. Practice progress survived only because it had its
// own never-regress rule.
//
// With the common ancestor in hand (the baseline, saved after every sync) the
// question becomes answerable field by field, the way git merges branches:
//
//   · changed on neither side   → keep it
//   · changed on one side only  → take that side's version
//   · changed on both           → merge deeper if it's a record or a list of
//                                 records; otherwise the newer edit wins, by
//                                 the record's own updatedAt, else this device
//
// and a record that was in the baseline but is gone from one side was deleted
// there, so it's dropped. A record that's new on either side is kept.
//
// Pictures are compared by hash, never by content. The baseline stores a
// marker ({ __img: hash }) instead of the data URL — so it stays small enough
// to keep around — and a real data URL on either side is equal to a marker
// with the same hash.
import { hashOf } from './shape';

const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:');
const isMark = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && typeof v.__img === 'string' && Object.keys(v).length === 1;
const imgKey = (v) => (isDataUrl(v) ? hashOf(v) : isMark(v) ? v.__img : null);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The form a baseline is saved in: the same tree with every picture swapped
// for its hash.
export function toBaseline(value) {
  if (isDataUrl(value)) return { __img: hashOf(value) };
  if (Array.isArray(value)) return value.map(toBaseline);
  if (isObj(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = toBaseline(v);
    return out;
  }
  return value;
}

// Deep equality where a missing key, `undefined` and `null` are the same
// thing — Firestore can't store undefined, so a value that went up as
// undefined comes back missing — and pictures match by hash.
export function same(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  const ia = imgKey(a);
  const ib = imgKey(b);
  if (ia !== null || ib !== null) return ia === ib;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!same(a[k], b[k])) return false;
    return true;
  }
  return false;
}

// A list of records is merged by id rather than by position. Only lists
// whose entries all carry a string id qualify — a move list is a list of
// strings and is merged whole.
const isRecordList = (v) => Array.isArray(v)
  && v.every((x) => isObj(x) && typeof x.id === 'string');
const recordLists = (...vs) => vs.every((v) => v === undefined || isRecordList(v))
  && vs.some((v) => Array.isArray(v) && v.length > 0);

// Practice progress keeps its own rule inside the merge: once learned,
// always learned, and the review schedule from whichever side reviewed the
// line more recently — the same promise the two-way merge made, kept.
function keepProgress(out, local, remote) {
  if (!('learned' in (local ?? {})) && !('learned' in (remote ?? {}))
    && !('srs' in (local ?? {})) && !('srs' in (remote ?? {}))) return out;
  const merged = { ...out };
  if (local?.learned || remote?.learned) merged.learned = true;
  const ls = local?.srs;
  const rs = remote?.srs;
  if (ls && rs) merged.srs = (rs.lastReview ?? 0) > (ls.lastReview ?? 0) ? rs : ls;
  else if (ls || rs) merged.srs = ls ?? rs;
  return merged;
}

// When both sides changed the same plain value, which one stands. A record
// that knows when it was last edited (games carry updatedAt) settles it by
// that for every field inside it; otherwise this device, where the person is
// looking at the result.
const newerSide = (local, remote, fallback) => {
  if (!('updatedAt' in local) && !('updatedAt' in remote)) return fallback;
  return (local.updatedAt ?? 0) >= (remote.updatedAt ?? 0) ? 'local' : 'remote';
};

const sameSeq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// The order of a merged list.
//
// Order is judged on the items both sides still have, and on those alone:
// adding or removing something isn't a reorder, and treating it as one used to
// throw away a real reorder made on the other device ("Mac rearranges the
// variations while the iPad adds one" kept the iPad's old order). So:
//
//   · the shared items follow whichever side actually rearranged them — this
//     device if only it did, the other if only it did, and on a genuine clash
//     (both rearranged, differently) `prefer`
//   · everything else — new on either side — keeps its place relative to what
//     came after it on the side that added it: added at the end, it stays at
//     the end (the usual case, and where a person expects it); added above
//     "3...Bf5", it stays above "3...Bf5"
//
// With no baseline to tell who moved what, `prefer` decides: the careful path
// passes 'remote', because a state that's behind the account mustn't push its
// old order back over a newer one.
export function mergeOrder(base, local, remote, prefer = 'local') {
  const L = local.map((r) => r.id);
  const R = remote.map((r) => r.id);
  const inR = new Set(R);
  const shared = new Set(L.filter((id) => inR.has(id)));
  const l = L.filter((id) => shared.has(id));
  const r = R.filter((id) => shared.has(id));
  let skeleton;
  if (sameSeq(l, r)) skeleton = l;
  else if (base) {
    const b = base.map((x) => x.id).filter((id) => shared.has(id));
    const localMoved = !sameSeq(l, b);
    const remoteMoved = !sameSeq(r, b);
    if (remoteMoved && !localMoved) skeleton = r;
    else if (localMoved && !remoteMoved) skeleton = l;
    else skeleton = prefer === 'remote' ? r : l;
  } else skeleton = prefer === 'remote' ? r : l;

  const out = [...skeleton];
  const placed = new Set(out);
  const slotIn = (seq) => {
    // Right to left, so each new item's successor is already placed.
    for (let i = seq.length - 1; i >= 0; i -= 1) {
      const id = seq[i];
      if (placed.has(id)) continue;
      let j = i + 1;
      while (j < seq.length && !placed.has(seq[j])) j += 1;
      const at = j >= seq.length ? out.length : out.indexOf(seq[j]);
      out.splice(at, 0, id);
      placed.add(id);
    }
  };
  slotIn(prefer === 'remote' ? R : L);
  slotIn(prefer === 'remote' ? L : R);
  return out;
}

function mergeRecords(base, local, remote, prefer) {
  const B = new Map((base ?? []).map((r) => [r.id, r]));
  const L = new Map((local ?? []).map((r) => [r.id, r]));
  const R = new Map((remote ?? []).map((r) => [r.id, r]));
  const out = [];
  for (const id of mergeOrder(base, local ?? [], remote ?? [], prefer)) {
    const b = B.get(id);
    const l = L.get(id);
    const r = R.get(id);
    if (l && r) out.push(merge3(b, l, r, prefer));
    // In the baseline and gone from one side: deleted there. Deleting wins,
    // the same way it always has for openings, chapters and players.
    else if (l) { if (!b) out.push(l); }
    else if (r) { if (!b) out.push(r); }
  }
  return out;
}

// `base` is undefined when there's no common ancestor for this part of the
// tree — both sides added it independently, or this device has never synced.
// `prefer` is which side a genuine clash on a plain value goes to.
export function merge3(base, local, remote, prefer = 'local') {
  if (same(local, remote)) return local === undefined ? remote : local;
  if (base !== undefined) {
    if (same(local, base)) return remote;
    if (same(remote, base)) return local;
  }

  // Both changed (or there's nothing to compare against). Go deeper where
  // there's structure to go into.
  if (recordLists(base, local, remote)) return mergeRecords(base, local, remote, prefer);

  if (isObj(local) && isObj(remote) && imgKey(local) === null && imgKey(remote) === null) {
    const b = isObj(base) ? base : undefined;
    const side = newerSide(local, remote, prefer);
    const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
    const out = {};
    for (const k of keys) {
      const lk = k in local;
      const rk = k in remote;
      const bk = b !== undefined && k in b;
      let v;
      if (lk && rk) v = merge3(b?.[k], local[k], remote[k], side);
      // Present on one side only. If the baseline had it, the other side
      // removed it — unless this side changed it since, in which case the
      // change is the newer intent and stays.
      else if (lk) v = bk && same(local[k], b[k]) ? undefined : local[k];
      else v = bk && same(remote[k], b[k]) ? undefined : remote[k];
      if (v !== undefined) out[k] = v;
    }
    return keepProgress(out, local, remote);
  }

  // Two different plain values, or a value against nothing: pick one.
  if (local === undefined) return remote;
  if (remote === undefined) return local;
  return prefer === 'remote' ? remote : local;
}

// The one entry point sync uses: every collection that syncs as records,
// each merged against its own baseline.
export const SYNCED_COLLECTIONS = [
  'openings', 'players', 'labEntries', 'categories', 'playlists', 'savedPositions',
];

// `prefer` settles a genuine clash on a plain value: 'local' in an ordinary
// sync, 'remote' when this state is known to be older than the cloud's.
export function mergeState(baseline, local, remote, prefer = 'local') {
  const out = { ...local };
  for (const key of SYNCED_COLLECTIONS) {
    out[key] = merge3(baseline?.[key], local?.[key] ?? [], remote?.[key] ?? [], prefer) ?? [];
  }
  return out;
}

// Work done while a sync was in flight. The sync merged from `started`; the
// app kept going and is now at `now`; the sync came back with `synced`. The
// result keeps both: everything the sync brought in, and every change made
// here in the meantime — the same three-way rule, with the state the sync
// began from as the ancestor.
export function foldInFlight(started, now, synced) {
  if (now === started) return synced;
  const out = mergeState(started, now, synced);
  out.settings = same(now.settings, started.settings) ? synced.settings : now.settings;
  // The generation of the sync that just finished: the baseline it wrote is
  // the ancestor of this state, local work and all.
  out.syncGen = synced.syncGen;
  return out;
}
