// Turning a pasted video link into something playable, and formatting the
// timestamps that link a moment in it to a variation.

const YOUTUBE_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const VIMEO_RE = /vimeo\.com\/(?:video\/)?(\d+)/;
const DIRECT_FILE_RE = /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i;

// { kind: 'youtube' | 'vimeo' | 'file' | 'unknown', embedUrl?, ... }
export function classifyVideoUrl(url) {
  const text = String(url ?? '').trim();
  const yt = text.match(YOUTUBE_RE);
  if (yt) return { kind: 'youtube', id: yt[1] };
  const vm = text.match(VIMEO_RE);
  if (vm) return { kind: 'vimeo', id: vm[1] };
  if (DIRECT_FILE_RE.test(text)) return { kind: 'file-url', url: text };
  return { kind: 'unknown', url: text };
}

// A start time only takes effect on load for an iframe embed — there's no
// livepostMessage seek without pulling in each platform's player SDK, so
// jumping to a new timestamp on an already-open embed means reloading it
// with a new `start=`/`#t=` param. That's a visible reload, not a smooth
// seek, and is disclosed in the UI rather than pretended away.
export function embedSrc({ kind, id }, startSeconds = 0) {
  const s = Math.max(0, Math.floor(startSeconds));
  if (kind === 'youtube') return `https://www.youtube.com/embed/${id}?start=${s}`;
  if (kind === 'vimeo') return `https://player.vimeo.com/video/${id}#t=${s}s`;
  return null;
}

export function fmtTime(seconds) {
  const s = Math.max(0, Math.round(seconds ?? 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
