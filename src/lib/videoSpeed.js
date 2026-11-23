// How fast a chapter's video plays (components/ChapterVideo.jsx): slowed down
// to follow a line move by move, or sped up through what you already know.
//
// The steps are YouTube's own, so an uploaded file, a YouTube video and a
// Vimeo one all offer the same ones. An uploaded file (or a direct link) is
// a <video> and simply plays at the rate; YouTube and Vimeo players are told
// by postMessage, the way they're asked where they are (lib/videoSpots.js) —
// no SDK. Vimeo only obeys where the video's owner allows speed changes.
//
// The speed is remembered on this device: it's how you watch, not part of a
// chapter.

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
export const NORMAL_SPEED = 1;

// The step nearest to any rate (a player may report one of its own).
export function nearestSpeed(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return NORMAL_SPEED;
  return SPEEDS.reduce((best, s) => (Math.abs(s - r) < Math.abs(best - r) ? s : best), NORMAL_SPEED);
}

// One step slower (-1) or faster (+1), stopping at either end.
export function stepSpeed(rate, dir) {
  const at = SPEEDS.indexOf(nearestSpeed(rate));
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, at + (dir < 0 ? -1 : 1)))];
}

// "0.75×", "1×", "1.5×"
export const speedLabel = (rate) => `${nearestSpeed(rate)}×`;
// …and as the picker lists them: the same, with normal speed said so.
export const speedName = (rate) => {
  const r = nearestSpeed(rate);
  return r === NORMAL_SPEED ? `${r}× · normal` : `${r}×`;
};

// What to send a player to set its speed. YouTube's is a "command" naming one
// of its player's functions (the embed has to have been loaded with
// enablejsapi=1, as lib/videoLinks.js does); Vimeo's is its player.js message,
// { method, value }. Each answers with the speed it's now at, or — Vimeo, for
// a video whose owner hasn't allowed it — with an error (lib/videoSpots.js
// reads both).
export const youTubeSpeed = (rate) => JSON.stringify({
  event: 'command', func: 'setPlaybackRate', args: [nearestSpeed(rate)], id: 'rl-video', channel: 'widget',
});
export const vimeoSpeed = (rate) => JSON.stringify({ method: 'setPlaybackRate', value: nearestSpeed(rate) });

// ---------- This device's speed ----------

const KEY = 'rl.video.speed';

export function readSpeed() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw == null ? NORMAL_SPEED : nearestSpeed(Number(raw));
  } catch { return NORMAL_SPEED; }
}

export function keepSpeed(rate) {
  try {
    const r = nearestSpeed(rate);
    if (r === NORMAL_SPEED) globalThis.localStorage?.removeItem(KEY);
    else globalThis.localStorage?.setItem(KEY, String(r));
  } catch { /* a private window: just for now, then */ }
}
