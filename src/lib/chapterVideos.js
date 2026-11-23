// Several videos in one chapter.
//
// A chapter put together from more than one course has more than one
// explanation: the lines from one course are talked through in its video, the
// lines from another in theirs. So a chapter holds as many videos as it
// needs, and each line that's linked to a moment says which video the moment
// is in.
//
//   chapter.video       the first video, where a chapter's one video has
//                       always been — an app from before this (a device not
//                       yet updated, a student's) shows it and never knows
//                       there are more.
//   chapter.moreVideos  the others, in the order they were added. Left off
//                       entirely while there are none, so a chapter with one
//                       video is stored exactly as it always was.
//   line.videoTimestamp the moment (seconds), as before;
//   line.videoId        the video it's in. Without one: the first video —
//                       which is every link made while a chapter had one.
//
// Pure functions over a chapter; the store's actions are thin wrappers
// (store.jsx), and the files themselves are lib/videoStore's business.

const isVideo = (v) => Boolean(v) && typeof v === 'object' && typeof v.id === 'string' && v.id !== '';

// Every video of a chapter, the first first. (A video's id is its own: a
// second copy of one already there isn't listed twice.)
export function videosOf(chapter) {
  const out = [];
  const seen = new Set();
  const more = Array.isArray(chapter?.moreVideos) ? chapter.moreVideos : [];
  for (const v of [chapter?.video, ...more]) {
    if (!isVideo(v) || seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
  }
  return out;
}

export const hasVideo = (chapter) => videosOf(chapter).length > 0;

// The chapter with `list` as its videos, in the form above.
function withVideos(chapter, list) {
  const { moreVideos: _gone, ...rest } = chapter;
  const next = { ...rest, video: list[0] ?? null };
  if (list.length > 1) next.moreVideos = list.slice(1);
  return next;
}

const mapLines = (chapter, fn) => {
  let changed = false;
  const variations = (chapter.variations ?? []).map((v) => {
    const out = fn(v);
    if (out !== v) changed = true;
    return out;
  });
  return changed ? { ...chapter, variations } : chapter;
};

const without = (line, ...keys) => {
  const out = { ...line };
  for (const k of keys) delete out[k];
  return out;
};

// The video a line's moment is in, or null: not linked, or its video is no
// longer in the chapter.
//
// In a chapter with one video a link is to that video, whatever it's named
// for — as every link was while a chapter had one. (An app from before this
// replaces the video without re-pointing the links, having never heard of
// them naming one; "in case a replacement runs the same way" still holds.)
export function videoOfLine(chapter, line) {
  if (line?.videoTimestamp == null) return null;
  const all = videosOf(chapter);
  if (!all.length) return null;
  if (all.length === 1 || line.videoId == null) return all[0];
  return all.find((v) => v.id === line.videoId) ?? null;
}

// A line linked to `seconds` in video `videoId` (always named: a link made
// now stays with its video whatever is added or taken away later) — or, with
// no seconds, unlinked.
export function linkLine(line, seconds, videoId = null) {
  if (seconds == null) {
    return 'videoTimestamp' in line || 'videoId' in line ? without(line, 'videoTimestamp', 'videoId') : line;
  }
  const next = { ...line, videoTimestamp: seconds };
  if (videoId) next.videoId = videoId; else delete next.videoId;
  return next;
}

// Another video for the chapter (one it already has changes nothing).
//
// The first one added to a chapter that has none takes up the links a
// removed video left behind — "in case a replacement runs the same way", as
// removing the only video has always promised. A second one makes the links
// already there say which video they mean: until now there was only one.
export function addVideo(chapter, video) {
  if (!isVideo(video)) return chapter;
  const all = videosOf(chapter);
  if (all.some((v) => v.id === video.id)) return chapter;
  let next = chapter;
  if (all.length === 0) {
    next = mapLines(next, (l) => (l.videoTimestamp != null && l.videoId != null ? without(l, 'videoId') : l));
  } else if (all.length === 1) {
    const first = all[0].id;
    next = mapLines(next, (l) => (l.videoTimestamp != null && l.videoId !== first ? { ...l, videoId: first } : l));
  }
  return withVideos(next, [...all, video]);
}

// One video replaced by another, in its place. Lines linked to the old one
// keep their moments, now in the new one.
export function replaceVideo(chapter, oldId, video) {
  if (!isVideo(video)) return chapter;
  const all = videosOf(chapter);
  const at = all.findIndex((v) => v.id === oldId);
  if (at < 0) return addVideo(chapter, video);
  // (Replaced by one the chapter already has elsewhere: that one moves here.)
  const list = all.filter((v, i) => i === at || v.id !== video.id);
  list[list.indexOf(all[at])] = video;
  const next = mapLines(chapter, (l) => {
    if (l.videoTimestamp == null) return l;
    const its = videoOfLine(chapter, l);
    if (!its || its.id !== oldId) return l; // another video's link: as it was
    // (A link that never named its video, in a chapter with just the one,
    // goes on not needing to.)
    if (l.videoId == null && list.length === 1) return l;
    return l.videoId === video.id ? l : { ...l, videoId: video.id };
  });
  return withVideos(next, list);
}

// A video taken out. While others remain, the lines linked to it lose that
// link (their moments were in a film that's gone, and would land somewhere
// meaningless in another). Taking out the only video leaves the moments
// where they are, for a replacement.
export function removeVideo(chapter, id) {
  const all = videosOf(chapter);
  const at = all.findIndex((v) => v.id === id);
  if (at < 0) return chapter;
  const list = all.filter((v) => v.id !== id);
  if (!list.length) return withVideos(chapter, []);
  // Each link by the video it's really in (videoOfLine): the removed one's
  // go, and so does any into a video the chapter no longer had — it would
  // otherwise come back to life pointing into whichever one is left.
  const next = mapLines(chapter, (l) => {
    if (l.videoTimestamp == null) return l;
    const its = videoOfLine(chapter, l);
    if (!its || its.id === id) return without(l, 'videoTimestamp', 'videoId');
    return l.videoId === its.id ? l : { ...l, videoId: its.id };
  });
  return withVideos(next, list);
}

const mapVideo = (chapter, id, fn) => {
  const all = videosOf(chapter);
  if (!all.some((v) => v.id === id)) return chapter;
  return withVideos(chapter, all.map((v) => (v.id === id ? fn(v) : v)));
};

// A video's file, now in the cloud too (lib/cloud/videos.js).
export const withVideoCloud = (chapter, id, cloud) => mapVideo(chapter, id, (v) => ({ ...v, cloud }));

// A video's own name ("The London — Simon's course"). Empty: back to none.
export function withVideoTitle(chapter, id, title) {
  const clean = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return mapVideo(chapter, id, (v) => (clean ? { ...v, title: clean } : without(v, 'title')));
}

// A line going from one chapter to another keeps its moment only if the
// chapter it arrives in has that same video.
export function lineBetween(line, from, to) {
  if (line.videoTimestamp == null) return 'videoId' in line ? without(line, 'videoId') : line;
  const its = videoOfLine(from, line);
  const there = its ? videosOf(to) : [];
  if (!its || !there.some((v) => v.id === its.id)) return without(line, 'videoTimestamp', 'videoId');
  // Named, unless it's the one video there (which is how such a link has always been kept).
  if (there.length === 1) return line.videoId == null ? line : without(line, 'videoId');
  return line.videoId === its.id ? line : { ...line, videoId: its.id };
}

// Several chapters becoming one (lib/curate): every video comes along, in
// the chapters' order, and every line stays linked to its own.
//   → { videos, line(line, itsChapter), onto(theOneChapter) }
export function gatherVideos(chapters) {
  const videos = [];
  const seen = new Set();
  for (const c of chapters ?? []) {
    for (const v of videosOf(c)) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      videos.push(v);
    }
  }
  const many = videos.length > 1;
  return {
    videos,
    line(line, chapter) {
      if (line.videoTimestamp == null) return 'videoId' in line ? without(line, 'videoId') : line;
      const its = videoOfLine(chapter, line);
      if (!its) return without(line, 'videoTimestamp', 'videoId');
      if (!many) return line.videoId == null ? line : without(line, 'videoId');
      return line.videoId === its.id ? line : { ...line, videoId: its.id };
    },
    // (A chapter that had no video and gets none is left exactly as it is.)
    onto(chapter) {
      if (!videos.length && chapter.video == null && !('moreVideos' in chapter)) return chapter;
      return withVideos(chapter, videos);
    },
  };
}

// ---------- What to call one ----------

const SOURCE = {
  youtube: 'YouTube', vimeo: 'Vimeo', file: 'Uploaded video', 'file-url': 'Video link',
};
export const videoSource = (video) => SOURCE[video?.kind] ?? 'Video';

// Its own name; else an uploaded file's name without the extension; else
// "Video 2" by its place.
export function videoLabel(video, index = 0) {
  const title = String(video?.title ?? '').trim();
  if (title) return title;
  const file = video?.kind === 'file' ? String(video.name ?? '').replace(/\.[a-z0-9]{2,5}$/i, '').trim() : '';
  if (file) return file.length > 48 ? `${file.slice(0, 47)}…` : file;
  return `Video ${index + 1}`;
}

// A still for a video that isn't the one playing: YouTube's own, or none.
export const videoPoster = (video) => (video?.kind === 'youtube' && /^[\w-]{11}$/.test(video.id)
  ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`
  : null);

// ---------- Which one is in front ----------
// On the chapter's page the videos are a stack: one in front, playing; the
// rest behind it. Which is in front is remembered per chapter on this device
// (it's where you were, not part of the chapter).

const FRONT_KEY = 'rl.chapterVideos.front';
const FRONT_MAX = 300;

function readFronts() {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(FRONT_KEY) ?? 'null');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

export function frontFor(chapterId, videos) {
  const all = videos ?? [];
  if (!all.length) return null;
  const kept = chapterId ? readFronts()[chapterId] : null;
  return (all.find((v) => v.id === kept) ?? all[0]).id;
}

export function keepFront(chapterId, videoId) {
  if (!chapterId) return;
  try {
    const all = readFronts();
    delete all[chapterId];
    if (videoId) all[chapterId] = videoId;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - FRONT_MAX))) delete all[k];
    globalThis.localStorage?.setItem(FRONT_KEY, JSON.stringify(all));
  } catch { /* a private window: just for now, then */ }
}
