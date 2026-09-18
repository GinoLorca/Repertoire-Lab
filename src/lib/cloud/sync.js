// Pull, merge, push. One round trip, safe to run as often as you like.
//
// Merging is the whole game. Two devices are both allowed to be right, and
// the rules for reconciling them already exist in lib/backup.js, written for
// merge-on-Restore: content from whichever copy was touched last, progress
// never regressed — once learned, always learned, and the freshest review
// wins even if its level is lower after a lapse. Sync reuses them rather than
// inventing a second, subtly different set.
//
// Deletion is the part merging can't do on its own. A union of two devices
// can only ever add: delete a chapter on the Mac, and the iPad — which still
// has it — would hand it straight back on the next sync. So each device
// remembers the set of ids it saw at its last sync, and treats that as the
// common ancestor: an id in the ancestor but missing locally was deleted
// here, and an id in the ancestor but missing remotely was deleted there.
// Anything genuinely new on either side is still just added.
import { get, set } from 'idb-keyval';
import { cloud } from './app';
import { toCloud, fromCloud, hashOf, localBlobIndex, keepLocalImages, SKIP } from './shape';
import { mergeBackup } from '../backup';

const META_KEY = 'repertoire-lab-sync-v1';

const emptyMeta = () => ({ ids: {}, hashes: {}, settingsHash: null, lastSync: null });

export const readMeta = async () => (await get(META_KEY)) ?? emptyMeta();
const writeMeta = (meta) => set(META_KEY, meta);

// Wipe the local sync memory — used when signing out, so signing in as
// someone else can't inherit the previous account's idea of what existed.
export const forgetMeta = () => set(META_KEY, emptyMeta());

const idsOf = (arr) => (arr ?? []).map((x) => x.id);

// base − present: what this side deleted since the last sync.
const deletedSince = (base, present) => {
  const here = new Set(present);
  return (base ?? []).filter((id) => !here.has(id));
};

function dropIds(arr, gone) {
  if (!gone.size) return arr ?? [];
  return (arr ?? []).filter((x) => !gone.has(x.id));
}

// ---------------------------------------------------------------------------

async function pull(c, uid) {
  const { collection, getDocs, doc, getDoc } = c.firestore;
  const readAll = async (name) => {
    const snap = await getDocs(collection(c.db, 'users', uid, name));
    return snap.docs.map((d) => d.data());
  };
  const readOne = async (name, id) => {
    const snap = await getDoc(doc(c.db, 'users', uid, name, id));
    return snap.exists() ? snap.data() : null;
  };
  const [openings, chapters, players, labEntries, lists, settings] = await Promise.all([
    readAll('openings'), readAll('chapters'), readAll('players'), readAll('labEntries'),
    readOne('singletons', 'lists'), readOne('singletons', 'settings'),
  ]);
  return {
    openings,
    chapters,
    players,
    labEntries,
    lists: lists ?? { categories: [], playlists: [], savedPositions: [] },
    settings: settings?.value ?? null,
  };
}

// Writes only what changed, and removes what this device deleted. Hashes are
// compared against the previous push so an unchanged chapter costs nothing.
async function push(c, uid, docs, meta, removals) {
  const { doc, setDoc, deleteDoc, writeBatch } = c.firestore;
  const hashes = {};
  let written = 0;
  let deleted = 0;

  const batches = [];
  let batch = writeBatch(c.db);
  let ops = 0;
  const queue = (fn) => {
    fn(batch);
    ops += 1;
    // Firestore caps a batch at 500 operations.
    if (ops >= 450) { batches.push(batch); batch = writeBatch(c.db); ops = 0; }
  };

  for (const [name, items] of [['openings', docs.openings], ['chapters', docs.chapters],
    ['players', docs.players], ['labEntries', docs.labEntries]]) {
    for (const item of items) {
      const key = `${name}/${item.id}`;
      const hash = hashOf(JSON.stringify(item));
      hashes[key] = hash;
      if (meta.hashes[key] === hash) continue;
      queue((b) => b.set(doc(c.db, 'users', uid, name, item.id), item));
      written += 1;
    }
    for (const id of removals[name] ?? []) {
      queue((b) => b.delete(doc(c.db, 'users', uid, name, id)));
      deleted += 1;
    }
  }

  const listsHash = hashOf(JSON.stringify(docs.lists));
  hashes['singletons/lists'] = listsHash;
  if (meta.hashes['singletons/lists'] !== listsHash) {
    queue((b) => b.set(doc(c.db, 'users', uid, 'singletons', 'lists'), docs.lists));
    written += 1;
  }

  const settingsHash = hashOf(JSON.stringify(docs.settings));
  if (meta.settingsHash !== settingsHash) {
    queue((b) => b.set(doc(c.db, 'users', uid, 'singletons', 'settings'), { value: docs.settings }));
    written += 1;
  }

  batches.push(batch);
  for (const b of batches) await b.commit();
  void setDoc; void deleteDoc;
  return { hashes, settingsHash, written, deleted };
}

// The whole decision, with no network in it: what the merged state should be,
// and what this device deleted that the cloud still has. Exported so it can
// be tested directly — everything that could quietly lose work lives here.
export function reconcile(localState, remoteState, remoteDocs, meta) {
  const goneHere = {
    openings: deletedSince(meta.ids.openings, idsOf(localState.openings)),
    chapters: deletedSince(meta.ids.chapters, (localState.openings ?? []).flatMap((o) => idsOf(o.chapters))),
    players: deletedSince(meta.ids.players, idsOf(localState.players)),
    labEntries: deletedSince(meta.ids.labEntries, idsOf(localState.labEntries)),
  };
  const goneThere = new Set([
    ...deletedSince(meta.ids.openings, idsOf(remoteDocs.openings)),
    ...deletedSince(meta.ids.chapters, idsOf(remoteDocs.chapters)),
    ...deletedSince(meta.ids.players, idsOf(remoteDocs.players)),
    ...deletedSince(meta.ids.labEntries, idsOf(remoteDocs.labEntries)),
  ]);

  let merged = mergeBackup(localState, remoteState);

  // Anything the other device deleted goes, and anything this one deleted
  // never came back in the merge to begin with — it isn't in the ancestor's
  // successor on either side.
  const alsoGoneHere = new Set([
    ...goneHere.openings, ...goneHere.chapters, ...goneHere.players, ...goneHere.labEntries,
  ]);
  const gone = new Set([...goneThere, ...alsoGoneHere]);
  if (gone.size) {
    merged = {
      ...merged,
      openings: dropIds(merged.openings, gone).map((o) => ({
        ...o, chapters: dropIds(o.chapters, gone),
      })),
      players: dropIds(merged.players, gone),
      labEntries: dropIds(merged.labEntries, gone),
    };
  }

  // Settings are one object rather than a set of records, so they can't be
  // merged field by field without a timestamp on each. Changed here since the
  // last sync wins; otherwise take what the cloud has. In practice the device
  // you last changed a setting on is the one that decides, which is what
  // anyone would expect.
  const localSettingsHash = hashOf(JSON.stringify(localState.settings ?? {}));
  const changedHere = meta.settingsHash !== null && meta.settingsHash !== localSettingsHash;
  if (!changedHere && remoteState.settings) {
    merged = { ...merged, settings: { ...localState.settings, ...remoteState.settings } };
  }

  return { merged, goneHere };
}

// ---------------------------------------------------------------------------

export async function syncNow(localState, { onProgress } = {}) {
  const c = await cloud();
  if (!c) throw new Error('Sync isn’t configured for this build.');
  const user = c.authInstance.currentUser;
  if (!user) throw new Error('Sign in first.');
  const uid = user.uid;
  const meta = await readMeta();

  onProgress?.('Fetching…');
  const remoteDocs = await pull(c, uid);

  // Pictures and sounds this device already holds, so a pull only downloads
  // what's genuinely new to it.
  const have = localBlobIndex(localState);
  const { ref, getBlob } = c.storage;
  // Storage is optional. A project on the free plan has no bucket at all, and
  // the first failure says so — after that there's no point asking again, so
  // this stops trying and the sync carries on with everything that isn't a
  // picture. The repertoire is the valuable part; it must never be held up by
  // a course cover.
  let storageWorks = true;
  let skipped = 0;
  const download = async (blobRef) => {
    if (!storageWorks) { skipped += 1; return null; }
    try {
      const blob = await getBlob(ref(c.storageInstance, blobRef.__blob));
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      if (String(err?.code ?? '').startsWith('storage/')) storageWorks = false;
      skipped += 1;
      return null;
    }
  };

  onProgress?.('Merging…');
  const remoteState = await fromCloud(remoteDocs, download, have);
  const reconciled = reconcile(localState, remoteState, remoteDocs, meta);
  const { goneHere } = reconciled;
  // Whatever the merge decided, pictures already on this device stay on it.
  const merged = keepLocalImages(reconciled.merged, localState);

  onProgress?.('Uploading…');
  const uploads = [];
  const { uploadString, getMetadata } = c.storage;
  const upload = async (path, dataUrl) => {
    if (!storageWorks) { skipped += 1; return SKIP; }
    const full = `users/${uid}/${path}`;
    const hash = hashOf(dataUrl);
    const known = meta.hashes[`blob:${full}`];
    if (known === hash) return { __blob: full, hash, bytes: dataUrl.length };
    // Uploaded here rather than in the background, because the document that
    // will point at this object must not be written unless the object exists.
    try {
      await uploadString(ref(c.storageInstance, full), dataUrl, 'data_url');
      meta.hashes[`blob:${full}`] = hash;
      return { __blob: full, hash, bytes: dataUrl.length };
    } catch (err) {
      if (String(err?.code ?? '').startsWith('storage/')) storageWorks = false;
      skipped += 1;
      return SKIP;
    }
  };
  void getMetadata;

  const docs = await toCloud(merged, upload);
  await Promise.all(uploads);
  const { hashes, settingsHash, written, deleted } = await push(c, uid, docs, meta, goneHere);

  const next = {
    ids: {
      openings: idsOf(merged.openings),
      chapters: (merged.openings ?? []).flatMap((o) => idsOf(o.chapters)),
      players: idsOf(merged.players),
      labEntries: idsOf(merged.labEntries),
    },
    // Blob hashes live alongside document hashes; both say "this is already
    // in the cloud exactly as it is here".
    hashes: { ...Object.fromEntries(Object.entries(meta.hashes).filter(([k]) => k.startsWith('blob:'))), ...hashes },
    settingsHash,
    lastSync: Date.now(),
  };
  await writeMeta(next);

  return {
    state: merged,
    written,
    deleted,
    uploaded: uploads.length,
    // How many pictures couldn't travel, and whether Storage is the reason —
    // so the Account screen can say so plainly instead of showing a raw
    // Firebase error next to a sync that otherwise worked fine.
    imagesSkipped: skipped,
    storageUnavailable: !storageWorks,
    at: next.lastSync,
  };
}
