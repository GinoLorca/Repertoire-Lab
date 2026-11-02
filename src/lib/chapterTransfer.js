import { sameStart } from './startPos';

// Lines sent from one chapter to another, anywhere in the same repertoire:
// copied (left here as well) or moved (taken out of here). A line whose
// moves the other chapter already has, from the same start, isn't sent
// twice — it's skipped, and stays where it is.

const sameLine = (a, b) => sameStart(a.startFen, b.startFen) && a.moves.join(' ') === b.moves.join(' ');

const findChapter = (openings, { openingId, chapterId }) => openings
  .find((o) => o.id === openingId)?.chapters.find((c) => c.id === chapterId) ?? null;

// What would go, in the chapter's own order, and what's already there.
export function planSend(openings, { from, to, ids }) {
  const source = findChapter(openings, from);
  const dest = findChapter(openings, to);
  if (!source || !dest) return { lines: [], skipped: [] };
  const wanted = new Set(ids);
  const picked = source.variations.filter((v) => wanted.has(v.id));
  const lines = [];
  const skipped = [];
  for (const v of picked) (dest.variations.some((d) => sameLine(d, v)) ? skipped : lines).push(v);
  return { lines, skipped };
}

// The openings afterwards. A copy is a new line (`newId` gives its id), to be
// learned there afresh, with the same moves, notes, arrows, glyphs and
// themes; a moved line takes its progress with it. Either way a link to the
// old chapter's video stays behind — the video is that chapter's.
export function sendToChapter(openings, {
  from, to, ids, mode,
}, newId) {
  if (from.openingId === to.openingId && from.chapterId === to.chapterId) return openings;
  const { lines } = planSend(openings, { from, to, ids });
  if (!lines.length) return openings;
  const going = new Set(lines.map((v) => v.id));
  const arriving = lines.map((v) => {
    const { videoTimestamp, ...rest } = v; // eslint-disable-line no-unused-vars
    return mode === 'copy' ? { ...rest, id: newId(), learned: false, srs: null } : rest;
  });
  return openings.map((o) => {
    if (o.id !== from.openingId && o.id !== to.openingId) return o;
    return {
      ...o,
      chapters: o.chapters.map((c) => {
        if (o.id === to.openingId && c.id === to.chapterId) return { ...c, variations: [...c.variations, ...arriving] };
        if (mode === 'move' && o.id === from.openingId && c.id === from.chapterId) {
          return { ...c, variations: c.variations.filter((v) => !going.has(v.id)) };
        }
        return c;
      }),
    };
  });
}
