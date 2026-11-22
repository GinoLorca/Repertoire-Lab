// For a screen that names openings or counts them: whether the positions it
// needs are worked out yet (lib/positions). While they aren't, it asks for
// them ahead of everything else (lib/positionsWarm) and is redrawn as they
// arrive — so the screen draws at once, and fills in.
import { useEffect, useState } from 'react';
import { settleSmall } from './positions';
import { requestWarm, requestIndex, onWarmed } from './positionsWarm';
import { positionIndexFor, positionIndexReady } from './repertoire';

// `items`: [{ moves, startFen }], the same array for as long as the lists
// behind it are the same (useMemo) — a new array asks again. A few missing
// (a game just added) are worked out there and then, so only a screen
// opened before the library was ready ever waits.
export function usePositionsReady(items, small = 12) {
  const [, redraw] = useState(0);
  const ready = settleSmall(items, small);
  useEffect(() => {
    if (ready) return undefined;
    requestWarm(items);
    return onWarmed(() => redraw((n) => n + 1));
  }, [items, ready]);
  return ready;
}

// A book's index (lib/repertoire positionIndexFor) for a board that draws
// without waiting for it: the index when it's built — as a rule it is, the
// library's being filed in the background from the moment the app opens —
// and null while it isn't. Then it's asked for ahead of everything else, a
// slice at a time, and the board is redrawn when it's there. A short book
// is simply filed on the spot.
export function useBookIndex(openings, studentId = null, source = 'both') {
  const [, redraw] = useState(0);
  const ready = positionIndexReady(openings, { studentId, source });
  useEffect(() => {
    if (ready) return undefined;
    requestIndex(openings, { studentId, source });
    // Told a few times a second while the library is worked out: the board
    // is only drawn again once its index is whole (a redraw of a board's
    // whole screen for each "not yet" would slow the very work it waits on).
    return onWarmed(() => {
      if (positionIndexReady(openings, { studentId, source }, { small: 0 })) redraw((n) => n + 1);
    });
  }, [openings, studentId, source, ready]);
  return ready ? positionIndexFor(openings, { studentId, source }) : null;
}
