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
import {
  toCloud, fromCloud, hashOf, localBlobIndex, keepLocalImages, encodeForStore, decodeFromStore,
} from './shape';
import { makeInlineStore } from './blobs';
import { DEFAULT_SETTINGS } from '../settingsDefaults';
import { mergeBackup } from '../backup';
import { mergeState, toBaseline, SYNCED_COLLECTIONS } from './merge3';
import { applyCoachGames, stableStringify } from './gameLink';

// What this device knows about its last sync, kept per account: signing out
// no longer wipes it, so signing the same account back in resumes exactly
// where it left off, and a different account starts from its own.
const META_PREFIX = 'repertoire-lab-sync-v2:';
// What this device and the cloud last agreed on — the common ancestor the
// three-way merge needs (see merge3.js) — per account too, and stamped with a
// generation: see syncOnce. Kept apart from the meta because it's the size of
// the whole repertoire.
const BASE_PREFIX = 'repertoire-lab-sync-base-v2:';
// Before accounts had their own keys there was one of each.
const OLD_META_KEY = 'repertoire-lab-sync-v1';
const OLD_BASE_KEY = 'repertoire-lab-sync-base-v1';
const DEVICE_KEY = 'repertoire-lab-device-id';
// Which account the library in this browser belongs to — see syncOnce.
const OWNER_KEY = 'repertoire-lab-library-owner';
// Where a library is set aside when a different account signs in here.
export const STASH_PREFIX = 'repertoire-lab-stash:';

const emptyMeta = () => ({ ids: {}, hashes: {}, settingsHash: null, lastSync: null });

// A name for this browser, so a device can recognise its own echo. Random and
// meaningless on purpose — it identifies nothing but "not the other one".
export async function deviceId() {
  let id = await get(DEVICE_KEY);
  if (!id) {
    id = (await get(OLD_META_KEY))?.deviceId
      ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
    await set(DEVICE_KEY, id);
  }
  return id;
}

// This tab, for the pulse: two tabs of the same browser must hear each
// other's syncs, or one of them sits there with an ever older library.
const TAB = Math.random().toString(36).slice(2, 8);
const pulseName = async () => `${await deviceId()}:${TAB}`;

export const readMeta = async (uid) => (uid && (await get(META_PREFIX + uid))) || emptyMeta();
const writeMeta = (uid, meta) => set(META_PREFIX + uid, meta);
const readBaseline = async (uid) => (await get(BASE_PREFIX + uid)) ?? null;
const writeBaseline = (uid, merged, gen) => set(BASE_PREFIX + uid, {
  gen,
  value: toBaseline(Object.fromEntries(SYNCED_COLLECTIONS.map((k) => [k, merged[k] ?? []]))),
});

// The single pre-account record, handed to the first account that syncs.
async function migrateOnce(uid) {
  const oldMeta = await get(OLD_META_KEY);
  if (!oldMeta) return;
  if (!(await get(META_PREFIX + uid))) {
    const { deviceId: _d, ...meta } = oldMeta;
    await set(META_PREFIX + uid, { ...emptyMeta(), ...meta });
    const oldBase = await get(OLD_BASE_KEY);
    // No generation: whichever state comes next takes the careful path once.
    if (oldBase) await set(BASE_PREFIX + uid, { gen: 'migrated', value: oldBase });
    if (!(await get(OWNER_KEY)) && meta.lastSync) await set(OWNER_KEY, uid);
  }
  await set(OLD_META_KEY, null);
  await set(OLD_BASE_KEY, null);
}

// Signing out. The sync memory stays — it belongs to that account, and is
// exactly what lets a later sign-in pick up where this one left off.
export const forgetMeta = async () => {};

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
  const {
    collection, getDocs, getDocsFromServer, doc, getDoc, getDocFromServer,
  } = c.firestore;

  // From the server, deliberately, not from the local cache.
  //
  // Firestore keeps an offline copy and a plain read is allowed to answer out
  // of it. That is the right default for a document you're displaying and the
  // wrong one for the read that decides what gets written back: a stale answer
  // means the merge never sees the other device's work, and the push then
  // writes this device's older copy over it. Progress can't be lost that way —
  // the merge refuses to regress — but the two devices sit there disagreeing,
  // one showing 1/28 and the other 0/28, which is exactly what happened.
  //
  // Offline, the server read throws and the cached one is the honest fallback:
  // sync what we can now, reconcile properly when there's signal.
  // Whether every read below came from the server. A coach's game is only
  // ever applied against a server read: against a cache that's behind, a
  // game the student deleted on another device could look absent-but-new.
  let fromServer = true;
  // Exactly what each document held when it was read, so the push can make
  // sure nobody changed it in between — see push().
  const seen = {};
  const readAll = async (name) => {
    const ref = collection(c.db, 'users', uid, name);
    let snap;
    try { snap = await getDocsFromServer(ref); } catch { fromServer = false; snap = await getDocs(ref); }
    return snap.docs.map((d) => {
      seen[`${name}/${d.id}`] = fingerprint(d.data());
      return decodeFromStore(d.data());
    });
  };
  const readOne = async (name, id) => {
    const ref = doc(c.db, 'users', uid, name, id);
    let snap;
    try { snap = await getDocFromServer(ref); } catch { fromServer = false; snap = await getDoc(ref); }
    seen[`${name}/${id}`] = snap.exists() ? fingerprint(snap.data()) : ABSENT;
    return snap.exists() ? decodeFromStore(snap.data()) : null;
  };
  const [openings, chapters, players, labEntries, lists, settings, coachGames] = await Promise.all([
    readAll('openings'), readAll('chapters'), readAll('players'), readAll('labEntries'),
    readOne('singletons', 'lists'), readOne('singletons', 'settings'),
    // Which games coaches have put in this account — see gameLink.js.
    readOne('singletons', 'coachGames'),
  ]);
  return {
    seen,
    coachLedger: coachGames ?? { games: {} },
    fromServer,
    openings,
    chapters,
    players,
    labEntries,
    lists: lists ?? { categories: [], playlists: [], savedPositions: [] },
    settings: settings?.value ?? null,
    settingsAt: settings?.at ?? 0,
  };
}

// A document's content hash is compared against the previous push, so an
// unchanged chapter costs nothing to sync.
const ABSENT = 'absent';
// What a document holds, as a short string. Key order is normalised because
// the server doesn't promise one.
const fingerprint = (data) => hashOf(stableStringify(data));

// Another device wrote a document between this sync reading it and writing
// it. Not an error: syncNow reads again and merges on top of their work.
class SyncConflict extends Error {
  constructor(key) {
    super(`${key} changed while syncing`);
    this.code = 'sync-conflict';
  }
}

// Writes what changed, and removes what this device deleted.
//
// Every write is conditional: inside a transaction, each document is read
// again and must still be exactly what the pull saw. A document is written
// whole, so without this two devices syncing at the same moment — which is
// precisely what happens when a coach's game wakes every one of a student's
// devices at once — would each write their own copy of a player and the
// second would silently erase the first one's unsynced work. With it, the
// second is refused, reads again, and merges.
//
// Offline, a transaction can't run at all, so nothing is queued blind: the
// work stays in this device's own storage and goes up on the next sync with
// a connection.
async function push(c, uid, docs, meta, removals, device, extraSets = [], seen = {}) {
  const { doc, setDoc, runTransaction } = c.firestore;
  const hashes = {};
  let written = 0;
  let deleted = 0;
  const ops = [];

  for (const [name, items] of [['openings', docs.openings], ['chapters', docs.chapters],
    ['players', docs.players], ['labEntries', docs.labEntries]]) {
    for (const item of items) {
      const key = `${name}/${item.id}`;
      const hash = hashOf(JSON.stringify(item));
      hashes[key] = hash;
      if (meta.hashes[key] === hash) continue;
      const data = encodeForStore(item);
      // Exactly what the cloud already holds — typically a record this device
      // just received. Writing it back would only race the device that sent it.
      if (seen[key] && seen[key] === fingerprint(data)) continue;
      ops.push({ key, ref: doc(c.db, 'users', uid, name, item.id), data });
      written += 1;
    }
    for (const id of removals[name] ?? []) {
      ops.push({ key: `${name}/${id}`, ref: doc(c.db, 'users', uid, name, id), remove: true });
      deleted += 1;
    }
  }

  const listsHash = hashOf(JSON.stringify(docs.lists));
  hashes['singletons/lists'] = listsHash;
  if (meta.hashes['singletons/lists'] !== listsHash) {
    ops.push({ key: 'singletons/lists', ref: doc(c.db, 'users', uid, 'singletons', 'lists'), data: encodeForStore(docs.lists) });
    written += 1;
  }

  const settingsHash = hashOf(JSON.stringify(docs.settings));
  if (meta.settingsHash !== settingsHash) {
    ops.push({
      key: 'singletons/settings',
      ref: doc(c.db, 'users', uid, 'singletons', 'settings'),
      data: { value: encodeForStore(docs.settings), at: Date.now(), by: device },
    });
    written += 1;
  }

  // Anything else that must land in the same commit as the documents above —
  // the coach-games ledger, written together with the games it describes so a
  // crash in between can't let a deleted game come back. Merged into, not
  // replaced, so it needs no read-check.
  for (const { path, data } of extraSets) {
    ops.push({ key: path.join('/'), ref: doc(c.db, ...path), data, merge: true, unchecked: true });
    written += 1;
  }

  // Firestore caps a transaction at 500 writes; a first sync of a big library
  // is split, each part checked and committed on its own.
  for (let i = 0; i < ops.length; i += 400) {
    const part = ops.slice(i, i + 400);
    // eslint-disable-next-line no-await-in-loop
    await runTransaction(c.db, async (tx) => {
      const checked = part.filter((op) => !op.unchecked && op.key in seen);
      const snaps = await Promise.all(checked.map((op) => tx.get(op.ref)));
      snaps.forEach((snap, j) => {
        const now = snap.exists() ? fingerprint(snap.data()) : ABSENT;
        if (now !== seen[checked[j].key]) throw new SyncConflict(checked[j].key);
      });
      for (const op of part) {
        if (op.remove) tx.delete(op.ref);
        else if (op.merge) tx.set(op.ref, op.data, { merge: true });
        else tx.set(op.ref, op.data);
      }
    });
  }

  // The pulse: one tiny document saying "something changed, and it was me".
  // Every other signed-in device has a listener on it, so a line learned on a
  // tablet lands on the desktop without anyone pressing anything. Only written
  // when something actually changed, or devices would keep waking each other
  // up over nothing.
  if (written || deleted) {
    const { serverTimestamp } = c.firestore;
    await setDoc(doc(c.db, 'users', uid, 'singletons', 'pulse'), {
      at: serverTimestamp(), by: device,
    });
  }
  return { hashes, settingsHash, written, deleted };
}

// The whole decision, with no network in it: what the merged state should be,
// and what this device deleted that the cloud still has. Exported so it can
// be tested directly — everything that could quietly lose work lives here.
export function reconcile(
  localState, remoteState, remoteDocs, meta, defaults = DEFAULT_SETTINGS, baseline = null,
) {
  if (baseline) return reconcileThreeWay(localState, remoteState, remoteDocs, meta, defaults, baseline);
  return reconcileTwoWay(localState, remoteState, remoteDocs, meta, defaults);
}

// The merge every sync uses once this device has synced once under it: this
// device, the cloud, and what they last agreed on. Edits survive, deletions
// stick, and a game deleted on one device is deleted on the other — none of
// which the two-way merge below could promise.
function reconcileThreeWay(localState, remoteState, remoteDocs, meta, defaults, baseline) {
  let merged = mergeState(baseline, localState, remoteState);
  merged = mergeSettings(merged, localState, remoteState, remoteDocs, meta, defaults);

  // What the merge dropped that the cloud still has: exactly the documents
  // the push has to delete.
  const keep = (arr) => new Set(idsOf(arr));
  const keptChapters = new Set((merged.openings ?? []).flatMap((o) => idsOf(o.chapters)));
  const goneHere = {
    openings: idsOf(remoteDocs.openings).filter((id) => !keep(merged.openings).has(id)),
    chapters: idsOf(remoteDocs.chapters).filter((id) => !keptChapters.has(id)),
    players: idsOf(remoteDocs.players).filter((id) => !keep(merged.players).has(id)),
    labEntries: idsOf(remoteDocs.labEntries).filter((id) => !keep(merged.labEntries).has(id)),
  };
  return { merged, goneHere };
}

// The merge a device uses for its very first sync after an update that
// introduced the baseline, when there's nothing to compare against yet. Its
// rules are the old ones — the cloud's content wins a clash — which is why it
// only ever runs once per device.
function reconcileTwoWay(localState, remoteState, remoteDocs, meta, defaults) {
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

  merged = mergeSettings(merged, localState, remoteState, remoteDocs, meta, defaults);

  return { merged, goneHere };
}

function mergeSettings(merged, localState, remoteState, remoteDocs, meta, defaults) {
  // Settings are one object rather than a set of records, so recency decides
  // rather than sync order. Two rules:
  //
  //   · Changed here since the last sync? This device wins. The theme you just
  //     picked is not undone by a tablet that synced a moment later.
  //   · Never synced from here at all? This device still wins. A device that
  //     already has a look set up should not have it replaced the instant it
  //     signs in — which is exactly what happened: signing in on one machine
  //     swapped its theme for the other one's.
  //
  // Otherwise take the cloud's, but only if it's genuinely newer than the last
  // settings this device accepted.
  const localSettingsHash = hashOf(JSON.stringify(localState.settings ?? {}));
  const neverSyncedHere = meta.settingsHash === null;
  const changedHere = !neverSyncedHere && meta.settingsHash !== localSettingsHash;
  const remoteIsNewer = (remoteDocs.settingsAt ?? 0) > (meta.settingsAt ?? 0);
  // Nothing on this device has been touched: it's a fresh install, still
  // wearing whatever the app ships with. Signing in on a new tablet should
  // bring your own look across rather than leaving you with the factory one —
  // and this is the only case where taking the account's settings can't
  // overwrite a choice, because no choice has been made here yet.
  const untouchedHere = defaults && localSettingsHash === hashOf(JSON.stringify(defaults));
  const remoteHasSettings = remoteState.settings && Object.keys(remoteState.settings).length > 0;
  if (remoteHasSettings && (untouchedHere || (!changedHere && !neverSyncedHere && remoteIsNewer))) {
    return { ...merged, settings: { ...localState.settings, ...remoteState.settings } };
  }

  return merged;
}

// ---------------------------------------------------------------------------

// One sync, retried when another device wrote in the middle of it: each retry
// reads their work and merges on top of it. Three conflicts in a row would
// mean two devices syncing in lockstep; giving up then and letting the next
// trigger try is kinder than spinning.
export async function syncNow(localState, options = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await syncOnce(localState, options);
    } catch (err) {
      if (err?.code !== 'sync-conflict' || attempt >= 2) throw err;
      options.onProgress?.('Another device just synced — merging its changes…');
    }
  }
}

async function syncOnce(localState, { onProgress, inbound = [] } = {}) {
  const c = await cloud();
  if (!c) throw new Error('Sync isn’t configured for this build.');
  const user = c.authInstance.currentUser;
  if (!user) throw new Error('Sign in first.');
  const uid = user.uid;
  await migrateOnce(uid);
  const meta = await readMeta(uid);
  const me = await pulseName();

  onProgress?.('Fetching…');
  const remoteDocs = await pull(c, uid);

  // Offline, or the server only partly answered: there's nothing trustworthy
  // to merge against, so nothing is merged and nothing is written. The work
  // is safe in this device's own storage and goes up on the next sync with a
  // connection — rather than a merge computed from a cache being written
  // into the baseline, or a write being queued blind.
  if (!remoteDocs.fromServer) {
    return {
      state: localState, offline: true, coachApplied: [], received: 0, written: 0, deleted: 0,
      at: meta.lastSync,
    };
  }

  // Pictures and sounds this device already holds, so a pull only downloads
  // what's genuinely new to it.
  const have = localBlobIndex(localState);
  const { ref, getBlob } = c.storage;
  // Storage is optional. A project on the free plan has no bucket at all, and
  // the first failure says so — after that there's no point asking again, so
  // this stops trying and the sync carries on with everything that isn't a
  // picture. The repertoire is the valuable part; it must never be held up by
  // a course cover.
  let storageWorks = Boolean(c.storageInstance);
  let skipped = 0;

  // Storage is where pictures belong, but this project has no bucket — so
  // they go into Firestore instead. See blobs.js: it's the difference between
  // artwork syncing and artwork staying on the device it was added on.
  const inline = makeInlineStore({ db: c.db, firestore: c.firestore, uid, meta });

  // Firebase retries a failed upload with backoff, which is right for a flaky
  // connection and wrong for a bucket that doesn't exist: it hangs for a long
  // time, per picture, and the sync appears to stall at "Uploading…" forever.
  // A deadline turns that into a quick, honest no.
  const withDeadline = (promise, ms) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('storage timed out')), ms)),
  ]);
  const download = async (blobRef) => {
    if (blobRef.__doc) return inline.download(blobRef);
    if (!storageWorks) { skipped += 1; return null; }
    try {
      const blob = await withDeadline(getBlob(ref(c.storageInstance, blobRef.__blob)), 12000);
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch {
      // Whatever went wrong, it was storage. Stop trying and carry on.
      storageWorks = false;
      skipped += 1;
      return null;
    }
  };

  onProgress?.('Merging…');
  const remoteState = await fromCloud(remoteDocs, download, have);

  // Which merge this state has earned.
  //
  // A baseline says what the cloud and ONE particular state last agreed on,
  // and each sync stamps the state it hands back with the baseline's
  // generation. Only a state carrying that same stamp gets the three-way
  // merge, where "missing here" means "deleted here". Anything else — a tab
  // opened before another tab synced, a library just reset or restored from
  // a file, the iPad app relaunched before its last state was saved — is
  // older than the baseline, and reading its gaps as deletions would erase
  // work in the cloud. Those merge carefully instead: everything from both
  // sides is kept, the cloud's version wins a clash, and nothing is deleted.
  //
  // And the library in this browser may not be this account's at all: a
  // different account signed in here after the last one signed out. Merging
  // it would pour one person's openings into someone else's account, so the
  // account's own data replaces it, and the old library is set aside on this
  // device — it's also still in its own account.
  const owner = await get(OWNER_KEY);
  const stored = await readBaseline(uid);
  let reconciled;
  if (owner && owner !== uid) {
    await set(STASH_PREFIX + owner, localState);
    const replaced = { ...localState };
    for (const key of SYNCED_COLLECTIONS) replaced[key] = remoteState[key] ?? [];
    reconciled = {
      merged: mergeSettings(replaced, localState, remoteState, remoteDocs, meta, DEFAULT_SETTINGS),
      goneHere: {},
    };
  } else if (stored?.value && stored.gen && stored.gen === localState.syncGen) {
    reconciled = reconcile(localState, remoteState, remoteDocs, meta, DEFAULT_SETTINGS, stored.value);
  } else if (stored?.value) {
    reconciled = {
      merged: mergeSettings(
        mergeState(undefined, localState, remoteState, 'remote'),
        localState, remoteState, remoteDocs, meta, DEFAULT_SETTINGS,
      ),
      goneHere: {},
    };
  } else {
    reconciled = reconcile(localState, remoteState, remoteDocs, meta, DEFAULT_SETTINGS, null);
  }
  const { goneHere } = reconciled;
  // Pictures that couldn't be downloaded stay on the device that has them;
  // one removed on purpose elsewhere is removed here too (see shape.js).
  let merged = keepLocalImages(reconciled.merged, localState);

  // Games a linked coach sent. Applied here — after the merge, before the
  // push — so they go up in the same commit as everything else in this
  // account, and the deliveries are cleared only once that has happened. At
  // no point is a coach's game held only in memory on one device.
  let coachApplied = [];
  let consumed = [];
  const extraSets = [];
  if (inbound.length && remoteDocs.fromServer) {
    const { getDocFromServer, doc: docRef } = c.firestore;
    // The list came from a live listener and may be a moment old; another
    // of this student's devices could already have applied some of these.
    // (That would be harmless — see S4 — but it's cheap to skip.)
    const live = (await Promise.all(inbound.map(async (d) => {
      try {
        const snap = await getDocFromServer(docRef(c.db, 'deliveries', d.id));
        return snap.exists() ? d : null;
      } catch { return null; }
    }))).filter(Boolean);
    if (live.length) {
      const out = applyCoachGames(merged, live, {
        studentUid: uid, ledger: remoteDocs.coachLedger, now: Date.now(),
      });
      merged = out.state;
      consumed = out.consumed;
      coachApplied = out.outcomes;
      if (Object.keys(out.ledgerWrites).length) {
        extraSets.push({ path: ['users', uid, 'singletons', 'coachGames'], data: { games: out.ledgerWrites } });
      }
    }
  }

  onProgress?.('Uploading…');
  const uploads = [];
  const { uploadString, getMetadata } = c.storage;
  const upload = async (path, dataUrl) => {
    if (!storageWorks) return inline.upload(dataUrl);
    const full = `users/${uid}/${path}`;
    const hash = hashOf(dataUrl);
    const known = meta.hashes[`blob:${full}`];
    if (known === hash) return { __blob: full, hash, bytes: dataUrl.length };
    // Uploaded here rather than in the background, because the document that
    // will point at this object must not be written unless the object exists.
    try {
      await withDeadline(uploadString(ref(c.storageInstance, full), dataUrl, 'data_url'), 12000);
      meta.hashes[`blob:${full}`] = hash;
      return { __blob: full, hash, bytes: dataUrl.length };
    } catch {
      // The bucket isn't there. Everything from here on goes inline instead,
      // including this one.
      storageWorks = false;
      return inline.upload(dataUrl);
    }
  };
  void getMetadata;

  const docs = await toCloud(merged, upload);
  await Promise.all(uploads);
  const { hashes, settingsHash, written, deleted } = await push(
    c, uid, docs, meta, goneHere, me, extraSets, remoteDocs.seen,
  );

  const next = {
    ids: {
      openings: idsOf(merged.openings),
      chapters: (merged.openings ?? []).flatMap((o) => idsOf(o.chapters)),
      players: idsOf(merged.players),
      labEntries: idsOf(merged.labEntries),
    },
    // Blob hashes live alongside document hashes; both say "this is already
    // in the cloud exactly as it is here".
    // `doc:` too — those are pictures stored inline in Firestore (blobs.js),
    // and forgetting them made every sync upload every picture again.
    hashes: {
      ...Object.fromEntries(Object.entries(meta.hashes)
        .filter(([k]) => k.startsWith('blob:') || k.startsWith('doc:'))),
      ...hashes,
    },
    settingsHash,
    // When the settings we're now carrying were last written by anyone, so a
    // later sync can tell "newer than what I have" from "older, ignore it".
    settingsAt: Math.max(remoteDocs.settingsAt ?? 0, Date.now()),
    lastSync: Date.now(),
  };
  // Only now, with the push committed: this is what the cloud holds, so it's
  // what the next sync measures both sides' changes against — for the state
  // stamped with this generation, and no other.
  const gen = Math.random().toString(36).slice(2) + Date.now().toString(36);
  await writeMeta(uid, next);
  await writeBaseline(uid, merged, gen);
  await set(OWNER_KEY, uid);
  merged = { ...merged, syncGen: gen };

  // The games are committed, so the deliveries that carried them are done.
  // Best effort: one left behind is applied as 'stale' next time and cleared
  // then — it can never be applied twice.
  if (consumed.length) {
    const { deleteDoc, doc: docRef } = c.firestore;
    await Promise.allSettled(consumed.map((id) => deleteDoc(docRef(c.db, 'deliveries', id))));
  }

  return {
    coachApplied,
    state: merged,
    received: (remoteDocs.openings?.length ?? 0) + (remoteDocs.chapters?.length ?? 0),
    written,
    deleted,
    uploaded: uploads.length,
    // How many pictures couldn't travel, and whether Storage is the reason —
    // so the Account screen can say so plainly instead of showing a raw
    // Firebase error next to a sync that otherwise worked fine.
    imagesSkipped: skipped + inline.stats.skipped,
    imagesTooBig: inline.stats.tooBig,
    storageUnavailable: !storageWorks,
    at: next.lastSync,
  };
}

// Watch for changes made on another device. One document, one listener — a
// write by anyone else fires it within a second or so, and the app syncs
// itself. This is what makes progress follow you between devices without
// anybody pressing Sync.
export async function watchRemoteChanges(uid, onRemoteChange) {
  const c = await cloud();
  if (!c) return () => {};
  const me = await pulseName();
  const { doc, onSnapshot } = c.firestore;
  // Every listener opens with the document as it already is — the pulse
  // from whichever sync ran last, often this device's own from a previous
  // session. That isn't news, and the app syncs on launch anyway.
  let first = true;
  return onSnapshot(doc(c.db, 'users', uid, 'singletons', 'pulse'), (snap) => {
    if (first) { first = false; return; }
    if (!snap.exists()) return;
    // Firestore replays our own writes to us first; ignore those, and ignore
    // anything this device wrote, or two devices would sync each other in a
    // loop forever.
    if (snap.metadata.hasPendingWrites) return;
    if (snap.data()?.by === me) return;
    onRemoteChange();
  }, () => { /* a dropped listener is not worth an error; the next sync covers it */ });
}
