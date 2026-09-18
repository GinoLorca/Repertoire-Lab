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
    return Promise.all(value.map((v, i) => liftBlobs(v, `${path}/${v?.id ?? i}`, upload)));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await liftBlobs(v, `${path}/${k}`, upload);
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
    if (data) have.set(value.hash, data);
    return data ?? null;
  }
  if (Array.isArray(value)) return Promise.all(value.map((v) => dropBlobs(v, download, have)));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await dropBlobs(v, download, have);
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
