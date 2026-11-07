// Curated chapters for a student: chapters a coach builds for them out of
// lines from anywhere in the coach's own repertoire for that opening — other
// chapters, other courses — like a "Quickstarter Guide".
//
// Two pure pieces, so tests/curate.test.mjs covers them:
//
//   · curateInto: copies chosen lines of the coach's repertoire into one
//     chapter of a student's opening. Copies, never references (editing one
//     repertoire never reaches the other), with the student's own fresh
//     progress; a line the student already has anywhere in that opening isn't
//     copied again.
//   · reorganise: the one-time change to what students already have — each of
//     a student's openings becomes one curated chapter, "Quickstarter Guide",
//     holding every line its chapters and courses held, with all their
//     progress. guidePlan says beforehand exactly what will change.
import { fen4 } from './startPos';

export const GUIDE_NAME = 'Quickstarter Guide';

const norm = (s) => String(s ?? '').trim().toLowerCase();
export const sameName = (a, b) => norm(a) === norm(b);
// The same line: the same name, start and moves (the reducer's own test).
export const lineKey = (v) => `${norm(v.name)}|${v.startFen ? fen4(v.startFen) : ''}|${(v.moves ?? []).join(' ')}`;

const isCoachOwn = (o) => (o.ownerId ?? null) === null;

// A copy of one of the coach's lines for a student: its moves, notes, badges,
// arrows and themes; progress of its own.
function freshLine(v, newId) {
  return {
    ...v,
    id: newId(),
    moves: [...(v.moves ?? [])],
    comments: { ...(v.comments ?? {}) },
    badges: { ...(v.badges ?? {}) },
    ...(v.annotations ? { annotations: JSON.parse(JSON.stringify(v.annotations)) } : {}),
    tags: [...(v.tags ?? [])],
    learned: false,
    srs: null,
    starred: false,
  };
}

// The coach's lines, by id, with where each one is (for the picker's "from …").
export function coachLines(openings) {
  return linesFrom(openings, (o) => isCoachOwn(o));
}
// Lines from any repertoire — yours, or another student's — by id.
export function linesFrom(openings, keep = () => true) {
  const out = new Map();
  for (const o of openings ?? []) {
    if (!keep(o)) continue;
    for (const c of o.chapters ?? []) {
      const course = (o.courses ?? []).find((x) => x.id === c.courseId) ?? null;
      for (const v of c.variations ?? []) out.set(v.id, { opening: o, course, chapter: c, variation: v });
    }
  }
  return out;
}

// Chosen lines into a student's chapter — from your repertoire or another
// student's, never from theirs. Returns the openings, how many lines went in,
// and the ones that were already there.
export function curateInto(openings, { toOpeningId, toChapterId, variationIds }, newId) {
  const target = (openings ?? []).find((o) => o.id === toOpeningId);
  const chapter = target?.chapters?.find((c) => c.id === toChapterId);
  if (!target || !chapter || isCoachOwn(target)) return { openings, added: 0, skipped: [] };
  const mine = linesFrom(openings, (o) => (o.ownerId ?? null) !== target.ownerId);
  const have = new Set(target.chapters.flatMap((c) => c.variations.map(lineKey)));
  const lines = [];
  const skipped = [];
  for (const id of variationIds ?? []) {
    const src = mine.get(id);
    if (!src) continue;
    const key = lineKey(src.variation);
    if (have.has(key)) { skipped.push(src.variation.name); continue; }
    have.add(key);
    lines.push(freshLine(src.variation, newId));
  }
  if (!lines.length) return { openings, added: 0, skipped };
  return {
    openings: openings.map((o) => (o.id !== target.id ? o : {
      ...o,
      chapters: o.chapters.map((c) => (c.id !== chapter.id ? c : { ...c, variations: [...c.variations, ...lines] })),
    })),
    added: lines.length,
    skipped,
  };
}

// Where a student already has a line: the chapter of theirs holding the same
// line (name, start and moves) in their opening of that name — or a line of
// that name in their chapter of that name, which a copy wouldn't add either.
// Null when they don't.
export function whereHas(openings, studentId, openingName, chapterName, variation) {
  const theirs = (openings ?? []).filter((o) => o.ownerId === studentId && sameName(o.name, openingName));
  const key = lineKey(variation);
  for (const o of theirs) {
    const c = (o.chapters ?? []).find((x) => (x.variations ?? []).some((v) => lineKey(v) === key));
    if (c) return { opening: o, chapter: c };
  }
  for (const o of theirs) {
    const c = (o.chapters ?? []).find((x) => sameName(x.name, chapterName)
      && (x.variations ?? []).some((v) => sameName(v.name, variation.name)));
    if (c) return { opening: o, chapter: c };
  }
  return null;
}

// Where a line given to a student lands: their opening of that name, when it
// has curated chapters (a Quickstarter Guide), goes into one of those —
// `chapters` lists them, to ask which when there are several. Null: the copy
// recreates the chapter as it is in yours (copyOpeningsToPlayers).
export function curatedTarget(openings, studentId, openingName) {
  const o = (openings ?? []).find((x) => x.ownerId === studentId && sameName(x.name, openingName)
    && (x.chapters ?? []).some((c) => c.curated));
  return o ? { opening: o, chapters: o.chapters.filter((c) => c.curated) } : null;
}

// Whether a student's opening is already laid out as curated chapters only.
const isCurated = (o) => !(o.courses ?? []).length && (o.chapters ?? []).length > 0
  && o.chapters.every((c) => c.curated);

// What the reorganisation will do, opening by opening, before it's done:
// [{ openingId, opening, ownerId, student, courses: [names], guide,
//    chapters: [{ name, course, lines, video }], lines, videos: [chapter names] }]
// Of `videos`, the first stays with the guide; any others don't carry over.
export function guidePlan(openings, players = []) {
  const name = (id) => players.find((p) => p.id === id)?.name ?? 'Student';
  const out = [];
  for (const o of openings ?? []) {
    if (isCoachOwn(o) || isCurated(o)) continue;
    const courseName = (id) => (o.courses ?? []).find((c) => c.id === id)?.name ?? null;
    const chapters = (o.chapters ?? []).map((c) => ({
      name: c.name, course: courseName(c.courseId), lines: c.variations.length, video: Boolean(c.video),
    }));
    out.push({
      openingId: o.id,
      opening: o.name,
      ownerId: o.ownerId,
      student: name(o.ownerId),
      courses: (o.courses ?? []).map((c) => c.name),
      // what the one chapter will be called: a curated chapter already
      // started here, or "Quickstarter Guide"
      guide: (o.chapters ?? []).find((c) => c.curated)?.name ?? GUIDE_NAME,
      chapters,
      lines: chapters.reduce((n, c) => n + c.lines, 0),
      videos: chapters.filter((c) => c.video).map((c) => c.name),
    });
  }
  return out;
}

// One student opening as a single curated chapter. Lines keep their ids and
// progress; what they took from their chapter — its themes, its star — goes
// onto them, so Collections still finds them. A chapter has one video, so the
// first chapter's video stays; lines from other chapters with a video lose
// their moment in it rather than point into the wrong one.
function intoGuide(o, chapterId, guideName, started = null) {
  const seen = new Set();
  const lines = [];
  // The started guide's own lines first, then everything else in order.
  const order = started ? [started, ...o.chapters.filter((c) => c !== started)] : (o.chapters ?? []);
  const kept = started?.video ? started : (o.chapters ?? []).find((c) => c.video);
  const video = kept?.video;
  for (const c of order) {
    for (const v of c.variations ?? []) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      const tags = [...new Set([...(c.tags ?? []), ...(v.tags ?? [])])];
      const line = { ...v, ...(tags.length ? { tags } : {}), ...(c.starred && !v.starred ? { starred: true } : {}) };
      if (c !== kept && 'videoTimestamp' in line) delete line.videoTimestamp;
      lines.push(line);
    }
  }
  const guide = {
    ...(started ? { ...started } : {}),
    id: chapterId, name: guideName, curated: true, courseId: null, section: null, subsection: null, variations: lines,
    ...(video ? { video } : {}),
  };
  const next = { ...o, courses: [], chapters: [guide] };
  delete next.freeChapterOrder;
  return next;
}

// The change itself: every student opening guidePlan lists (or just the ids
// given), as one "Quickstarter Guide". Returns the openings, and where each
// line went (old chapter → new), for anything else that names a line by its
// chapter (playlists).
export function reorganise(openings, { openingIds = null, name = GUIDE_NAME } = {}, newId) {
  const wanted = openingIds ? new Set(openingIds) : null;
  const moved = new Map(); // `${oldChapterId}|${variationId}` → newChapterId
  const next = (openings ?? []).map((o) => {
    if (isCoachOwn(o) || isCurated(o) || (wanted && !wanted.has(o.id))) return o;
    // A curated chapter already started here becomes the guide, keeping its
    // name and id; otherwise it's a new one.
    const started = (o.chapters ?? []).find((c) => c.curated);
    const id = started?.id ?? newId();
    for (const c of o.chapters ?? []) {
      for (const v of c.variations ?? []) if (c.id !== id) moved.set(`${c.id}|${v.id}`, id);
    }
    return intoGuide(o, id, started?.name ?? name, started);
  });
  return { openings: next, moved };
}
