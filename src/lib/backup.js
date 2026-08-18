// Combining a restored backup with what's already on this device, instead of
// the older "Replace everything" that just discarded one side. Built for the
// cross-device case: you practice on your phone, back up, restore on your
// Mac — and the Mac had its own progress on overlapping lines that a plain
// replace would have thrown away. Real sync (one shared source of truth) is
// a bigger project; this is the practical version of it for now.

// Union two arrays of records that share an `id`, resolving anything present
// on both sides with `mergeItem(local, incoming)`. An id only on one side
// passes straight through untouched.
function mergeById(localArr, incomingArr, mergeItem) {
  const map = new Map((localArr ?? []).map((x) => [x.id, x]));
  for (const item of incomingArr ?? []) {
    map.set(item.id, mergeItem(map.get(item.id), item));
  }
  return [...map.values()];
}

// Content (name, moves, tags, starred, comments…) comes from whichever copy
// was just loaded — that's the data you intentionally brought in. Progress
// is kept whichever way it's furthest along, never regressed by a restore:
// once learned, always learned, and the SRS state is whichever side actually
// reviewed the line more recently (a fresher review is a better estimate of
// where you're really at than an older one, even if its level is lower after
// a lapse).
function mergeVariation(a, b) {
  if (!a) return b;
  if (!b) return a;
  const learned = !!(a.learned || b.learned);
  let srs = a.srs ?? b.srs ?? null;
  if (a.srs && b.srs) srs = (b.srs.lastReview ?? 0) > (a.srs.lastReview ?? 0) ? b.srs : a.srs;
  return { ...a, ...b, learned, srs };
}

function mergeChapter(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { ...a, ...b, variations: mergeById(a.variations, b.variations, mergeVariation) };
}

function mergeOpening(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { ...a, ...b, chapters: mergeById(a.chapters, b.chapters, mergeChapter) };
}

// Games are records of what happened — nothing to reconcile field by field,
// just union them by id (a clash on the same id, same device pattern, is
// rare enough that taking the incoming copy is a fine tiebreaker).
function mergeGame(a, b) { return b ?? a; }

function mergePlayer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { ...a, ...b, games: mergeById(a.games, b.games, mergeGame) };
}

const preferIncoming = (a, b) => b ?? a;

// `state` is this device's current app state; `incoming` is the parsed
// backup file. Settings are deliberately left alone — they're a per-device
// preference (theme, sound volume, shortcut bindings…), not something a
// backup from another device should overwrite here.
export function mergeBackup(state, incoming) {
  return {
    ...state,
    openings: mergeById(state.openings, incoming.openings, mergeOpening),
    players: mergeById(state.players ?? [], incoming.players ?? [], mergePlayer),
    categories: mergeById(state.categories ?? [], incoming.categories ?? [], preferIncoming),
    playlists: mergeById(state.playlists ?? [], incoming.playlists ?? [], preferIncoming),
  };
}
