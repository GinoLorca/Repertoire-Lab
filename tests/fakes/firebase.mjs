// A stand-in for lib/cloud/app.js: an in-memory Firestore shared by every
// simulated device, with just the calls the sync engine makes — reads,
// writes, merges, deletes and optimistic transactions that retry when a
// document they read changed before they committed, as Firestore's do.
//
// `hold(device, beforeCommit)` lets a test decide exactly when a device's
// transaction runs, which is how two devices are made to sync "at the same
// moment" deterministically.
import { deviceContext } from './idb.mjs';

export const server = globalThis.__fakeServer ??= new Map();
const holds = globalThis.__fakeHolds ??= new Map();
export const log = globalThis.__fakeLog ??= [];

const clone = (v) => structuredClone(v);
const device = () => deviceContext.getStore()?.device ?? 'default';
const ref = (_db, ...segs) => ({ path: segs.join('/') });
const snapOf = (path) => {
  const d = server.get(path);
  return { exists: () => d !== undefined, data: () => clone(d), id: path.split('/').pop(), metadata: { fromCache: false } };
};
const docsUnder = (col) => [...server.keys()]
  .filter((p) => p.startsWith(`${col}/`) && !p.slice(col.length + 1).includes('/'))
  .map((p) => snapOf(p));
const deepMerge = (a, b) => {
  const out = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
      ? deepMerge(out[k], v) : v;
  }
  return out;
};
const tick = () => new Promise((r) => setTimeout(r, 1));
const write = (path, data, opts) => server.set(path, opts?.merge ? deepMerge(server.get(path), clone(data)) : clone(data));

export function hold(dev, beforeCommit) { holds.set(dev, beforeCommit); }
let offline = false;
export function setOffline(v) { offline = v; }
export function resetServer() { server.clear(); holds.clear(); log.length = 0; offline = false; c.authInstance.currentUser = { uid: 'student1' }; }
const online = () => { if (offline) { const e = new Error('offline'); e.code = 'unavailable'; throw e; } };

const firestore = {
  collection: ref,
  doc: ref,
  query: (r) => r,
  where: () => null,
  getDocsFromServer: async (r) => { await tick(); online(); return { docs: docsUnder(r.path) }; },
  getDocs: async (r) => ({ docs: docsUnder(r.path) }),
  getDocFromServer: async (r) => { await tick(); online(); return snapOf(r.path); },
  getDoc: async (r) => snapOf(r.path),
  setDoc: async (r, data, opts) => { write(r.path, data, opts); },
  deleteDoc: async (r) => { server.delete(r.path); },
  serverTimestamp: () => Date.now(),
  runTransaction: async (_db, fn) => {
    online();
    const dev = device();
    const gate = holds.get(dev);
    if (gate) { holds.delete(dev); await gate(); }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reads = new Map();
      const writes = [];
      const tx = {
        get: async (r) => { await tick(); reads.set(r.path, JSON.stringify(server.get(r.path) ?? null)); return snapOf(r.path); },
        set: (r, data, opts) => { writes.push(['set', r.path, clone(data), opts]); return tx; },
        delete: (r) => { writes.push(['del', r.path]); return tx; },
      };
      // eslint-disable-next-line no-await-in-loop
      const result = await fn(tx);
      const stale = [...reads].some(([p, seen]) => JSON.stringify(server.get(p) ?? null) !== seen);
      if (stale) continue; // Firestore reruns the function against fresh reads
      for (const [kind, path, data, opts] of writes) {
        if (kind === 'del') server.delete(path); else write(path, data, opts);
      }
      log.push(`${dev} committed ${writes.map((w) => w[1]).join(', ')}`);
      return result;
    }
    throw new Error('transaction kept conflicting');
  },
};

const c = {
  db: {},
  firestore,
  storage: { ref: () => ({}), getBlob: async () => null, uploadString: async () => {}, getMetadata: async () => {} },
  storageInstance: null,
  authInstance: { currentUser: { uid: 'student1' } },
};

export const cloud = async () => c;
export const signInAs = (uid) => { c.authInstance.currentUser = uid ? { uid } : null; };
export const cloudConfigured = true;

// Run `fn` as a named device: its idb-keyval calls see that device's storage.
export const asDevice = (dev, fn) => deviceContext.run({ device: dev }, fn);
