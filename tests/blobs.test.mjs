// Pictures stored inline in Firestore when there's no Storage bucket — see
// src/lib/cloud/blobs.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeInlineStore, CHUNK, MAX_TOTAL } from '../src/lib/cloud/blobs.js';
import {
  toCloud, fromCloud, localBlobIndex, keepLocalImages, encodeForStore, decodeFromStore, SKIP, hashOf,
} from '../src/lib/cloud/shape.js';

function fakeDb({ failOn = () => false } = {}) {
  const store = new Map();
  let reads = 0; let writes = 0; let calls = 0;
  const firestore = {
    doc: (_db, ...parts) => parts.join('/'),
    setDoc: async (path, data) => {
      calls += 1;
      if (failOn(calls)) throw new Error('refused');
      writes += 1; store.set(path, data);
    },
    getDoc: async (path) => {
      reads += 1;
      const data = store.get(path);
      return { exists: () => data !== undefined, data: () => data };
    },
  };
  return { firestore, store, counts: () => ({ reads, writes }) };
}
const img = (n) => `data:image/jpeg;base64,${'A'.repeat(n)}`;
const inline = (db, hashes = {}) => makeInlineStore({ db: {}, firestore: db.firestore, uid: 'u1', meta: { hashes } });
const stateWith = (artwork) => ({
  openings: [{ id: 'op1', name: 'Jobava', artwork, chapters: [{ id: 'ch1', name: 'Main', variations: [{ id: 'v1', name: 'L', moves: ['d4'] }] }] }],
  players: [], labEntries: [], categories: [], playlists: [], savedPositions: [], settings: {},
});

test('a picture is stored once, keyed by its contents, and read back exactly', async () => {
  const db = fakeDb();
  const s = inline(db);
  const ref = await s.upload(img(400));
  assert.equal(ref.__doc, hashOf(img(400)));
  assert.equal(ref.hash, ref.__doc);
  assert.deepEqual(await s.upload(img(400)), ref);
  assert.equal(db.counts().writes, 1);
  assert.equal(await s.download(ref), img(400));
});

test('a picture past every limit is skipped and counted, never written', async () => {
  const db = fakeDb();
  const s = inline(db);
  assert.equal(await s.upload(img(MAX_TOTAL + 1)), SKIP);
  assert.equal(s.stats.tooBig, 1);
  assert.equal(db.counts().writes, 0);
});

test('a refused write, or a missing picture, skips instead of throwing', async () => {
  const refused = inline(fakeDb({ failOn: () => true }));
  assert.equal(await refused.upload(img(400)), SKIP);
  assert.equal(refused.stats.skipped, 1);
  const s = inline(fakeDb());
  assert.equal(await s.download({ __doc: 'nope', hash: 'nope' }), null);
});

test('Mac to iPad: artwork arrives with the lines, and is never fetched twice', async () => {
  const db = fakeDb();
  const local = stateWith({ medium: img(400), thumb: img(120) });
  const docs = await toCloud(local, (_p, d) => inline(db).upload(d));
  const wire = decodeFromStore(JSON.parse(JSON.stringify(encodeForStore(docs))));
  assert.equal(typeof wire.openings[0].artwork.medium.__doc, 'string');
  const ipad = inline(db);
  const pulled = await fromCloud(wire, (r) => ipad.download(r), new Map());
  assert.equal(pulled.openings[0].artwork.medium, img(400));
  assert.equal(pulled.openings[0].artwork.thumb, img(120));
  assert.equal(pulled.openings[0].chapters[0].variations[0].moves[0], 'd4');
  const before = db.counts().reads;
  await fromCloud(wire, (r) => ipad.download(r), localBlobIndex(local));
  assert.equal(db.counts().reads, before);
});

test('a wallpaper is split across documents and reassembled exactly', async () => {
  const db = fakeDb();
  const wall = img(CHUNK * 2 + 5000);
  const ref = await inline(db).upload(wall);
  assert.equal(db.counts().writes, 3);
  assert.equal(await inline(db).download(ref), wall);
});

test('an upload that dies halfway reads back as nothing, never as half a picture', async () => {
  const db = fakeDb({ failOn: (n) => n === 2 });
  const wall = img(CHUNK * 2 + 5000);
  assert.equal(await inline(db).upload(wall), SKIP);
  assert.equal(await inline(db).download({ __doc: hashOf(wall), hash: hashOf(wall) }), null);
});

test('a picture that can’t travel still never disappears from the device that has it', async () => {
  const db = fakeDb();
  const huge = img(MAX_TOTAL + 1);
  const local = stateWith({ medium: huge });
  const docs = await toCloud(local, (_p, d) => inline(db).upload(d));
  assert.equal(docs.openings[0].artwork.medium, undefined);
  const pulled = await fromCloud(docs, (r) => inline(db).download(r), new Map());
  assert.equal(keepLocalImages(pulled, local).openings[0].artwork.medium, huge);
});
