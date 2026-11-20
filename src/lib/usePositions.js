// For a screen that names openings or counts them: whether the positions it
// needs are worked out yet (lib/positions). While they aren't, it asks for
// them ahead of everything else (lib/positionsWarm) and is redrawn as they
// arrive — so the screen draws at once, and fills in.
import { useEffect, useState } from 'react';
import { settleSmall } from './positions';
import { requestWarm, onWarmed } from './positionsWarm';

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
