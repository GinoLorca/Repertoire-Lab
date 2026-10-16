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
// and any folder it doesn't name yet — made since — follows, A–Z. Numbers in
// a name count as numbers, so Lesson 2 comes before Lesson 10.
//
// A position is the coach's own unless it carries an `ownerId`: the card id
// of a Coaches Corner student it was filed for, the same way an opening built
// for a student carries one (store.jsx, addOpening). Folders belong to an
// owner as well. A folder is still only the name its positions carry, so each
// student has folders of their own — their lessons — and the coach's
// "Lesson 1" and Wavy's "Lesson 1" are two folders that happen to share a
// name. Everything below that works on a folder works inside one owner's
// positions: filing, moving up and down, renaming and arranging never reach
// across to someone else's.

export const folderOf = (p) => (typeof p?.folder === 'string' ? p.folder.trim() : '');

// Whose a position is: a student's card id, or null for the coach's own.
export const ownerOf = (p) => (typeof p?.ownerId === 'string' && p.ownerId ? p.ownerId : null);

// One owner's positions, in the list's order.
export function positionsFor(list, ownerId = null) {
  const owner = ownerId || null;
  return (list ?? []).filter((p) => ownerOf(p) === owner);
}

// Two positions are in the same folder only if they're the same owner's.
const sameHome = (a, b) => ownerOf(a) === ownerOf(b) && folderOf(a) === folderOf(b);

const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

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
  return atBottom(rest, { ...pos, folder: target, updatedAt: now });
}

// Into the list right after the last position already in its folder — that
// owner's folder, not another owner's of the same name — or at the very end
// when it's the first one there.
function atBottom(list, pos) {
  let last = -1;
  list.forEach((p, i) => { if (sameHome(p, pos)) last = i; });
  if (last < 0) return [...list, pos];
  return [...list.slice(0, last + 1), pos, ...list.slice(last + 1)];
}

// The neighbour a move up (-1) or down (+1) would swap with: the next one in
// the same folder, skipping anything filed elsewhere in between — including
// another owner's folder of the same name.
function neighbourIndex(all, i, dir) {
  for (let j = i + dir; j >= 0 && j < all.length; j += dir) {
    if (sameHome(all[j], all[i])) return j;
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
// already exists merges the two. `ownerId` says whose folder it is (null, the
// coach's own): a student's lesson of the same name is a different folder,
// and keeps its name.
export function renameFolder(list, from, to, now = Date.now(), ownerId = null) {
  const src = String(from ?? '').trim();
  const dst = String(to ?? '').trim();
  if (!src || !dst || src === dst) return list;
  const owner = ownerId || null;
  return (list ?? []).map((p) => (ownerOf(p) === owner && folderOf(p) === src
    ? { ...p, folder: dst, updatedAt: now } : p));
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

// Each owner's folders are arranged on their own. The coach's order is
// settings.positionFolderOrder, as it always was; a student's is theirs in
// settings.positionFolderOrders, by card id. Both are plain settings, so they
// sync the way every setting does — key by key, so arranging Wavy's lessons
// on the iPad and Parker's on the Mac keeps both.
export function folderOrderFor(settings, ownerId = null) {
  const order = ownerId ? settings?.positionFolderOrders?.[ownerId] : settings?.positionFolderOrder;
  return Array.isArray(order) ? order : [];
}

// The settings change that arranges one owner's folders as `order`.
export function withFolderOrder(settings, ownerId, order) {
  if (!ownerId) return { positionFolderOrder: order };
  return { positionFolderOrders: { ...(settings?.positionFolderOrders ?? {}), [ownerId]: order } };
}

// ---------------------------------------------------------------------------
// Recycle: a position already set up, filed again in a lesson — the coach's
// own or a student's.
//
// It copies. The original stays exactly as and where it was; the copy is a
// position of its own, with its own id (and so its own link), made now,
// remembering which position it came from (`recycledFrom`), and added at the
// bottom of that lesson, the way a position saved straight into it would be.
// Everything on the board comes with it: the pieces, the arrows and the
// highlighted squares, as copies rather than shared with the original, so
// redrawing one never redraws the other. Where the original came from — a
// lesson it arrived in from a coach (`received`, lib/cloud/share.js) — stays
// with the original: the copy is this account's own.
// ---------------------------------------------------------------------------

export function recycledCopy(src, {
  ownerId = null, folder = '', id, now = Date.now(),
} = {}) {
  const {
    ownerId: _owner, folder: _folder, updatedAt: _edited, recycledFrom: _from, received: _sent, ...rest
  } = JSON.parse(JSON.stringify(src));
  const target = String(folder ?? '').trim();
  return {
    ...rest,
    id,
    createdAt: new Date(now).toISOString(),
    recycledFrom: src.id,
    ...(ownerId ? { ownerId } : {}),
    ...(target ? { folder: target } : {}),
  };
}

// A source that isn't there (deleted on another device a moment ago) or an id
// already in use leaves the list as it was.
export function recyclePosition(list, srcId, {
  ownerId = null, folder = '', id, now = Date.now(),
} = {}) {
  const all = list ?? [];
  const src = all.find((p) => p.id === srcId);
  if (!src || !id || all.some((p) => p.id === id)) return all;
  return atBottom(all, recycledCopy(src, {
    ownerId, folder, id, now,
  }));
}

// A whole lesson recycled: each position in turn, so they arrive in the order
// they're taught in. `items` is [{ srcId, id }].
export function recyclePositions(list, items, opts = {}) {
  return (items ?? []).reduce((acc, { srcId, id }) => recyclePosition(acc, srcId, { ...opts, id }), list ?? []);
}

// Whether a lesson already holds this position: the position itself, a copy
// of it, the one it was copied from, or another copy of that one. Recycle
// asks before adding a second.
export function alreadyIn(list, src, { ownerId = null, folder = '' } = {}) {
  if (!src) return null;
  const kin = new Set([src.id, src.recycledFrom].filter(Boolean));
  const home = { ownerId, folder };
  return (list ?? []).find((p) => sameHome(p, home)
    && (kin.has(p.id) || kin.has(p.recycledFrom))) ?? null;
}

// "New lesson…" is offered as Lesson N, N one more than the lessons that owner
// has — or the next number free, if one of theirs is already called that.
export function nextLessonName(list, ownerId = null) {
  const names = folderNames(positionsFor(list, ownerId));
  const taken = new Set(names.map((f) => f.toLowerCase()));
  let n = names.length + 1;
  while (taken.has(`lesson ${n}`)) n += 1;
  return `Lesson ${n}`;
}

// The lesson a typed name means. Left blank, it's the one offered; the name of
// a lesson that owner already has, in any capitals, files into that one rather
// than starting a "lesson 4" beside "Lesson 4".
export function lessonNamed(list, ownerId, typed) {
  const name = String(typed ?? '').trim();
  if (!name) return nextLessonName(list, ownerId);
  const same = (f) => f.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0;
  return folderNames(positionsFor(list, ownerId)).find(same) ?? name;
}

// ---------------------------------------------------------------------------
// Room. Every saved position — your own and every student's lessons — syncs
// in one document, along with the categories and playlists
// (lib/cloud/shape.js), and Firestore holds at most 1 MiB in one. That's a
// few thousand positions. Recycle makes copies, one per student per lesson,
// so it says so while there's still room, rather than after syncing stops.
//
// Measured with Firestore's own arithmetic: a string is its UTF-8 bytes plus
// one, a number eight, true, false and null one each, a map its keys (bytes
// plus one) and values, a list its values. A list inside a list — an arrow's
// [from, to, colour] in a position's arrows — goes up wrapped in a map
// ({ __arr: […] }, encodeForStore in shape.js), which costs that key too.
// ---------------------------------------------------------------------------

export const LISTS_BYTES_MAX = 1048576;
export const LISTS_BYTES_WARN = 850000;

const utf8 = (s) => new TextEncoder().encode(s).length;
const BOX_KEY = utf8('__arr') + 1;

function storeBytes(v, inList = false) {
  if (typeof v === 'string') return utf8(v) + 1;
  if (typeof v === 'number') return 8;
  if (Array.isArray(v)) return (inList ? BOX_KEY : 0) + v.reduce((n, x) => n + storeBytes(x, true), 0);
  if (v && typeof v === 'object') {
    return Object.entries(v).reduce((n, [k, x]) => (x === undefined ? n : n + utf8(k) + 1 + storeBytes(x)), 0);
  }
  return 1;
}

// The lists document's size, near enough: what toCloud puts in it (the
// order of the openings, players and Lab sessions rides along), plus the
// document's own name and Firestore's fixed 32 bytes.
export function listsBytes(state) {
  const ids = (list) => (list ?? []).map((x) => x.id);
  return 32 + 64 + storeBytes({
    categories: state?.categories ?? [],
    playlists: state?.playlists ?? [],
    savedPositions: state?.savedPositions ?? [],
    order: { openings: ids(state?.openings), players: ids(state?.players), labEntries: ids(state?.labEntries) },
  });
}
