// Arranging the chapters of an opening by hand — dragging cards in the
// Library, or their ▲▼ buttons.
//
// A course's grid shows two kinds of card: folders (a section, with the
// sub-variations filed in it) and chapters on their own. Each is one "item",
// keyed `s:<section>` or `c:<chapter id>`. Chapters live in one flat array
// per opening, shared by every course, so arranging items means putting that
// course's chapters in the new item order — each folder's chapters together,
// in the order they already had — back into the places that course's
// chapters held. Other courses' chapters don't move.
//
// Folders used to be shown ahead of every loose chapter, whatever the order.
// Once an opening has been arranged by hand (`freeChapterOrder`) they sit
// wherever they were put; until then the grid looks exactly as it always
// has, and the first arrangement starts from that.

export const itemKeyOf = (chapter) => (chapter.section ? `s:${chapter.section}` : `c:${chapter.id}`);

const inCourse = (courseId) => (c) => (c.courseId ?? null) === (courseId ?? null);

// The items of one course's grid, in the order they're shown.
export function topItems(opening, courseId = null) {
  const keys = [];
  const seen = new Set();
  for (const c of opening.chapters.filter(inCourse(courseId))) {
    const key = itemKeyOf(c);
    if (!seen.has(key)) { seen.add(key); keys.push(key); }
  }
  if (opening.freeChapterOrder) return keys;
  return [...keys.filter((k) => k.startsWith('s:')), ...keys.filter((k) => k.startsWith('c:'))];
}

// Put `chosen` (in their new order) back into the places `isPlaced` chapters
// held in the flat array.
function refill(chapters, isPlaced, chosen) {
  let next = 0;
  const out = chapters.map((c) => (isPlaced(c) ? chosen[next++] : c));
  return out.every((c, i) => c === chapters[i]) ? chapters : out;
}

const byRank = (keys) => {
  const rank = new Map(keys.map((k, i) => [k, i]));
  // Anything the order doesn't mention (added on another device while the
  // drag was in progress) goes after, in the order it had.
  return (key) => (rank.has(key) ? rank.get(key) : keys.length);
};

// Every course's chapters put in the order its grid shows while folders
// come first — so the flat array reads the way the screen did. Done before
// the first arrangement (so every other course keeps looking the same once
// folders stop being pinned first) and, for comparison, in the sync merge.
export function legacyOrder(opening) {
  if (opening.freeChapterOrder) return opening;
  let chapters = opening.chapters;
  const courses = [...new Set(chapters.map((c) => c.courseId ?? null))];
  for (const courseId of courses) {
    const rank = byRank(topItems({ ...opening, chapters }, courseId));
    const mine = chapters.filter(inCourse(courseId));
    const sorted = [...mine].sort((a, b) => rank(itemKeyOf(a)) - rank(itemKeyOf(b)));
    chapters = refill(chapters, inCourse(courseId), sorted);
  }
  return chapters === opening.chapters ? opening : { ...opening, chapters };
}

const sameKeys = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);

// A course's grid in a new item order.
export function arrangeTop(opening, courseId, keys) {
  // Pressing ▲ on the first card, or dropping a card where it was, changes
  // nothing — not even whether the opening counts as arranged.
  if (sameKeys(keys, topItems(opening, courseId))) return opening;
  const base = legacyOrder(opening);
  const mine = base.chapters.filter(inCourse(courseId));
  const rank = byRank(keys);
  const sorted = [...mine].sort((a, b) => rank(itemKeyOf(a)) - rank(itemKeyOf(b)));
  const chapters = refill(base.chapters, inCourse(courseId), sorted);
  return { ...base, chapters, freeChapterOrder: true };
}

// A folder's sub-variations in a new order (by sub-section name). The
// chapter the folder is of — its chapters in no sub-section — stays first.
export function arrangeFolder(opening, courseId, section, subsections) {
  const here = (c) => inCourse(courseId)(c) && c.section === section;
  const mine = opening.chapters.filter(here);
  const rank = byRank(subsections);
  const place = (c) => (c.subsection ? 1 + rank(c.subsection) : 0);
  const sorted = [...mine].sort((a, b) => place(a) - place(b));
  const chapters = refill(opening.chapters, here, sorted);
  return chapters === opening.chapters ? opening : { ...opening, chapters };
}

// `key` one place earlier (-1) or later (+1) in `keys` — the ▲▼ buttons.
export function stepKey(keys, key, dir) {
  const i = keys.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) return keys;
  const next = [...keys];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

// `key` moved to sit before `beforeKey` (null: at the end) — a drop.
export function placeKey(keys, key, beforeKey) {
  if (key === beforeKey) return keys;
  const rest = keys.filter((k) => k !== key);
  const at = beforeKey == null ? rest.length : rest.indexOf(beforeKey);
  if (at < 0) return keys;
  const next = [...rest.slice(0, at), key, ...rest.slice(at)];
  return next.every((k, i) => k === keys[i]) ? keys : next;
}

// The order after dropping `key` before or after the card `target.key`.
export function dropOrder(keys, key, target) {
  if (target.where === 'before') return placeKey(keys, key, target.key);
  const rest = keys.filter((k) => k !== key);
  const i = rest.indexOf(target.key);
  if (i < 0) return keys;
  return placeKey(keys, key, rest[i + 1] ?? null);
}

// A folder's sub-variations as its card shows them (first appearance), as
// `sub:<name>` keys — worked out afresh where a drop is applied, so a sync
// landing mid-drag isn't overruled by a list from before it.
export function folderSubKeys(opening, courseId, section) {
  const keys = [];
  for (const c of opening.chapters) {
    if (!inCourse(courseId)(c) || c.section !== section || !c.subsection) continue;
    const key = `sub:${c.subsection}`;
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
}

// Chapters put into a folder that already has chapters in their course go
// in after its last one, so the folder stays where it was arranged instead
// of jumping to wherever the newcomer happened to be. `settled(c)` says
// which of the folder's chapters count as already there.
function placeAfter(chapters, ids, settled) {
  let out = chapters;
  for (const id of ids) {
    const me = out.find((c) => c.id === id);
    if (!me?.section) continue;
    const course = me.courseId ?? null;
    const rest = out.filter((c) => c.id !== id);
    const mate = (c) => c.section === me.section && (c.courseId ?? null) === course;
    let at = -1;
    rest.forEach((c, i) => { if (mate(c) && settled(c)) at = i; });
    if (at < 0) continue;
    // …and after any newcomers already placed behind them.
    while (at + 1 < rest.length && mate(rest[at + 1])) at += 1;
    out = [...rest.slice(0, at + 1), me, ...rest.slice(at + 1)];
  }
  return out.every((c, i) => c === chapters[i]) ? chapters : out;
}

export function gatherIntoFolder(chapters, ids) {
  const moving = new Set(ids);
  return placeAfter(chapters, ids, (c) => !moving.has(c.id));
}

// After a sync merge: a chapter new since the last sync that belongs to a
// folder its course already had goes in with that folder — not wherever the
// merge placed it relative to a neighbour on the device that added it
// (a sub-variation made on the iPad while the Mac moved the folder).
export function keepFoldersTogether(opening, knownIds) {
  if (!opening.freeChapterOrder) return opening;
  const fresh = opening.chapters.filter((c) => c.section && !knownIds.has(c.id)).map((c) => c.id);
  if (!fresh.length) return opening;
  const chapters = placeAfter(opening.chapters, fresh, (c) => knownIds.has(c.id));
  return chapters === opening.chapters ? opening : { ...opening, chapters };
}
