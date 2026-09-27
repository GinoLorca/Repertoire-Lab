// Where a line is now. Playlists (and anything else holding on to a line)
// name it by opening, chapter and id; a line can move chapter since — sent to
// a sub-variation, on this device or another — so when the named chapter no
// longer holds it, it's looked for by id: first in the same opening, then
// anywhere.
export function findLine(openings, { openingId, chapterId, variationId }) {
  const opening = openings.find((o) => o.id === openingId);
  const chapter = opening?.chapters.find((c) => c.id === chapterId);
  const variation = chapter?.variations.find((v) => v.id === variationId);
  if (variation) return { opening, chapter, variation };
  const order = opening ? [opening, ...openings.filter((o) => o !== opening)] : openings;
  for (const o of order) {
    for (const c of o.chapters) {
      const v = c.variations.find((x) => x.id === variationId);
      if (v) return { opening: o, chapter: c, variation: v };
    }
  }
  return null;
}
