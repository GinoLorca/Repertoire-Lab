// The Board Editor's saved positions, as a list you can arrange.
//
// A folder is just a name each position carries (`folder`), not a record of
// its own: a folder exists while something is in it, renaming one renames it
// on everything inside, and nothing can be left pointing at a folder that's
// gone. The list's own order is the order within each folder; the folders
// themselves read alphabetically, with the unfiled ones last. Positions keep
// their ids through all of it, so a link already copied keeps working.
//
// The folders read alphabetically until they're arranged by hand: then
// `order` (settings.positionFolderOrder, which syncs) lists them as arranged,
// and any folder it doesn't name yet — made since — follows, A–Z.

export const folderOf = (p) => (typeof p?.folder === 'string' ? p.folder.trim() : '');

const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });

// Every folder in use: as arranged, then any others alphabetically.
export function folderNames(list, order = []) {
  const inUse = [...new Set((list ?? []).map(folderOf).filter(Boolean))].sort(byName);
  const used = new Set(inUse);
  const arranged = [...new Set((order ?? []).filter((f) => used.has(f)))];
  const placed = new Set(arranged);
  return [...arranged, ...inUse.filter((f) => !placed.has(f))];
}

// The list as the dropdown shows it: [{ folder, items }], folders in their
// order (above) and the unfiled group ('') last. Empty groups are left out.
export function groupPositions(list, order = []) {
  const groups = folderNames(list, order).map((folder) => ({ folder, items: [] }));
  const at = new Map(groups.map((g) => [g.folder, g]));
  const unfiled = { folder: '', items: [] };
  for (const p of list ?? []) (at.get(folderOf(p)) ?? unfiled).items.push(p);
  if (unfiled.items.length) groups.push(unfiled);
  return groups;
}

// Added at the bottom of its folder: the order you build a lesson in is the
// order it's taught in.
export function addPosition(list, pos) {
  return [...(list ?? []), pos];
}

export function renamePosition(list, id, name, now = Date.now()) {
  const clean = String(name ?? '').trim();
  if (!clean) return list;
  return (list ?? []).map((p) => (p.id === id ? { ...p, name: clean, updatedAt: now } : p));
}

// Into another folder ('' for none), landing at the bottom of it.
export function setFolder(list, id, folder, now = Date.now()) {
  const all = list ?? [];
  const pos = all.find((p) => p.id === id);
  const target = String(folder ?? '').trim();
  if (!pos || folderOf(pos) === target) return all;
  const rest = all.filter((p) => p.id !== id);
  const moved = { ...pos, folder: target, updatedAt: now };
  let last = -1;
  rest.forEach((p, i) => { if (folderOf(p) === target) last = i; });
  if (last < 0) return [...rest, moved];
  return [...rest.slice(0, last + 1), moved, ...rest.slice(last + 1)];
}

// The neighbour a move up (-1) or down (+1) would swap with: the next one in
// the same folder, skipping anything filed elsewhere in between.
function neighbourIndex(all, i, dir) {
  const folder = folderOf(all[i]);
  for (let j = i + dir; j >= 0 && j < all.length; j += dir) {
    if (folderOf(all[j]) === folder) return j;
  }
  return -1;
}

export function canMove(list, id, dir) {
  const all = list ?? [];
  const i = all.findIndex((p) => p.id === id);
  return i >= 0 && neighbourIndex(all, i, dir) >= 0;
}

export function movePosition(list, id, dir) {
  const all = [...(list ?? [])];
  const i = all.findIndex((p) => p.id === id);
  if (i < 0) return list;
  const j = neighbourIndex(all, i, dir);
  if (j < 0) return list;
  [all[i], all[j]] = [all[j], all[i]];
  return all;
}

// A folder renamed is renamed on everything in it. Renaming onto a folder that
// already exists merges the two.
export function renameFolder(list, from, to, now = Date.now()) {
  const src = String(from ?? '').trim();
  const dst = String(to ?? '').trim();
  if (!src || !dst || src === dst) return list;
  return (list ?? []).map((p) => (folderOf(p) === src ? { ...p, folder: dst, updatedAt: now } : p));
}

// A folder renamed keeps its place in the arranged order. Renamed onto one
// that's already there, the two are one folder, in that one's place.
export function renameFolderInOrder(order, from, to) {
  const src = String(from ?? '').trim();
  const dst = String(to ?? '').trim();
  if (!Array.isArray(order) || !src || !dst || src === dst) return order;
  if (order.includes(dst)) return order.filter((f) => f !== src);
  return order.map((f) => (f === src ? dst : f));
}
