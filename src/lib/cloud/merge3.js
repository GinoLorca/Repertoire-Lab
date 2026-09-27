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

import { legacyOrder, keepFoldersTogether } from '../chapterOrder';
import { hashOf } from './shape';
import { parseMarks, compose } from '../marks';

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

// A list of records is merged by identity rather than by position. Most
// records carry an `id`; a playlist's entries are identified by the line they
// point at, `variationId`. A list qualifies only if every entry has the same
// kind of key — a move list is a list of strings and is merged whole.
const RECORD_KEYS = ['id', 'variationId'];
const keyedBy = (v, k) => Array.isArray(v) && v.every((x) => isObj(x) && typeof x[k] === 'string');
function recordKey(...vs) {
  if (!vs.some((v) => Array.isArray(v) && v.length > 0)) return null;
  return RECORD_KEYS.find((k) => vs.every((v) => v === undefined || keyedBy(v, k))) ?? null;
}

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

// Lists that are really sets: a line's tags, a game's flags. Two devices each
// adding a different tag both mean it, so these merge as sets — everything
// added on either side, minus anything removed on either side — rather than
// one list replacing the other.
const SET_KEYS = new Set(['tags', 'flags']);
const isStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
export function mergeSet(base, local, remote) {
  const B = new Set(base ?? []);
  const L = new Set(local);
  const R = new Set(remote);
  const out = local.filter((x) => R.has(x) || !B.has(x));
  for (const x of remote) if (!L.has(x) && !B.has(x) && !out.includes(x)) out.push(x);
  return out;
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
export function mergeOrder(base, local, remote, prefer = 'local', key = 'id') {
  const L = local.map((r) => r[key]);
  const R = remote.map((r) => r[key]);
  const inR = new Set(R);
  const shared = new Set(L.filter((id) => inR.has(id)));
  const l = L.filter((id) => shared.has(id));
  const r = R.filter((id) => shared.has(id));
  let skeleton;
  if (sameSeq(l, r)) skeleton = l;
  else if (base) {
    const b = base.map((x) => x[key]).filter((id) => shared.has(id));
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

function mergeRecords(base, local, remote, prefer, key = 'id') {
  const B = new Map((base ?? []).map((r) => [r[key], r]));
  const L = new Map((local ?? []).map((r) => [r[key], r]));
  const R = new Map((remote ?? []).map((r) => [r[key], r]));
  const out = [];
  for (const id of mergeOrder(base, local ?? [], remote ?? [], prefer, key)) {
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
  const key = recordKey(base, local, remote);
  if (key) return mergeRecords(base, local, remote, prefer, key);

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
      if (lk && rk && SET_KEYS.has(k) && isStrings(local[k]) && isStrings(remote[k])
        && !same(local[k], remote[k])) {
        v = mergeSet(isStrings(b?.[k]) ? b[k] : [], local[k], remote[k]);
      } else if (lk && rk && k === 'comments' && isObj(local[k]) && isObj(remote[k])) {
        v = mergeComments(isObj(b?.[k]) ? b[k] : undefined, local[k], remote[k], side);
      } else if (lk && rk) v = merge3(b?.[k], local[k], remote[k], side);
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

// A move's comment holds things edited apart — its words, and the arrows and
// squares drawn on it ([%cal]/[%csl], lib/marks.js) — so when both devices
// changed the same one (arrows drawn on the Mac while the iPad reworded the
// note), each part merges on its own instead of one whole string winning.
function mergeComment(base, local, remote, prefer) {
  const b = base === undefined ? undefined : parseMarks(base);
  const l = parseMarks(local);
  const r = parseMarks(remote);
  const cal = (m) => m.cal.map((a) => `${a.c}${a.from}${a.to}`);
  const csl = (m) => m.csl.map((q) => `${q.c}${q.sq}`);
  const text = merge3(b?.text, l.text, r.text, prefer);
  const arrows = mergeSet(b ? cal(b) : [], cal(l), cal(r));
  const squares = mergeSet(b ? csl(b) : [], csl(l), csl(r));
  const other = merge3(b?.other, l.other, r.other, prefer);
  return compose(
    text,
    {
      cal: arrows.map((x) => ({ c: x[0], from: x.slice(1, 3), to: x.slice(3, 5) })),
      csl: squares.map((x) => ({ c: x[0], sq: x.slice(1, 3) })),
    },
    Array.isArray(other) ? other : [],
  );
}

function mergeComments(base, local, remote, prefer) {
  const out = merge3(base, local, remote, prefer);
  if (!isObj(out)) return out;
  for (const k of Object.keys(out)) {
    const l = local[k];
    const r = remote[k];
    if (typeof l !== 'string' || typeof r !== 'string' || l === r) continue;
    const bk = base?.[k];
    // Changed on one side only: merge3 already took that side.
    if (typeof bk === 'string' && (bk === l || bk === r)) continue;
    const merged = mergeComment(typeof bk === 'string' ? bk : undefined, l, r, prefer);
    if (merged) out[k] = merged;
  }
  return out;
}

// The one entry point sync uses: every collection that syncs as records,
// each merged against its own baseline.
export const SYNCED_COLLECTIONS = [
  'openings', 'players', 'labEntries', 'categories', 'playlists', 'savedPositions',
];

// `prefer` settles a genuine clash on a plain value: 'local' in an ordinary
// sync, 'remote' when this state is known to be older than the cloud's.
export function mergeState(baselineIn, localIn, remoteIn, prefer = 'local') {
  // An opening arranged by hand on some device (freeChapterOrder) is compared
  // with every other copy of it as that copy's screen showed it — folders
  // first — so a device that never arranged doesn't seem to have "moved"
  // chapters it merely held in their old order, and the merge can't produce
  // an order no screen ever showed (lib/chapterOrder.js).
  const arranged = new Set([baselineIn, localIn, remoteIn]
    .flatMap((st) => (st?.openings ?? []).filter((o) => o.freeChapterOrder).map((o) => o.id)));
  const even = (st) => (st && arranged.size
    ? { ...st, openings: (st.openings ?? []).map((o) => (arranged.has(o.id) ? legacyOrder(o) : o)) }
    : st);
  const baseline = even(baselineIn);
  const local = even(localIn);
  const remote = even(remoteIn);
  const out = { ...local };
  for (const key of SYNCED_COLLECTIONS) {
    out[key] = merge3(baseline?.[key], local?.[key] ?? [], remote?.[key] ?? [], prefer) ?? [];
  }
  // A game moved to another student's card, or a line saved into another
  // chapter, is — to the container-by-container merge above — deleted from
  // one place and added to another. If the other device edited it meanwhile,
  // the edit was on the "deleted" copy, and went with it. So each moved
  // record is merged once more on its own, by id, from wherever each side
  // had it: the move and the edit both land.
  out.players = remergeById(out.players, baseline?.players, local?.players, remote?.players,
    (p) => p.games ?? [], (p, games) => ({ ...p, games }), prefer);
  out.openings = remergeNested(out.openings, baseline?.openings, local?.openings, remote?.openings, prefer);
  // A chapter new since the last sync joins its folder where the folder is
  // now — a sub-variation made on one device while another moved the folder.
  if (baseline && arranged.size) {
    const known = new Map((baseline.openings ?? []).map((o) => [o.id, new Set((o.chapters ?? []).map((c) => c.id))]));
    out.openings = out.openings.map((o) => (known.has(o.id) ? keepFoldersTogether(o, known.get(o.id)) : o));
  }
  return out;
}

// Every record of one kind, by id, wherever it lives.
const byId = (containers, itemsOf) => {
  const m = new Map();
  for (const c of containers ?? []) for (const r of itemsOf(c) ?? []) if (r?.id) m.set(r.id, { c: c.id, r });
  return m;
};

// A record lives in one container. Each side's copy of it is merged once
// more on its own (so a move and an edit made on different devices both
// land), and then kept in exactly one place:
//   · moved on one side only → where that side put it
//   · moved on both, to different places (the same line sent to a
//     sub-variation on two devices before either synced) → the preferred
//     side's place; with no common ancestor, likewise
//   · deleted on one side while the other moved it → gone, the same "deleting
//     wins" as everywhere else — unless it was its whole old container that
//     was deleted there, in which case the move stands
// `dropEmptied`: a container new since the baseline that this leaves empty —
// the other device's copy of that same sub-variation — goes too, rather than
// sitting there as a second, empty "Panov Attack".
function remergeById(merged, base, local, remote, itemsOf, withItems, prefer, { dropEmptied = false } = {}) {
  const B = byId(base, itemsOf);
  const L = byId(local, itemsOf);
  const R = byId(remote, itemsOf);
  const ids = (list) => new Set((list ?? []).map((c) => c.id));
  const baseC = ids(base);
  const localC = ids(local);
  const remoteC = ids(remote);
  const mergedC = ids(merged);
  const homeOf = (id) => {
    const b = B.get(id)?.c;
    const l = L.get(id)?.c;
    const r = R.get(id)?.c;
    if (l !== undefined && r !== undefined) {
      if (l === r) return l;
      const lMoved = b === undefined || l !== b;
      const rMoved = b === undefined || r !== b;
      if (lMoved && !rMoved) return l;
      if (rMoved && !lMoved) return r;
      return prefer === 'remote' ? r : l;
    }
    if (l !== undefined) return b !== undefined && l !== b && remoteC.has(b) ? null : l;
    if (r !== undefined) return b !== undefined && r !== b && localC.has(b) ? null : r;
    return undefined;
  };
  const out = [];
  for (const container of merged ?? []) {
    const before = itemsOf(container) ?? [];
    let changed = false;
    const items = [];
    for (const item of before) {
      const home = homeOf(item.id);
      // Elsewhere, and that place survived the merge: not here.
      if (home === null || (home !== undefined && home !== container.id && mergedC.has(home))) {
        changed = true;
        continue;
      }
      const l = L.get(item.id);
      const r = R.get(item.id);
      if (l && r && l.c !== r.c) {
        changed = true;
        items.push(merge3(B.get(item.id)?.r, l.r, r.r, prefer));
      } else items.push(item);
    }
    if (dropEmptied && changed && before.length && !items.length && !baseC.has(container.id)) continue;
    out.push(changed ? withItems(container, items) : container);
  }
  return out;
}

// Lines live two levels down (opening → chapter → line), and move between
// chapters of any opening.
function remergeNested(merged, base, local, remote, prefer) {
  const flat = (openings) => (openings ?? []).flatMap((o) => o.chapters ?? []);
  const chapters = keepPlacement(
    remergeById(flat(merged), flat(base), flat(local), flat(remote),
      (c) => c.variations ?? [], (c, variations) => ({ ...c, variations }), prefer, { dropEmptied: true }),
    flat(base), flat(local), flat(remote), prefer,
  );
  const byChapter = new Map(chapters.map((c) => [c.id, c]));
  return (merged ?? []).map((o) => {
    const next = (o.chapters ?? []).filter((c) => byChapter.has(c.id)).map((c) => byChapter.get(c.id));
    const same = next.length === (o.chapters ?? []).length && next.every((c, i) => c === o.chapters[i]);
    return same ? o : { ...o, chapters: next };
  });
}

// Where a chapter sits — its folder and its sub-variation — is one decision,
// made on one device. Merged key by key, two devices filing the same chapter
// differently could produce a place neither chose (the folder from one, the
// sub-variation from the other). When both moved it, it goes where the
// preferred side put it, whole.
function keepPlacement(chapters, base, local, remote, prefer) {
  const index = (list) => new Map((list ?? []).map((c) => [c.id, c]));
  const B = index(base);
  const L = index(local);
  const R = index(remote);
  const at = (c) => `${c?.section ?? ''}\u0000${c?.subsection ?? ''}`;
  return chapters.map((c) => {
    const b = B.get(c.id);
    const l = L.get(c.id);
    const r = R.get(c.id);
    if (!b || !l || !r) return c;
    if (at(l) === at(b) || at(r) === at(b) || at(l) === at(r)) return c;
    const win = prefer === 'remote' ? r : l;
    if (at(c) === at(win)) return c;
    const out = { ...c, section: win.section ?? null, subsection: win.subsection ?? null };
    if ((win.courseId ?? null) !== (b.courseId ?? null)) out.courseId = win.courseId ?? null;
    return out;
  });
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
