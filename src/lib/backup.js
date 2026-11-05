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

// `structure` says whose arrangement of chapters wins where the two differ:
// a restored file is older than this device ('local'); an opening a coach
// sends is the coach's newer one ('incoming').
function mergeChapter(a, b, structure = 'local') {
  if (!a) return b;
  if (!b) return a;
  const merged = { ...a, ...b, variations: mergeById(a.variations, b.variations, mergeVariation) };
  // Restoring an older file mustn't take a chapter out of the folder it has
  // been filed in since (a sub-variation, or the chapter a folder is of).
  if (structure === 'local') {
    merged.section = a.section ?? null;
    merged.subsection = a.subsection ?? null;
  }
  return merged;
}

function mergeOpening(a, b, structure = 'local') {
  if (!a) return b;
  if (!b) return a;
  const merged = {
    ...a,
    ...b,
    chapters: mergeById(a.chapters, b.chapters, (x, y) => mergeChapter(x, y, structure)),
  };
  // "Arranged by hand" (lib/chapterOrder.js) describes an order, so it only
  // travels with it: a coach's arranged opening arrives in the coach's order;
  // a restored file keeps this device's order, and so its own setting.
  if (structure === 'incoming' && b.freeChapterOrder) {
    const rank = new Map(b.chapters.map((c, i) => [c.id, i]));
    merged.chapters = [...merged.chapters].sort((x, y) => (rank.get(x.id) ?? 1e9) - (rank.get(y.id) ?? 1e9));
    merged.freeChapterOrder = true;
  } else if (a.freeChapterOrder) {
    merged.freeChapterOrder = true;
  } else {
    delete merged.freeChapterOrder;
  }
  const settled = oneHomePerLine(merged, a, b, structure);
  return structure === 'incoming' ? withoutEmptied(settled, a, b) : settled;
}

// A coach's newer arrangement can leave chapters here with nothing in them:
// every line they held now lives somewhere else (a curated chapter, say a
// "Quickstarter Guide"). Those go — but only those: a chapter the coach sent,
// a chapter that was already empty, or one still holding the student's own
// lines stays. A course goes with them when it's no longer the coach's and
// nothing here is in it; a chapter is never left in a course that's gone.
function withoutEmptied(merged, local, incoming) {
  const sent = new Set((incoming.chapters ?? []).map((c) => c.id));
  const had = new Set((local.chapters ?? []).filter((c) => c.variations?.length).map((c) => c.id));
  let chapters = merged.chapters.filter((c) => sent.has(c.id) || !had.has(c.id) || c.variations.length);
  if (!Array.isArray(incoming.courses)) {
    return chapters.length === merged.chapters.length ? merged : { ...merged, chapters };
  }
  const courses = [...incoming.courses];
  for (const course of local.courses ?? []) {
    if (!courses.some((x) => x.id === course.id) && chapters.some((c) => c.courseId === course.id)) courses.push(course);
  }
  const known = new Set(courses.map((c) => c.id));
  chapters = chapters.map((c) => (c.courseId && !known.has(c.courseId) ? { ...c, courseId: null } : c));
  return { ...merged, chapters, courses };
}

// A playlist names a line by its chapter. Wherever a merge has moved a line
// to another chapter of its opening, its playlist entries follow it there.
function rehomePlaylists(state) {
  const homes = new Map(); // `${openingId}|${variationId}` → chapterId
  const holds = new Set(); // `${chapterId}|${variationId}`
  for (const o of state.openings ?? []) {
    for (const c of o.chapters ?? []) {
      for (const v of c.variations ?? []) {
        if (!homes.has(`${o.id}|${v.id}`)) homes.set(`${o.id}|${v.id}`, c.id);
        holds.add(`${c.id}|${v.id}`);
      }
    }
  }
  const lost = (it) => it?.variationId && !holds.has(`${it.chapterId}|${it.variationId}`)
    && homes.has(`${it.openingId}|${it.variationId}`);
  if (!(state.playlists ?? []).some((p) => (p.items ?? []).some(lost))) return state;
  return {
    ...state,
    playlists: state.playlists.map((p) => ((p.items ?? []).some(lost)
      ? { ...p, items: p.items.map((it) => (lost(it) ? { ...it, chapterId: homes.get(`${it.openingId}|${it.variationId}`) } : it)) }
      : p)),
  };
}

// A line lives in one chapter. Merging chapter by chapter, a line that moved
// chapter on one side (sent to a sub-variation) would come out in both its
// old and new chapter, twice under one id. It's kept once — in the chapter
// the winning arrangement has it in — with both copies' progress.
function oneHomePerLine(merged, local, incoming, structure) {
  const homes = new Map();
  for (const c of merged.chapters) {
    for (const v of c.variations) {
      if (!homes.has(v.id)) homes.set(v.id, []);
      homes.get(v.id).push(c.id);
    }
  }
  const twice = [...homes].filter(([, where]) => where.length > 1);
  if (!twice.length) return merged;
  const homeIn = (opening, id) => opening.chapters.find((c) => c.variations.some((v) => v.id === id))?.id;
  const first = structure === 'incoming' ? incoming : local;
  const second = structure === 'incoming' ? local : incoming;
  const keep = new Map(); // line id → { chapterId, line }
  for (const [id, where] of twice) {
    const home = [homeIn(first, id), homeIn(second, id)].find((h) => where.includes(h)) ?? where[0];
    const copies = merged.chapters.filter((c) => where.includes(c.id))
      .map((c) => c.variations.find((v) => v.id === id));
    // Content from the incoming copy, as mergeVariation does; progress from
    // whichever is furthest along.
    const localCopy = local.chapters.flatMap((c) => c.variations).find((v) => v.id === id) ?? copies[0];
    const incomingCopy = incoming.chapters.flatMap((c) => c.variations).find((v) => v.id === id) ?? copies[1];
    keep.set(id, { chapterId: home, line: mergeVariation(localCopy, incomingCopy) });
  }
  return {
    ...merged,
    chapters: merged.chapters.map((c) => {
      if (!c.variations.some((v) => keep.has(v.id))) return c;
      return {
        ...c,
        variations: c.variations
          .filter((v) => !keep.has(v.id) || keep.get(v.id).chapterId === c.id)
          .map((v) => (keep.has(v.id) ? keep.get(v.id).line : v)),
      };
    }),
  };
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
export function mergeBackup(state, incoming, { structure = 'local' } = {}) {
  return rehomePlaylists({
    ...state,
    openings: mergeById(state.openings, incoming.openings, (a, b) => mergeOpening(a, b, structure)),
    players: mergeById(state.players ?? [], incoming.players ?? [], mergePlayer),
    categories: mergeById(state.categories ?? [], incoming.categories ?? [], preferIncoming),
    playlists: mergeById(state.playlists ?? [], incoming.playlists ?? [], preferIncoming),
    // These two were being dropped on a merge — a restored backup's Lab
    // sessions and saved positions simply didn't arrive, while a Replace
    // brought them. Union by id, same as the rest.
    labEntries: mergeById(state.labEntries ?? [], incoming.labEntries ?? [], preferIncoming),
    savedPositions: mergeById(state.savedPositions ?? [], incoming.savedPositions ?? [], preferIncoming),
  });
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
// games, categories, Lab sessions, the Board Editor's saved positions (your
// students' lessons among them) and settings. Lab sessions and saved
// positions joined the file late: an older file without them still restores,
// with none of either in it.
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
      labEntries: state.labEntries ?? [],
      savedPositions: state.savedPositions ?? [],
      settings: state.settings,
    }),
  };
}

// One student's openings as a file they can restore into their own copy —
// and the positions in their Board Editor lessons, filed in those lessons.
//
// ownerId is stripped on the way out: on the coach's device these belong to a
// student, but in the student's own app they're simply theirs. Which of the
// coach's positions a lesson's copy was made from (recycledFrom) means
// nothing there either, so it stays behind too.
export function studyPack(state, student) {
  const theirs = (state.openings ?? [])
    .filter((o) => (o.ownerId ?? null) === student.id)
    .map((o) => ({ ...o, ownerId: null }));
  const lessons = (state.savedPositions ?? [])
    .filter((p) => p.ownerId === student.id)
    .map(({ ownerId: _owner, recycledFrom: _from, ...p }) => p);
  return {
    openings: theirs,
    savedPositions: lessons,
    name: `${student.name.replace(/[^\w.-]+/g, '-').toLowerCase()}-study-pack-${stampToday()}.json`,
    text: JSON.stringify({
      app: 'repertoire-lab',
      version: 2,
      kind: 'study-pack',
      preparedFor: student.name,
      savedAt: new Date().toISOString(),
      openings: theirs,
      savedPositions: lessons,
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
