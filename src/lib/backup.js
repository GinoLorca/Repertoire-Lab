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
    // These two were being dropped on a merge — a restored backup's Lab
    // sessions and saved positions simply didn't arrive, while a Replace
    // brought them. Union by id, same as the rest.
    labEntries: mergeById(state.labEntries ?? [], incoming.labEntries ?? [], preferIncoming),
    savedPositions: mergeById(state.savedPositions ?? [], incoming.savedPositions ?? [], preferIncoming),
  };
}

// ---------------------------------------------------------------------------
// The file-based way in and out.
//
// This predates accounts, and with sync running it's no longer how anyone
// moves work between their own devices or hands lines to a student — that's
// what an account and Coaches Corner's Send are for. It stays because a file
// is the one copy nobody can take away: an export you can keep, mail to
// yourself, or restore into a fresh install with no network and no sign-in.
// It lives in Settings now rather than on the Library's front page.
// ---------------------------------------------------------------------------

const stampToday = () => new Date().toISOString().slice(0, 10);

// Everything: openings with progress and artwork, player profiles and their
// games, categories and settings.
export function fullBackup(state) {
  return {
    name: `repertoire-lab-backup-${stampToday()}.json`,
    text: JSON.stringify({
      app: 'repertoire-lab',
      version: 2,
      savedAt: new Date().toISOString(),
      openings: state.openings,
      players: state.players ?? [],
      categories: state.categories ?? [],
      playlists: state.playlists ?? [],
      settings: state.settings,
    }),
  };
}

// One student's openings as a file they can restore into their own copy.
//
// ownerId is stripped on the way out: on the coach's device these openings
// belong to a student, but in the student's own app they're simply theirs.
export function studyPack(state, student) {
  const theirs = (state.openings ?? [])
    .filter((o) => (o.ownerId ?? null) === student.id)
    .map((o) => ({ ...o, ownerId: null }));
  return {
    openings: theirs,
    name: `${student.name.replace(/[^\w.-]+/g, '-').toLowerCase()}-study-pack-${stampToday()}.json`,
    text: JSON.stringify({
      app: 'repertoire-lab',
      version: 2,
      kind: 'study-pack',
      preparedFor: student.name,
      savedAt: new Date().toISOString(),
      openings: theirs,
      players: [],
      categories: [],
      playlists: [],
      // Deliberately omitted: the coach's own settings, API keys and
      // background picture have no business travelling to a student.
      settings: {},
    }),
  };
}

// Reads a backup or study pack, and says what's in it rather than assuming.
export function readBackupFile(text) {
  const parsed = JSON.parse(text);
  const openings = parsed.openings ?? [];
  const lines = openings.reduce(
    (a, o) => a + (o.chapters ?? []).reduce((b, c) => b + (c.variations?.length ?? 0), 0), 0,
  );
  return {
    parsed,
    openings,
    lines,
    isStudyPack: parsed.kind === 'study-pack',
    preparedFor: parsed.preparedFor ?? null,
  };
}
