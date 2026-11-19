// Where you left off in a chapter's video (components/ChapterVideo.jsx).
//
// Two copies of the same bookmark. One on this device, written every few
// seconds while the video plays, so closing the app mid-sentence loses at
// most a moment. One in your synced settings (`settings.videoSpots`), written
// only when you pause, leave the chapter or put the app away — never while it
// plays, which would be a sync every few seconds — so stopping on the iPad
// picks up on the phone. Opening a video, the newer of the two wins.
//
// Keyed by the video's id: an uploaded file's own id, or the YouTube or
// Vimeo video's. Settings belong to an account, so a student has their own
// bookmarks and a chapter copied to them never brings yours.
//
// A spot is { at, dur, t }: seconds in, the video's length when known, and
// when it was saved. Under a few seconds in there's nothing to come back
// to; near the end, it was watched — both clear the bookmark.

export const MIN_SPOT = 5; // seconds in before it's worth remembering
export const END_MARGIN = 15; // seconds from the end that count as finished
export const MAX_SPOTS = 200; // the newest this many are kept
const DEVICE_KEY = 'rl-video-spots-v1';

// The spot to keep for `at` seconds into a video `dur` long — or null: too
// early to matter, or watched to the end.
export function spotFor(at, dur, now = Date.now()) {
  const s = Number(at);
  if (!Number.isFinite(s) || s < MIN_SPOT) return null;
  const d = Number(dur);
  const known = Number.isFinite(d) && d > 0;
  if (known && s >= d - END_MARGIN) return null;
  return { at: Math.floor(s), ...(known ? { dur: Math.round(d) } : {}), t: now };
}

// The newer of two copies of a bookmark (either may be missing). A cleared
// one is kept as { t, at: null } so it can win over an older spot.
export function newerSpot(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return (b.t ?? 0) > (a.t ?? 0) ? b : a;
}

// The seconds to pick up from, or null.
export const resumeAt = (spot) => (spot && Number.isFinite(spot.at) ? spot.at : null);

// A map of bookmarks with `key`'s set to `spot` (null: cleared), the oldest
// dropped past MAX_SPOTS. Cleared ones are kept, briefly, as tombstones so an
// older copy elsewhere doesn't bring a finished video back.
export function withSpot(map, key, spot, now = Date.now()) {
  if (!key) return map ?? {};
  const next = { ...(map ?? {}), [key]: spot ?? { at: null, t: now } };
  const keys = Object.keys(next);
  if (keys.length <= MAX_SPOTS) return next;
  keys.sort((x, y) => (next[y]?.t ?? 0) - (next[x]?.t ?? 0));
  return Object.fromEntries(keys.slice(0, MAX_SPOTS).map((k) => [k, next[k]]));
}

// ---------------------------------------------------------------------------
// This device's copy. Browser storage can be missing or refuse (a private
// window, cleared site data): then it's simply not remembered here.
// ---------------------------------------------------------------------------

let cache = null;
function deviceMap() {
  if (cache) return cache;
  try {
    cache = JSON.parse(globalThis.localStorage?.getItem(DEVICE_KEY) ?? '{}') ?? {};
  } catch {
    cache = {};
  }
  return cache;
}

export const deviceSpot = (key) => (key ? deviceMap()[key] ?? null : null);

export function saveDeviceSpot(key, spot, now = Date.now()) {
  if (!key) return;
  cache = withSpot(deviceMap(), key, spot, now);
  try { globalThis.localStorage?.setItem(DEVICE_KEY, JSON.stringify(cache)); } catch { /* not kept here */ }
}

// For the tests: as if the app had just started.
export function forgetDeviceCache() { cache = null; }

// The bookmark for a video: the newer of this device's and the synced one.
export const spotOf = (key, synced) => newerSpot(deviceSpot(key), synced?.[key] ?? null);

// ---------------------------------------------------------------------------
// YouTube and Vimeo players say where they are by postMessage, once asked —
// no SDK needed. These read those messages: { at?, dur?, paused?, ended? },
// or null for anything else.
// ---------------------------------------------------------------------------

const asObj = (data) => {
  if (data && typeof data === 'object') return data;
  if (typeof data !== 'string') return null;
  try { return JSON.parse(data); } catch { return null; }
};

// YouTube (embed URL with enablejsapi=1, after a {"event":"listening"}):
// "infoDelivery" with currentTime / duration / playerState as they change;
// "onStateChange" with the state alone. States: 0 ended, 1 playing, 2 paused.
export function readYouTube(data) {
  const m = asObj(data);
  if (!m || (m.event !== 'infoDelivery' && m.event !== 'onStateChange' && m.event !== 'initialDelivery')) return null;
  const info = m.event === 'onStateChange' ? { playerState: m.info } : (m.info ?? {});
  const out = {};
  if (Number.isFinite(info.currentTime)) out.at = info.currentTime;
  if (Number.isFinite(info.duration) && info.duration > 0) out.dur = info.duration;
  if (info.playerState === 0) out.ended = true;
  if (info.playerState === 2) out.paused = true;
  if (info.playerState === 1) out.playing = true;
  return Object.keys(out).length ? out : null;
}

// Vimeo (player.js messages, after addEventListener for each event): "ready",
// then "timeupdate" / "pause" / "ended" with { seconds, duration }.
export function readVimeo(data) {
  const m = asObj(data);
  if (!m || typeof m.event !== 'string') return null;
  if (m.event === 'ready') return { ready: true };
  if (!['timeupdate', 'pause', 'ended', 'play', 'seeked'].includes(m.event)) return null;
  const d = m.data ?? {};
  const out = {};
  if (Number.isFinite(d.seconds)) out.at = d.seconds;
  if (Number.isFinite(d.duration) && d.duration > 0) out.dur = d.duration;
  if (m.event === 'pause') out.paused = true;
  if (m.event === 'ended') out.ended = true;
  if (m.event === 'play') out.playing = true;
  return out;
}

// What to send a player so it starts reporting.
export const YOUTUBE_LISTEN = JSON.stringify({ event: 'listening', id: 'rl-video', channel: 'widget' });
export const VIMEO_LISTEN = ['timeupdate', 'pause', 'ended', 'play', 'seeked']
  .map((value) => JSON.stringify({ method: 'addEventListener', value }));
