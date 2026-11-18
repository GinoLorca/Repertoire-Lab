// Copying a collection — a theme on lines (lib/themes, components/ThemeLines)
// — from one repertoire to another: yours to a student's, a student's to
// yours, one student's to another's.
//
// A collection is a tag on lines, or on a whole chapter or opening. In the
// other repertoire each of its lines is found the way Give to Student finds a
// line a student already has, in their opening of the same name: the same
// line (name, start, moves), else the same moves under another name, else a
// line of that name in a chapter of that name. There it's put in the
// collection (the tag on that line). A line they don't have can be copied in
// first — into the same opening and chapter, as Give does (store's
// copyOpeningsToPlayers) — with none of its other themes. Pure: the store's
// copyCollection does the copying, tests/collectionCopy.test.mjs covers it.
import { sameName, lineKey } from './curate';
import { fen4 } from './startPos';

const ownerOf = (o) => o.ownerId ?? null;
const movesKey = (v) => `${v.startFen ? fen4(v.startFen) : ''}|${(v.moves ?? []).join(' ')}`;
const has = (x, tag) => (x?.tags ?? []).includes(tag);

// The lines in `owner`'s collection `tag` (null: yours), in the order they
// sit: { opening, chapter, variation }. A line is in it when it, its chapter
// or its opening carries the theme.
export function collectionLines(openings, owner, tag) {
  const out = [];
  for (const o of openings ?? []) {
    if (ownerOf(o) !== owner) continue;
    for (const c of o.chapters ?? []) {
      const whole = has(o, tag) || has(c, tag);
      for (const v of c.variations ?? []) if (whole || has(v, tag)) out.push({ opening: o, chapter: c, variation: v });
    }
  }
  return out;
}

// The same line in `owner`'s repertoire — { opening, chapter, variation } —
// or null.
export function sameLineIn(openings, owner, opening, chapter, variation) {
  const theirs = (openings ?? []).filter((o) => ownerOf(o) === owner && sameName(o.name, opening.name));
  const find = (test) => {
    for (const o of theirs) {
      for (const c of o.chapters ?? []) {
        for (const v of c.variations ?? []) if (test(v, c)) return { opening: o, chapter: c, variation: v };
      }
    }
    return null;
  };
  const key = lineKey(variation);
  const mk = movesKey(variation);
  return find((v) => lineKey(v) === key)
    ?? find((v) => (v.moves?.length ?? 0) > 0 && movesKey(v) === mk)
    ?? find((v, c) => sameName(c.name, chapter.name) && sameName(v.name, variation.name));
}

// Whether a line there is in the collection already.
const inIt = (where, tag) => has(where.opening, tag) || has(where.chapter, tag) || has(where.variation, tag);

// What copying the collection `tag` from `from` to `to` would do: each of its
// lines, where it already is there (`there`, or null) and, for one that isn't,
// where it would go (`into`: the opening and chapter, and whether either is
// new there). Counts: `have` (there already), `already` (there and in the
// collection already), `missing`.
export function collectionPlan(openings, { tag, from = null, to = null }) {
  const lines = collectionLines(openings, from, tag).map((l) => {
    const there = sameLineIn(openings, to, l.opening, l.chapter, l.variation);
    if (there) return { ...l, there, into: null };
    const o = (openings ?? []).find((x) => ownerOf(x) === to && sameName(x.name, l.opening.name)) ?? null;
    const c = o ? (o.chapters ?? []).find((x) => sameName(x.name, l.chapter.name)) ?? null : null;
    return {
      ...l, there: null, into: { opening: l.opening.name, chapter: l.chapter.name, newOpening: !o, newChapter: !c },
    };
  });
  return {
    tag,
    from,
    to,
    lines,
    have: lines.filter((l) => l.there).length,
    already: lines.filter((l) => l.there && inIt(l.there, tag)).length,
    missing: lines.filter((l) => !l.there).length,
  };
}

// The lines that would be added, by where they'd go: [{ opening, chapter,
// lines: [name], newOpening, newChapter }], in order.
export function missingByPlace(plan) {
  const out = [];
  for (const l of plan.lines) {
    if (l.there) continue;
    let g = out.find((x) => x.opening === l.into.opening && x.chapter === l.into.chapter);
    if (!g) {
      g = { opening: l.into.opening, chapter: l.into.chapter, newOpening: l.into.newOpening, newChapter: l.into.newChapter, lines: [] };
      out.push(g);
    }
    g.lines.push(l.variation.name);
  }
  return out;
}
