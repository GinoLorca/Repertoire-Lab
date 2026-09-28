import { sameStart, startFenOf, moveNumberLabel } from './startPos';

// Sub-variations, the way the Library already shows them: a section is a
// folder ("Classical (Mainline) Variation") and each sub-section in it is a
// sub-variation (Tartakower, Karpov) — each a chapter of its own.
//
// Two ways in:
//   · from a chapter, send some of its lines to a sub-variation of it: the
//     Panov Attack lines in "Exchange Variation" become their own chapter,
//     and "Exchange Variation" becomes a folder holding itself and the Panov
//     Attack beside it
//   · from the Library, file a whole chapter under another chapter (or into
//     an existing folder) as a sub-variation
//
// Nothing new is stored: a chapter's `section` names its folder and its
// `subsection` its sub-variation, exactly as the Library has always read
// them. Two levels only — a folder holds sub-variations, a sub-variation
// holds lines.
//
// Everything here is pure (an opening in, an opening out), so the store's
// reducer just calls it.

const sameCourse = (a, b) => (a.courseId ?? null) === (b.courseId ?? null);

// ---------- Which chapter heads a folder ----------

// The chapter a folder is "of" — Exchange Variation, with its Panov Attack
// beside it. It's the folder's one loose chapter (in the folder, but in no
// sub-variation of it). With several loose chapters it's the one named like
// the folder, if any; with none (Classical (Mainline), which holds only its
// Tartakower and Karpov), the folder has no head. Worked out from where
// chapters sit rather than from names alone, so renaming the folder or the
// chapter doesn't change it.
export function headOf(chapters, section, courseId = null) {
  if (!section) return null;
  const loose = chapters.filter((c) => c.section === section && !c.subsection
    && (c.courseId ?? null) === (courseId ?? null));
  if (loose.length === 1) return loose[0];
  return loose.find((c) => c.name === section) ?? null;
}

export const isHead = (chapters, chapter) => Boolean(chapter?.section) && !chapter.subsection
  && headOf(chapters, chapter.section, chapter.courseId)?.id === chapter.id;

// The chapters filed under a folder as sub-variations, in this course.
const subsIn = (chapters, section, courseId) => chapters.filter((c) => c.section === section
  && c.subsection && (c.courseId ?? null) === (courseId ?? null));

// The sub-variations in a chapter's folder — none for a chapter in no folder.
export function subVariationsOf(opening, chapter) {
  if (!chapter.section) return [];
  return subsIn(opening.chapters, chapter.section, chapter.courseId).filter((c) => c.id !== chapter.id);
}

// Where a chapter's lines can be sent: the sub-variations of its folder, and
// — from a sub-variation — the chapter the folder is of, so a line sent by
// mistake can go back.
export function destinationsFor(opening, chapter) {
  const subs = subVariationsOf(opening, chapter);
  if (!chapter.subsection) return subs;
  const head = headOf(opening.chapters, chapter.section, chapter.courseId);
  return head && head.id !== chapter.id ? [head, ...subs] : subs;
}

// A sub-variation's name as a list shows it. A sub-section can hold more than
// one chapter (the Library shows it as a folder of its own); then the name
// alone would read the same twice, so the chapter's name goes with it.
export function subLabel(opening, chapter) {
  if (!chapter.subsection) return chapter.name;
  const twins = opening.chapters.filter((c) => c.section === chapter.section && c.subsection === chapter.subsection
    && sameCourse(c, chapter));
  return twins.length > 1 ? `${chapter.subsection} ▸ ${chapter.name}` : chapter.subsection;
}

// The folder a loose chapter's sub-variations go in: one named after it —
// unless another course of the opening already has a folder by that name
// (two authors' "Exchange Variation"), which would otherwise open, close and
// rename together.
function newFolderName(opening, chapter) {
  const taken = new Set(opening.chapters
    .filter((c) => c.section && !sameCourse(c, chapter))
    .map((c) => c.section));
  if (!taken.has(chapter.name)) return chapter.name;
  const course = (opening.courses ?? []).find((k) => k.id === chapter.courseId);
  const tagged = course ? `${chapter.name} (${course.name})` : `${chapter.name} (2)`;
  let name = tagged;
  for (let n = 2; taken.has(name); n += 1) name = `${tagged} ${n}`;
  return name;
}

export const folderFor = (opening, chapter) => chapter.section || newFolderName(opening, chapter);

// Just after the last chapter of `section` in this course, so a folder's
// contents stay together and a new sub-variation lands at the end of it.
function insertInFolder(chapters, chapter, section) {
  let at = -1;
  chapters.forEach((c, i) => {
    if (c.section === section && sameCourse(c, chapter)) at = i;
  });
  return at < 0
    ? [...chapters, chapter]
    : [...chapters.slice(0, at + 1), chapter, ...chapters.slice(at + 1)];
}

// A folder left holding nothing but the chapter it was of isn't a folder any
// more: that chapter goes back to being a chapter on its own.
function dissolveIfEmpty(chapters, section, courseId) {
  if (!section) return chapters;
  const inside = chapters.filter((c) => c.section === section && (c.courseId ?? null) === (courseId ?? null));
  if (inside.length !== 1 || inside[0].subsection || inside[0].name !== section) return chapters;
  return chapters.map((c) => (c.id === inside[0].id ? { ...c, section: null, subsection: null } : c));
}

// Two copies of one line — it can end up in both places when two devices
// move it before either syncs, or when it's sent back to where a copy is.
// Nothing either had is lost: learned on either side stays learned, the more
// recently reviewed schedule wins, and notes and badges from both are kept.
export function mergeLine(into, from) {
  if (!into) return from;
  if (!from) return into;
  let srs = into.srs ?? from.srs ?? null;
  if (into.srs && from.srs) srs = (from.srs.lastReview ?? 0) > (into.srs.lastReview ?? 0) ? from.srs : into.srs;
  const union = (a, b) => (a || b ? { ...(b ?? {}), ...(a ?? {}) } : undefined);
  const tags = [...new Set([...(into.tags ?? []), ...(from.tags ?? [])])];
  const out = {
    ...from,
    ...into,
    learned: Boolean(into.learned || from.learned),
    srs,
    starred: Boolean(into.starred || from.starred),
  };
  if (into.comments || from.comments) out.comments = union(into.comments, from.comments);
  if (into.badges || from.badges) out.badges = union(into.badges, from.badges);
  if (tags.length) out.tags = tags;
  return out;
}

const videoOf = (c) => c?.video?.id ?? null;

// A line's video timestamp is into its chapter's video: moved to a chapter
// with a different video (or none), it would jump to the wrong film.
const forChapter = (line, from, to) => {
  if (line.videoTimestamp == null || videoOf(from) === videoOf(to)) return line;
  const { videoTimestamp: _gone, ...rest } = line;
  return rest;
};

// Send lines from a chapter to a sub-variation of it — an existing chapter
// (`toId`), or a new one (`newId` + `name`). The lines keep everything:
// progress, comments, badges, ids. A chapter in no folder becomes the head
// of a new folder named after it; a new sub-variation takes its star and
// themes, which the lines had through it.
export function sendLines(opening, {
  fromId, ids, toId = null, newId = null, name = '',
}) {
  const from = opening.chapters.find((c) => c.id === fromId);
  if (!from) return opening;
  const pick = new Set(ids);
  const moving = from.variations.filter((v) => pick.has(v.id));
  if (!moving.length || toId === fromId) return opening;
  const title = String(name ?? '').trim();
  const target = toId ? opening.chapters.find((c) => c.id === toId) : null;
  if (toId ? !target : !(newId && title)) return opening;
  if (!toId && opening.chapters.some((c) => c.id === newId)) return opening;
  const section = folderFor(opening, from);

  let chapters = opening.chapters.map((c) => (c.id === fromId
    ? {
      ...c,
      variations: c.variations.filter((v) => !pick.has(v.id)),
      ...(c.section ? {} : { section, subsection: null }),
    }
    : c));
  if (target) {
    chapters = chapters.map((c) => {
      if (c.id !== toId) return c;
      const byId = new Map(c.variations.map((v) => [v.id, v]));
      const added = [];
      for (const v of moving) {
        const line = forChapter(v, from, c);
        if (byId.has(v.id)) byId.set(v.id, mergeLine(byId.get(v.id), line));
        else added.push(line);
      }
      return { ...c, variations: [...c.variations.map((v) => byId.get(v.id)), ...added] };
    });
    return { ...opening, chapters };
  }
  const sub = {
    id: newId,
    name: title,
    section,
    subsection: title,
    courseId: from.courseId ?? null,
    variations: moving.map((v) => forChapter(v, from, null)),
    ...(from.starred ? { starred: true } : {}),
    ...(from.tags?.length ? { tags: [...from.tags] } : {}),
  };
  return { ...opening, chapters: insertInFolder(chapters, sub, section) };
}

// File a whole chapter as a sub-variation: under another chapter
// (`parentId` — that chapter's folder, which it heads if it wasn't in one),
// or into an existing folder (`section`). A chapter heading a folder brings
// its sub-variations along. A chapter filed into the folder named after it
// goes back to heading it.
export function makeSub(opening, { chapterId, parentId = null, section: into = null }) {
  const me = opening.chapters.find((c) => c.id === chapterId);
  if (!me) return opening;
  let chapters = opening.chapters;
  let section = into;
  // Filed under a chapter of another course (another author's take), it
  // joins that course: a folder lives in one course's list.
  let courseId = me.courseId ?? null;
  if (parentId) {
    const parent = chapters.find((c) => c.id === parentId);
    if (!parent || parent.id === chapterId) return opening;
    section = folderFor(opening, parent);
    courseId = parent.courseId ?? null;
    if (!parent.section) {
      chapters = chapters.map((c) => (c.id === parentId ? { ...c, section, subsection: null } : c));
    }
  }
  if (!section) return opening;
  const wasIn = { section: me.section, courseId: me.courseId ?? null };
  const heads = isHead(chapters, me);
  // Its own sub-variations, when it heads a folder: they come along, still
  // as sub-variations — there's no third level for them to keep.
  const family = heads && me.section !== section
    ? chapters.filter((c) => c.id !== me.id && c.section === me.section && sameCourse(c, me))
    : [];
  const moving = new Set([me.id, ...family.map((c) => c.id)]);
  let rest = chapters.filter((c) => !moving.has(c.id));
  const rejoinsAsHead = me.name === section;
  for (const c of [me, ...family]) {
    const placed = {
      ...c,
      courseId,
      section,
      subsection: c.id === me.id
        ? (rejoinsAsHead ? null : (me.subsection || me.name))
        : (c.subsection || c.name),
    };
    rest = insertInFolder(rest, placed, section);
  }
  if (wasIn.section && wasIn.section !== section) rest = dissolveIfEmpty(rest, wasIn.section, wasIn.courseId);
  return { ...opening, chapters: rest };
}

// Out of its folder, back to a chapter on its own. The folder it leaves goes
// too, if all that's left in it is the chapter it was of.
export function leaveFolder(opening, chapterId) {
  const me = opening.chapters.find((c) => c.id === chapterId);
  if (!me || (!me.section && !me.subsection)) return opening;
  let chapters = opening.chapters.map((c) => (c.id === chapterId ? { ...c, section: null, subsection: null } : c));
  chapters = dissolveIfEmpty(chapters, me.section, me.courseId);
  return { ...opening, chapters };
}

// A chapter moved to another course takes its folder with it when it heads
// one — otherwise the folder splits across two courses.
export function withFolderMates(opening, chapterId) {
  const me = opening.chapters.find((c) => c.id === chapterId);
  if (!me || !isHead(opening.chapters, me)) return [chapterId];
  return opening.chapters
    .filter((c) => c.section === me.section && sameCourse(c, me))
    .map((c) => c.id);
}

// ---------- Suggestions ----------

// Moves every one of these lines starts with — none, unless they all start
// from the same position: the same moves from a course's set-up position and
// from the beginning aren't a shared start.
export function stemOf(lines) {
  if (!lines.length) return [];
  if (!lines.every((v) => sameStart(v, lines[0]))) return [];
  const first = lines[0].moves ?? [];
  let n = first.length;
  for (const v of lines) {
    let i = 0;
    while (i < n && v.moves?.[i] === first[i]) i += 1;
    n = i;
  }
  return first.slice(0, n);
}

const sharedLength = (a, b) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
};

// "4.c4" / "3...Bf5" for the move at ply `i` — numbered from where the line
// starts (`startFen`, lib/startPos).
export function moveLabel(moves, i, startFen) {
  return `${moveNumberLabel(i, startFen)}${moves[i]}`;
}

// The lines that go with this one: every line in the chapter that makes the
// same move where the chapter's lines first part ways — all the 4.c4 lines
// of an Exchange Variation chapter, say.
//
// Only lines from the same start as this one count: a line set up from a
// position branches among the others from that position.
export function branchOf(variations, id) {
  const me = variations.find((v) => v.id === id);
  if (!me) return { ids: [], label: null };
  const peers = variations.filter((v) => sameStart(v, me));
  const at = stemOf(peers).length;
  if (at >= me.moves.length || peers.length < 2) return { ids: [id], label: null };
  const ids = peers.filter((v) => v.moves[at] === me.moves[at]).map((v) => v.id);
  return { ids, label: moveLabel(me.moves, at, startFenOf(me)) };
}

// A line's name without its own last detail: "…Panov Attack: 5.Nf3" and
// "…Panov Attack: 5.Nc3 #1" are both "…Panov Attack". Only a detail that is
// a move or a count is cut — "Caro-Kann: Exchange Variation" stays whole.
export function familyOf(name) {
  const bare = String(name ?? '').replace(/\s*#\d+\s*$/, '').trim();
  const colon = bare.lastIndexOf(':');
  if (colon > 0 && /^\s*(\d+\s*\.|#\d+|[KQRBN]?[a-h]?x?[a-h][1-8]|O-O)/.test(bare.slice(colon + 1))) {
    return bare.slice(0, colon).trim();
  }
  return bare;
}

const words = (s) => s.split(/\s+/).filter(Boolean);
// Compared without the punctuation that sticks to a word: "Caro-Kann:" and
// "Caro-Kann" are the same word.
const wordKey = (w) => w.replace(/[,;:.]+$/, '').toLowerCase();

// A name for a new sub-variation holding these lines. From the names when
// they say it — "Caro-Kann Exchange Variation Panov Attack: …" beside
// "Caro-Kann Exchange Variation: …" gives "Panov Attack" — otherwise the
// move they share where they leave the rest ("4.c4").
export function suggestName(chapter, ids) {
  const pick = new Set(ids);
  const chosen = chapter.variations.filter((v) => pick.has(v.id));
  const others = chapter.variations.filter((v) => !pick.has(v.id));
  if (!chosen.length) return '';
  const families = [...new Set(chosen.map((v) => familyOf(v.name)))];
  if (families.length === 1 && families[0]) {
    const mine = words(families[0]);
    // What the rest are called — or, with nothing left, the chapter itself.
    const theirs = others.length
      ? words(mostCommon(others.map((v) => familyOf(v.name))))
      : words(familyOf(chapter.name));
    let n = 0;
    while (n < mine.length && n < theirs.length && wordKey(mine[n]) === wordKey(theirs[n])) n += 1;
    const rest = mine.slice(n).join(' ').replace(/^[\s:;,.–—-]+/, '').trim();
    if (rest) return rest;
  }
  // Where the chosen lines leave the rest of the chapter's lines from the
  // same start (a chapter can also hold lines set up from a position).
  const stem = stemOf(chosen);
  const shared = stemOf(chapter.variations.filter((v) => sameStart(v, chosen[0]))).length;
  return stem.length > shared ? moveLabel(stem, shared, startFenOf(chosen[0])) : '';
}

function mostCommon(list) {
  const counts = new Map();
  for (const x of list) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

// Where a chapter most likely belongs: the chapter or folder whose lines
// share the most opening moves with its own — Panov Attack under Exchange
// Variation, both starting 1.e4 c6 2.d4 d5 3.exd5 cxd5.
// Only a clear winner: two sharing the same moves is no suggestion at all.
export function suggestParent(candidates, chapter) {
  // Judged on the chapter's lines from its commonest start — usually the
  // normal one — against the candidate's lines from that same start.
  const groups = [];
  for (const v of chapter.variations) {
    const g = groups.find((x) => sameStart(x[0], v));
    if (g) g.push(v); else groups.push([v]);
  }
  const home = groups.reduce((a, b) => (b.length > a.length ? b : a), []);
  const mine = stemOf(home);
  let best = null;
  let bestN = 0;
  let tied = false;
  for (const cand of candidates) {
    const theirs = home.length ? cand.lines.filter((v) => sameStart(v, home[0])) : [];
    const n = theirs.length ? sharedLength(mine, stemOf(theirs)) : 0;
    if (n > bestN) { best = cand.key; bestN = n; tied = false; } else if (n === bestN && n > 0) tied = true;
  }
  return tied ? null : best;
}
