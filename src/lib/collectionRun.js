// A collection played as a playlist (views/GroupsView → views/PracticeView).
//
// A collection — Favorites, or a theme like "bishop trapping plan" — gathers
// like-minded lines from all over the repertoire. Learn or Practice on one of
// its lines runs the collection: every line it covers, beginning with the one
// pressed and going round to the ones before it. (It used to run that line
// and then carry on through the line's chapter — whose other lines have
// nothing to do with the collection.)
//
// The order is the order the collection lists things in: what whole openings
// cover, then whole chapters, then the single lines — so the line after the
// one you pressed is the next row down the page. A line covered twice (its
// chapter is in the collection and so is it) comes once.
//
// The scope that asks for this (what Collections hands to startPractice):
//   { tag } or { starred: true }   which collection
//   ownerId                        whose — null yours, else a student's
//   startAt                        the line pressed (a variation id)
//   mode                           'learn' or 'practice', for every line
//
// Pure functions; tests/collectionRun.test.mjs.

// Whether a scope is a collection played from one of its lines.
export const isCollectionRun = (scope) => Boolean(scope?.startAt && (scope.tag || scope.starred));

// What the collection is called on screen.
export const collectionName = (scope) => {
  if (scope?.starred) return 'Favorites';
  return scope?.tag ? String(scope.tag) : null;
};

// Every line a collection covers, once each, in the order it lists them.
// `openings`: one person's (yours, or one student's).
export function collectionLines(openings, { tag = null, starred = false } = {}) {
  const has = (x) => (starred ? Boolean(x?.starred) : Boolean(tag) && (x?.tags ?? []).includes(tag));
  const out = [];
  const seen = new Set();
  const take = (opening, chapter, variation) => {
    if (seen.has(variation.id)) return;
    seen.add(variation.id);
    out.push({ opening, chapter, variation });
  };
  const all = openings ?? [];
  const each = (fn) => {
    for (const opening of all) {
      for (const chapter of opening.chapters ?? []) {
        for (const variation of chapter.variations ?? []) fn(opening, chapter, variation);
      }
    }
  };
  each((o, c, v) => { if (has(o)) take(o, c, v); });
  each((o, c, v) => { if (has(c)) take(o, c, v); });
  each((o, c, v) => { if (has(v)) take(o, c, v); });
  return out;
}

// The session: the lines from the one pressed, round to the ones before it,
// each of the kind asked for. A line that has left the collection since (or
// none named) starts it from the top.
export function collectionRun(lines, startAt, kind = 'practice') {
  const list = lines ?? [];
  const at = list.findIndex((it) => it.variation.id === startAt);
  const ordered = at > 0 ? [...list.slice(at), ...list.slice(0, at)] : list;
  return ordered.map((it) => ({ ...it, kind }));
}

// The whole thing, from the library and a scope.
export function collectionQueue(openings, scope) {
  const owner = scope?.ownerId ?? null;
  const theirs = (openings ?? []).filter((o) => (o.ownerId ?? null) === owner);
  return collectionRun(collectionLines(theirs, scope), scope?.startAt, scope?.mode === 'learn' ? 'learn' : 'practice');
}
