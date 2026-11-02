// Chapter videos in the cloud: uploaded once from whichever device added
// one, then played on every other device straight from the bucket, or saved
// to that device for offline (lib/videoStore.js keeps it there, as it keeps
// the copy on the device it came from).
//
// Each lives at users/<uid>/videos/<video id> — your own account's corner of
// the bucket, which firebase/storage.rules lets only you read or write. The
// chapter records where (`video.cloud = { path, size, uploadedAt }`), and that
// syncs with the chapter like everything else.
//
// Every function takes the cloud as an optional last argument, for tests.

import { cloud } from './app';
import { putVideo } from '../videoStore';

export const videoPath = (uid, videoId) => `users/${uid}/videos/${videoId}`;

// The cloud, when it can hold videos: configured, signed in, with a bucket.
async function ready(get = cloud) {
  const c = await Promise.resolve().then(get).catch(() => null);
  const uid = c?.authInstance?.currentUser?.uid;
  if (!c?.storageInstance || !uid) return null;
  return { c, uid };
}

export async function cloudVideosReady(get) {
  return Boolean(await ready(get));
}

// Uploads under way, by video id. Kept here rather than in the player, so an
// upload carries on — and its progress still shows — while you move between
// chapters. Gone once it's finished; one that failed stays, to be retried.
const uploads = new Map(); // id → { progress, error, listeners }

export function uploadStatus(videoId) {
  const u = uploads.get(videoId);
  return u ? { progress: u.progress, error: u.error } : null;
}

// `cb({ progress, error, done })` as it goes; returns the unsubscribe.
export function watchUpload(videoId, cb) {
  const u = uploads.get(videoId);
  if (!u) return () => {};
  u.listeners.add(cb);
  return () => u.listeners.delete(cb);
}

// Starts uploading `file` (a File or Blob) for the video `videoId`; `onDone`
// gets the chapter's `cloud` record once it's all there. False when the
// cloud can't take it (signed out, no bucket) or it's already on its way.
export async function startUpload({ videoId, file, onDone }, get) {
  const live = uploads.get(videoId);
  if (live && !live.error) return false;
  const r = await ready(get);
  if (!r) return false;
  const { c, uid } = r;
  const path = videoPath(uid, videoId);
  const { ref, uploadBytesResumable } = c.storage;
  const entry = { progress: 0, error: null, listeners: live?.listeners ?? new Set() };
  uploads.set(videoId, entry);
  const emit = (extra = {}) => entry.listeners.forEach((cb) => cb({ progress: entry.progress, error: entry.error, ...extra }));
  emit();
  // Resumable: a dropped connection picks up where it left off, as long as
  // the app's still open.
  const task = uploadBytesResumable(ref(c.storageInstance, path), file, {
    contentType: file.type || 'video/mp4',
  });
  task.on(
    'state_changed',
    (snap) => {
      entry.progress = snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0;
      emit();
    },
    (err) => {
      entry.error = err?.code ?? 'failed';
      emit();
    },
    () => {
      uploads.delete(videoId);
      entry.progress = 1;
      onDone?.({ path, size: file.size, uploadedAt: Date.now() });
      emit({ done: true });
    },
  );
  return true;
}

// A link the player can stream from (it carries its own access token).
export async function cloudVideoUrl(path, get) {
  const r = await ready(get);
  if (!r) return null;
  const { ref, getDownloadURL } = r.c.storage;
  return getDownloadURL(ref(r.c.storageInstance, path));
}

// Downloads the video to this device, under its id, so it plays offline
// from then on. `onProgress(0..1)` as it comes in.
export async function saveOffline({ videoId, path, onProgress }, get, fetchImpl = globalThis.fetch) {
  const url = await cloudVideoUrl(path, get);
  if (!url) throw new Error('not signed in');
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const type = res.headers.get('content-type') || 'video/mp4';
  let blob;
  if (res.body?.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (total) onProgress?.(loaded / total);
    }
    blob = new Blob(chunks, { type });
  } else {
    blob = await res.blob();
  }
  await putVideo(videoId, blob);
  onProgress?.(1);
}

// The cloud copy, gone with the video — so a removed or replaced video
// isn't paid for. Best effort: a copy that's already gone is fine.
export async function deleteCloudVideo(path, get) {
  if (!path) return;
  uploads.delete(path.split('/').pop());
  const r = await ready(get);
  if (!r) return;
  const { ref, deleteObject } = r.c.storage;
  await deleteObject(ref(r.c.storageInstance, path)).catch(() => {});
}
