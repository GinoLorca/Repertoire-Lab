// Chapter videos in the cloud — src/lib/cloud/videos.js, against a fake
// bucket: upload once (with progress), stream, save for offline, delete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  videoPath, cloudVideosReady, startUpload, uploadStatus, watchUpload, cloudVideoUrl, saveOffline, deleteCloudVideo,
} from '../src/lib/cloud/videos.js';
import { getVideo } from '../src/lib/videoStore.js';

// A bucket in memory, with Firebase Storage's calls.
function fakeCloud({ signedIn = true, bucket = true, failUpload = false } = {}) {
  const objects = new Map();
  const deleted = [];
  const storage = {
    ref: (_, path) => ({ path }),
    uploadBytesResumable: (r, file, meta) => {
      const handlers = {};
      setTimeout(() => {
        handlers.next?.({ bytesTransferred: file.size / 2, totalBytes: file.size });
        if (failUpload) { handlers.error?.({ code: 'storage/unauthorized' }); return; }
        handlers.next?.({ bytesTransferred: file.size, totalBytes: file.size });
        objects.set(r.path, { file, meta });
        handlers.complete?.();
      }, 0);
      return { on: (_e, next, error, complete) => Object.assign(handlers, { next, error, complete }) };
    },
    getDownloadURL: async (r) => `https://bucket.example/${r.path}?token=t`,
    deleteObject: async (r) => { deleted.push(r.path); objects.delete(r.path); },
  };
  const c = {
    storage,
    storageInstance: bucket ? {} : null,
    authInstance: { currentUser: signedIn ? { uid: 'u1' } : null },
  };
  return { get: () => c, objects, deleted };
}
const until = (cond) => new Promise((resolve) => {
  const tick = () => (cond() ? resolve() : setTimeout(tick, 1));
  tick();
});

test('the cloud holds videos only signed in, with a bucket', async () => {
  assert.equal(await cloudVideosReady(fakeCloud().get), true);
  assert.equal(await cloudVideosReady(fakeCloud({ signedIn: false }).get), false);
  assert.equal(await cloudVideosReady(fakeCloud({ bucket: false }).get), false);
  assert.equal(videoPath('u1', 'v9'), 'users/u1/videos/v9');
});

test('upload: under your own account, progress as it goes, the record when done', async () => {
  const f = fakeCloud();
  const file = new Blob([new Uint8Array(1000)], { type: 'video/mp4' });
  let record = null;
  const seen = [];
  assert.equal(await startUpload({ videoId: 'v1', file, onDone: (r) => { record = r; } }, f.get), true);
  const off = watchUpload('v1', (u) => seen.push(u.done ? 'done' : u.progress));
  assert.equal(await startUpload({ videoId: 'v1', file }, f.get), false, 'not twice at once');
  await until(() => record);
  off();
  assert.deepEqual(record.path, 'users/u1/videos/v1');
  assert.equal(record.size, 1000);
  assert.equal(f.objects.get('users/u1/videos/v1').meta.contentType, 'video/mp4');
  assert.deepEqual(seen, [0.5, 1, 'done']);
  assert.equal(uploadStatus('v1'), null, 'finished: nothing left in progress');
});

test('a failed upload says so, and can be tried again', async () => {
  const file = new Blob([new Uint8Array(10)], { type: 'video/quicktime' });
  await startUpload({ videoId: 'v2', file }, fakeCloud({ failUpload: true }).get);
  await until(() => uploadStatus('v2')?.error);
  assert.equal(uploadStatus('v2').error, 'storage/unauthorized');
  let done = false;
  assert.equal(await startUpload({ videoId: 'v2', file, onDone: () => { done = true; } }, fakeCloud().get), true);
  await until(() => done);
});

test('stream from a link; save for offline onto this device', async () => {
  const f = fakeCloud();
  const url = await cloudVideoUrl('users/u1/videos/v3', f.get);
  assert.equal(url, 'https://bucket.example/users/u1/videos/v3?token=t');
  const bytes = new Uint8Array(300).fill(7);
  const fakeFetch = async (u) => {
    assert.equal(u, url);
    let sent = false;
    return {
      ok: true,
      headers: new Map([['content-length', '300'], ['content-type', 'video/mp4']]),
      body: { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: bytes })) }) },
    };
  };
  const progress = [];
  await saveOffline({ videoId: 'v3', path: 'users/u1/videos/v3', onProgress: (p) => progress.push(p) }, f.get, fakeFetch);
  const stored = await getVideo('v3');
  assert.equal(stored.size, 300);
  assert.equal(stored.type, 'video/mp4');
  assert.equal(progress.at(-1), 1);
  assert.equal(await cloudVideoUrl('x', fakeCloud({ signedIn: false }).get), null);
});

test('removed: the cloud copy goes too', async () => {
  const f = fakeCloud();
  await deleteCloudVideo('users/u1/videos/v4', f.get);
  assert.deepEqual(f.deleted, ['users/u1/videos/v4']);
  await deleteCloudVideo(null, f.get);
  assert.equal(f.deleted.length, 1);
});
