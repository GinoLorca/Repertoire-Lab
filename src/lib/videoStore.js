// Video files, stored separately from the app's main state.
//
// A chapter's video lives here as a raw Blob in its own IndexedDB database —
// not inside the `repertoire-lab-state-v1` object idb-keyval already uses for
// everything else. That state is read and re-written as one JSON-shaped
// object on every change; a few hundred megabytes of video sitting inside it
// would turn every star click into a multi-second stall, and would make the
// Backup file (which *is* that JSON, verbatim) impossible to produce. Keeping
// video in its own store means the ordinary state stays fast, and the video
// still plays with zero network once it's here — which is what "offline"
// actually requires: the bytes have to already be on the device, not just
// cached by a service worker that might evict them.
//
// A chapter only ever points at a video by id (see chapter.video in
// store.jsx); this module is the only thing that touches the bytes.

import { createStore, get, set, del } from 'idb-keyval';

const store = createStore('repertoire-lab-videos', 'files');

export const MAX_VIDEO_BYTES = 800 * 1024 * 1024; // generous, but not "fill the disk"

export async function putVideo(id, file) {
  await set(id, file, store);
}

export async function getVideo(id) {
  return get(id, store);
}

export async function deleteVideo(id) {
  await del(id, store);
}

// A blob: URL for the <video> tag — revoke it when the player unmounts or
// swaps videos, or the browser holds the memory until the tab closes.
export async function videoObjectUrl(id) {
  const blob = await getVideo(id);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}
