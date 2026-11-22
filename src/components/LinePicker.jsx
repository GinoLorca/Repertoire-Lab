import React, { useMemo, useState } from 'react';

// "Load a repertoire line…" on the analysis board: every line there is, one
// entry each.
//
// In a coach's library that's thousands of entries — nine tenths of
// everything on the page. Made with the page, they were most of what opening
// the Analysis tab cost, every time; and every redraw of the page (a piece
// picked up, the engine's next line, a step through a game) went over all of
// them again. So:
//   · The entries are made when the picker is about to be used — pressed,
//     focused, reached by a key — and not before. The press comes before the
//     browser opens its list, so the list it opens is the full one.
//   · It's a part of its own (memo), given the same things for as long as
//     the library is the same: the page redrawing doesn't go over it.
//
// `players`: whose each opening is, named in the list (Coaches Corner's
// board; null: one list, "Repertoire"). `onPick("opening|chapter|line")`.
function groupsOf(openings, players) {
  const groups = new Map();
  for (const o of openings ?? []) {
    const owner = players
      ? (players.find((p) => p.id === o.ownerId)?.name ?? 'My repertoire')
      : 'Repertoire';
    if (groups.has(owner)) groups.get(owner).push(o); else groups.set(owner, [o]);
  }
  return [...groups.entries()];
}

function LinePicker({ openings, players = null, onPick }) {
  const [filled, setFilled] = useState(false);
  const fill = () => setFilled(true);
  const groups = useMemo(() => (filled ? groupsOf(openings, players) : null), [filled, openings, players]);
  return (
    <select
      className="line-picker"
      defaultValue=""
      onPointerDown={fill}
      onTouchStart={fill}
      onMouseDown={fill}
      onFocus={fill}
      onKeyDown={fill}
      onChange={(e) => { onPick(e.target.value); e.target.value = ''; }}
    >
      <option value="" disabled>Load a repertoire line…</option>
      {/* Grouped by whose repertoire it is — in Coach's Corner several
          students can have an opening with the same name, and a plain
          flat list would leave no way to tell them apart. */}
      {groups?.map(([owner, list]) => (
        <optgroup key={owner} label={owner}>
          {list.map((o) => o.chapters.map((c) => c.variations.map((v) => (
            <option key={v.id} value={`${o.id}|${c.id}|${v.id}`}>
              {o.name} / {c.name} / {v.name}
            </option>
          ))))}
        </optgroup>
      ))}
    </select>
  );
}

export default React.memo(LinePicker);
