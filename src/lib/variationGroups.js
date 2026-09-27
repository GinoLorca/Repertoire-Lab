// Sub-variations: a line in a chapter filed under another line, the way a
// section in the Library can hold sub-sections (Mainline ▸ Tartakower,
// Karpov). One level only — a sub-variation can't have its own.
//
// A variation says which line it sits under with `parentId`. The chapter's
// list stays one flat array, kept in reading order: each main line followed
// by its own sub-variations. Practice, export and "Rename all" all walk that
// array, so keeping it in the order it's shown is what makes them agree
// with the screen.
//
// Everything here reads `parentId` defensively. Two devices can disagree —
// the parent deleted on the iPad while the Mac filed something under it, or
// A filed under B on one and B under A on the other — and the merge brings
// both halves together. A parent that isn't there, or a loop, just means
// "a main line".

// Each variation's main line, or null for a main line itself.
export function parentsOf(variations) {
  const byId = new Map(variations.map((v) => [v.id, v]));
  const out = new Map();
  for (const v of variations) {
    // Walk up to the top: a line filed under a sub-variation (only possible
    // when two devices' changes cross) goes under that one's main line.
    let top = null;
    const seen = new Set([v.id]);
    let at = v;
    while (at.parentId && byId.has(at.parentId) && !seen.has(at.parentId)) {
      seen.add(at.parentId);
      at = byId.get(at.parentId);
      top = at.id;
    }
    // A loop has no top: both are main lines.
    if (at.parentId && seen.has(at.parentId)) top = null;
    out.set(v.id, top);
  }
  return out;
}

// Ids in reading order: every main line where it stands, followed by its
// sub-variations in the order they stand among themselves.
export function regroupIds(ids, parentOf) {
  const kids = new Map();
  for (const id of ids) {
    const p = parentOf.get(id) ?? null;
    if (p && ids.includes(p)) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(id);
    }
  }
  const out = [];
  for (const id of ids) {
    const p = parentOf.get(id) ?? null;
    if (p && ids.includes(p)) continue;
    out.push(id, ...(kids.get(id) ?? []));
  }
  return out;
}

// The variations in reading order — the same array back if already so.
export function grouped(variations) {
  const parentOf = parentsOf(variations);
  const order = regroupIds(variations.map((v) => v.id), parentOf);
  if (order.every((id, i) => id === variations[i].id)) return variations;
  const byId = new Map(variations.map((v) => [v.id, v]));
  return order.map((id) => byId.get(id));
}

// File `id` under `parentId` (or that line's own main line), at the end of
// its sub-variations. Its own sub-variations come along, to the same main
// line, so there's still only one level.
export function nest(variations, id, parentId) {
  const parentOf = parentsOf(variations);
  const target = parentOf.get(parentId) ?? parentId;
  if (!target || target === id || !variations.some((v) => v.id === target)) return variations;
  const moving = new Set([id, ...variations.filter((v) => parentOf.get(v.id) === id).map((v) => v.id)]);
  const staying = variations.filter((v) => !moving.has(v.id));
  const moved = variations.filter((v) => moving.has(v.id)).map((v) => ({ ...v, parentId: target }));
  // After the main line's last sub-variation.
  let at = staying.findIndex((v) => v.id === target);
  while (at + 1 < staying.length && parentOf.get(staying[at + 1].id) === target) at += 1;
  return grouped([...staying.slice(0, at + 1), ...moved, ...staying.slice(at + 1)]);
}

// Back to a main line, placed just after the block it was in.
export function unnest(variations, id) {
  const next = variations.map((v) => {
    if (v.id !== id || !('parentId' in v)) return v;
    const { parentId: _gone, ...rest } = v;
    return rest;
  });
  return grouped(next);
}

// A main line and its sub-variations move together, past the neighbouring
// main line and its; a sub-variation moves among its own siblings only.
export function moveGrouped(variations, id, dir) {
  const list = grouped(variations);
  const parentOf = parentsOf(list);
  const parent = parentOf.get(id) ?? null;
  const peers = list.filter((v) => (parentOf.get(v.id) ?? null) === parent).map((v) => v.id);
  const i = peers.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= peers.length) return variations;
  // Swap the two in the flat list; regrouping then brings each main line's
  // sub-variations back in behind it.
  const ids = list.map((v) => v.id);
  const a = ids.indexOf(peers[i]);
  const b = ids.indexOf(peers[j]);
  [ids[a], ids[b]] = [ids[b], ids[a]];
  const byId = new Map(list.map((v) => [v.id, v]));
  return grouped(ids.map((vid) => byId.get(vid)));
}

// The main line `id` most likely belongs under: the one sharing the most
// moves with it, if it shares more than the whole chapter does.
export function suggestParent(variations, id) {
  const me = variations.find((v) => v.id === id);
  if (!me) return null;
  const parentOf = parentsOf(variations);
  const shared = (a, b) => {
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
    return n;
  };
  const floor = variations.reduce((n, v) => Math.min(n, shared(v.moves, me.moves)), me.moves.length);
  let best = null;
  let bestN = floor;
  for (const v of variations) {
    if (v.id === id || parentOf.get(v.id) || parentOf.get(id) === v.id) continue;
    const n = shared(v.moves, me.moves);
    if (n > bestN) { best = v.id; bestN = n; }
  }
  return best;
}
