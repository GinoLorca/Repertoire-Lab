// Turning one big local state object into documents a cloud can hold, and
// back again.
//
// Two problems drive every decision here.
//
// Size. Firestore caps a document at 1 MiB. The repertoire is text and tiny,
// but the app also keeps pictures as data URLs — opening artwork, player
// photos, scoresheet snaps, theme wallpapers, uploaded sounds. One document
// per account would be over the limit the first time someone adds artwork to
// a few openings. So the state is split per entity (a chapter per document,
// which is a few KB even for a heavily annotated one), and every binary is
// lifted out to Storage and replaced by a reference.
//
// Traffic. A change to one variation shouldn't re-upload a 40-chapter course,
// and opening the app on a second device shouldn't re-download every picture
// it already has. Both are handled by hashing: each document and each blob
// carries a hash of its own contents, so a push skips what hasn't changed and
// a pull skips any picture this device already holds.

// FNV-1a. Not a cryptographic hash and doesn't need to be — it decides
// "same or different", where the inputs are this account's own data.
export function hashOf(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const isBlobRef = (v) => v && typeof v === 'object' && typeof v.__blob === 'string';
const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:');

// Returned by an upload or download that couldn't happen — most often because
// Storage isn't set up for the project at all. The key is then OMITTED rather
// than written as null, and that distinction is the whole point: a merge
// copies the incoming record over the local one field by field, so a null
// would travel to the other devices and wipe a picture that was perfectly
// fine there. A missing key leaves the local value alone.
export const SKIP = Symbol('skip');

// ---------------------------------------------------------------------------
// Local state -> documents
// ---------------------------------------------------------------------------

// `upload(path, dataUrl)` returns a ref: { __blob, hash, bytes }. It's given
// a path that's stable for the thing it holds, so replacing an opening's
// artwork overwrites one object rather than leaving the old one behind.
async function liftBlobs(value, path, upload) {
  if (isDataUrl(value)) return upload(path, value);
  if (Array.isArray(value)) {
    // Keyed by id where there is one, so a picture keeps its place when the
    // list around it is reordered. An index would re-upload the same photo
    // under a new name every time a game moved up the list, and strand the
    // old object in the bucket.
    const items = await Promise.all(
      value.map((v, i) => liftBlobs(v, `${path}/${v?.id ?? i}`, upload)),
    );
    return items.filter((v) => v !== SKIP);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const lifted = await liftBlobs(v, `${path}/${k}`, upload);
      if (lifted !== SKIP) out[k] = lifted;
    }
    return out;
  }
  return value;
}

export async function toCloud(state, upload) {
  const openings = [];
  const chapters = [];
  for (const opening of state.openings ?? []) {
    const { chapters: chapterList, ...rest } = opening;
    openings.push({
      ...(await liftBlobs(rest, `openings/${opening.id}`, upload)),
      // Order lives on the parent because the chapters themselves are
      // separate documents now, and a set of documents has no order.
      chapterOrder: (chapterList ?? []).map((c) => c.id),
    });
    for (const chapter of chapterList ?? []) {
      chapters.push({
        ...(await liftBlobs(chapter, `chapters/${chapter.id}`, upload)),
        openingId: opening.id,
      });
    }
  }

  const players = [];
  for (const player of state.players ?? []) {
    players.push(await liftBlobs(player, `players/${player.id}`, upload));
  }

  const labEntries = [];
  for (const entry of state.labEntries ?? []) {
    labEntries.push(await liftBlobs(entry, `lab/${entry.id}`, upload));
  }

  // Everything that's small, unordered and rarely touched shares one document
  // each rather than a collection of its own.
  const lists = {
    categories: state.categories ?? [],
    playlists: state.playlists ?? [],
    savedPositions: state.savedPositions ?? [],
  };

  // Note what isn't here: analysisDraft, the unsaved board in front of you on
  // THIS device. Syncing it would mean a phone in a pocket reaching over and
  // changing the position you're staring at on the Mac.
  const settings = await liftBlobs(state.settings ?? {}, 'settings', upload);

  return { openings, chapters, players, labEntries, lists, settings };
}

// ---------------------------------------------------------------------------
// Documents -> local state
// ---------------------------------------------------------------------------

// `download(ref)` returns the data URL for a ref. `have` is a map of
// hash -> data URL already on this device, so a picture that hasn't changed
// is never fetched twice.
async function dropBlobs(value, download, have) {
  if (isBlobRef(value)) {
    const known = have.get(value.hash);
    if (known) return known;
    const data = await download(value);
    if (data) { have.set(value.hash, data); return data; }
    // Couldn't fetch it: leave the key off so whatever this device already has
    // survives the merge, rather than being overwritten with nothing.
    return SKIP;
  }
  if (Array.isArray(value)) {
    const items = await Promise.all(value.map((v) => dropBlobs(v, download, have)));
    return items.filter((v) => v !== SKIP);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const dropped = await dropBlobs(v, download, have);
      if (dropped !== SKIP) out[k] = dropped;
    }
    return out;
  }
  return value;
}

// Every data URL already on this device, by hash — what makes a pull cheap.
export function localBlobIndex(state) {
  const have = new Map();
  const walk = (v) => {
    if (isDataUrl(v)) { have.set(hashOf(v), v); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(state);
  return have;
}

export async function fromCloud(docs, download, have = new Map()) {
  const byOpening = new Map();
  for (const chapter of docs.chapters ?? []) {
    if (!byOpening.has(chapter.openingId)) byOpening.set(chapter.openingId, []);
    byOpening.get(chapter.openingId).push(chapter);
  }

  const openings = [];
  for (const doc of docs.openings ?? []) {
    const { chapterOrder = [], ...rest } = doc;
    const mine = byOpening.get(doc.id) ?? [];
    const order = new Map(chapterOrder.map((id, i) => [id, i]));
    // Anything the order doesn't mention (added on another device between a
    // chapter write and its opening's) goes on the end rather than vanishing.
    mine.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
    openings.push({
      ...(await dropBlobs(rest, download, have)),
      chapters: await Promise.all(mine.map(async (c) => {
        const { openingId, ...chapter } = await dropBlobs(c, download, have);
        void openingId;
        return chapter;
      })),
    });
  }

  return {
    openings,
    players: await dropBlobs(docs.players ?? [], download, have),
    labEntries: await dropBlobs(docs.labEntries ?? [], download, have),
    categories: docs.lists?.categories ?? [],
    playlists: docs.lists?.playlists ?? [],
    savedPositions: docs.lists?.savedPositions ?? [],
    settings: await dropBlobs(docs.settings ?? {}, download, have),
  };
}

// A sync must never take a picture away from the device it's sitting on.
//
// Omitting an unsyncable image from the document isn't enough on its own: the
// merge copies records over field by field, so an `artwork` object that came
// back with its keys missing still replaces the full one that was here. This
// walks the merged state against what this device had a moment ago and puts
// back any data URL that went missing — matching records by id, so it follows
// the same opening, the same game, the same player.
//
// The rule it enforces: pictures can fail to travel, but they can't disappear.
export function keepLocalImages(merged, local) {
  const walk = (next, prev) => {
    if (prev == null || next == null) return next;
    if (isDataUrl(prev) && next === undefined) return prev;
    if (Array.isArray(next) && Array.isArray(prev)) {
      const byId = new Map(prev.filter((x) => x && x.id).map((x) => [x.id, x]));
      return next.map((item, i) => walk(item, (item && item.id && byId.get(item.id)) ?? prev[i]));
    }
    if (typeof next === 'object' && typeof prev === 'object' && !Array.isArray(next)) {
      const out = { ...next };
      for (const [k, prevVal] of Object.entries(prev)) {
        if (isDataUrl(prevVal) && !isDataUrl(out[k])) out[k] = prevVal;
        else if (prevVal && typeof prevVal === 'object') out[k] = walk(out[k] ?? (Array.isArray(prevVal) ? [] : {}), prevVal);
      }
      return out;
    }
    return next;
  };
  return walk(merged, local);
}

// Firestore refuses an array that contains another array. The app has them:
// a board arrow is [from, to, colour], and a position's arrows are a list of
// those — so any game or Lab session with an arrow drawn on it would reject
// the entire batch it travelled in, taking every other record with it.
//
// Rather than reshaping the app's own data to suit a database limitation,
// inner arrays are wrapped on the way out and unwrapped on the way back. It
// applies to everything written, so a nested array added anywhere later can't
// quietly break sync again.
const ARRAY_BOX = '__arr';
const JSON_BOX = '__json';

// Firestore also caps nesting at 20 levels, and a move tree is recursive —
// `children` inside `children`, one level per ply. A thirty-move game is
// already past the limit before the array boxing above adds its own, which is
// what produced "Message too deep. Max recursion depth reached in array".
//
// So anything still deep at this point stops being a structure and becomes a
// string: one JSON blob the database stores as a single value and never looks
// inside. It costs nothing — nothing queries inside a move tree — and it means
// no shape the app invents later can breach the limit either. Twelve leaves
// room for the wrappers boxing adds on the way down.
const MAX_DEPTH = 12;

export function encodeForStore(value, depth = 0) {
  const isContainer = value && typeof value === 'object';
  if (isContainer && depth >= MAX_DEPTH) return { [JSON_BOX]: JSON.stringify(value) };
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (Array.isArray(item)) return { [ARRAY_BOX]: encodeForStore(item, depth + 2) };
      // Firestore has no undefined. A hole in an array becomes null, which is
      // what JSON does with it too.
      if (item === undefined) return null;
      return encodeForStore(item, depth + 1);
    });
  }
  if (isContainer) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // A key whose value is undefined is dropped rather than sent: Firestore
      // rejects the whole document over one, and "absent" is what undefined
      // means here anyway. This app has a lot of optional fields — a variation
      // with no srs, a game with no result — and any one of them would
      // otherwise fail a sync with a message about an unsupported value.
      if (v === undefined) continue;
      out[k] = encodeForStore(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function decodeFromStore(value) {
  if (Array.isArray(value)) return value.map(decodeFromStore);
  if (value && typeof value === 'object') {
    if (typeof value[JSON_BOX] === 'string') {
      try { return JSON.parse(value[JSON_BOX]); } catch { return null; }
    }
    if (Array.isArray(value[ARRAY_BOX])) return decodeFromStore(value[ARRAY_BOX]);
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decodeFromStore(v);
    return out;
  }
  return value;
}

// How deep a value goes — used by the tests, and handy when something is
// rejected and you want to know what shape did it.
export function depthOf(value) {
  if (!value || typeof value !== 'object') return 0;
  const kids = Array.isArray(value) ? value : Object.values(value);
  let deepest = 0;
  for (const k of kids) deepest = Math.max(deepest, depthOf(k));
  return deepest + 1;
}
