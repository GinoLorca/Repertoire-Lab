import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBackGuard } from '../lib/backGuard';

// Rearranging a long list in one go.
//
// Up/down arrows on each card are fine for nudging a line one place; in a
// chapter of forty lines, moving one from the bottom to the top is thirty-
// nine taps. Here every line is one slim row: drag it by its handle — with a
// finger on an iPad as well as a mouse — and the list scrolls itself when you
// hold it near the top or bottom edge. Each row also jumps straight to the
// top or bottom, and the whole list can be sorted by moves (lines that share
// an opening sequence end up together) or by name. Nothing changes until
// Done, and then it's one change, which syncs like any other.

// Moves compared move by move, so 3...Bf5 lines sit together and a shorter
// line comes before the longer lines that continue it.
function byMoves(a, b) {
  const n = Math.min(a.moves.length, b.moves.length);
  for (let i = 0; i < n; i += 1) {
    if (a.moves[i] !== b.moves[i]) return a.moves[i] < b.moves[i] ? -1 : 1;
  }
  return a.moves.length - b.moves.length;
}
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

const EDGE = 56; // px from the list's edge where holding a line scrolls it
const MAX_SPEED = 900; // px a second, held right at the edge

// `regroup` (optional) puts an order back into shape after every change —
// the chapter uses it to keep each line's sub-variations behind it, so a
// main line dragged anywhere takes them along. `step` moves one row one
// place for the arrow keys; the chapter's moves a main line past the whole
// next block.
const same = (ids) => ids;
const oneStep = (ids, id, dir) => {
  const from = ids.indexOf(id);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
};

export default function ReorderSheet({
  title, items, onDone, onClose, regroup = same, step = oneStep,
}) {
  const byId = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const original = useMemo(() => items.map((it) => it.id), [items]);
  const [picked, setOrder] = useState(original);
  // A sync can land while the sheet is open: a line deleted on another device
  // drops out, and one added there joins at the bottom.
  const order = useMemo(() => {
    const kept = picked.filter((id) => byId.has(id));
    const added = original.filter((id) => !picked.includes(id));
    return added.length || kept.length !== picked.length ? [...kept, ...added] : picked;
  }, [picked, byId, original]);
  const [dragging, setDragging] = useState(null);
  const listRef = useRef(null);
  const drag = useRef(null); // { id, y }
  useBackGuard(true, onClose);

  const changed = order.some((id, i) => id !== original[i]);

  const orderRef = useRef(order);
  orderRef.current = order;
  const moveTo = (id, index) => setOrder(() => {
    const o = orderRef.current;
    const from = o.indexOf(id);
    const to = Math.max(0, Math.min(o.length - 1, index));
    if (from < 0 || from === to) return o;
    const moved = [...o];
    moved.splice(from, 1);
    moved.splice(to, 0, id);
    const next = regroup(moved);
    orderRef.current = next;
    return next;
  });
  const stepBy = (id, dir) => setOrder(() => {
    const next = regroup(step(orderRef.current, id, dir));
    orderRef.current = next;
    return next;
  });

  // Which slot the pointer is over: the first row whose middle is below it.
  const slotAt = (y) => {
    const rows = [...(listRef.current?.querySelectorAll('[data-row]') ?? [])];
    const i = rows.findIndex((r) => {
      const box = r.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    return i < 0 ? rows.length - 1 : i;
  };

  // While a line is held near an edge, keep scrolling — pointer events stop
  // when the finger stops moving, so this runs on its own clock.
  useEffect(() => {
    if (!dragging) return undefined;
    let frame;
    let last = performance.now();
    let carry = 0;
    const tick = (now) => {
      // By the clock, not per frame: the same speed on a 60 Hz Mac screen
      // and a 120 Hz iPad. Faster the deeper into the edge you hold it.
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const list = listRef.current;
      const d = drag.current;
      if (list && d) {
        const box = list.getBoundingClientRect();
        let depth = 0;
        if (d.y < box.top + EDGE) depth = -Math.min(1, (box.top + EDGE - d.y) / EDGE);
        else if (d.y > box.bottom - EDGE) depth = Math.min(1, (d.y - (box.bottom - EDGE)) / EDGE);
        if (depth) {
          // Whole pixels only, carrying the rest: Safari drops a fraction,
          // and a slow scroll would otherwise never move at all.
          carry += depth * MAX_SPEED * dt;
          const px = Math.trunc(carry);
          carry -= px;
          list.scrollTop += px;
          moveTo(d.id, slotAt(d.y));
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  const startDrag = (e, id) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not a real pointer */ }
    drag.current = { id, y: e.clientY };
    setDragging(id);
  };
  const onDrag = (e) => {
    if (!drag.current) return;
    drag.current.y = e.clientY;
    moveTo(drag.current.id, slotAt(e.clientY));
  };
  const endDrag = () => { drag.current = null; setDragging(null); };

  const sortBy = (compare) => setOrder(regroup([...order].sort((a, b) => compare(byId.get(a), byId.get(b)))));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal reorder-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="page-head">
          <h3 style={{ margin: 0, flex: 1 }}>Reorder — {title}</h3>
        </div>
        <div className="settings-row reorder-tools">
          <span className="muted-note" style={{ flex: 1 }}>Drag ≡ to move a line.</span>
          <button className="small" onClick={() => sortBy(byMoves)}>Sort by moves</button>
          <button className="small" onClick={() => sortBy(byName)}>Sort by name</button>
          <button className="small ghost" disabled={!changed} onClick={() => setOrder(original)}>Undo all</button>
        </div>

        <ol className="reorder-list" ref={listRef}>
          {order.map((id, i) => {
            const it = byId.get(id);
            return (
              <li key={id} data-row className={`reorder-row${it.parentId ? ' sub' : ''}${dragging === id ? ' dragging' : ''}`}>
                <button
                  type="button"
                  className="reorder-handle"
                  aria-label={`Move ${it.name}. Arrow keys move it one place.`}
                  onPointerDown={(e) => startDrag(e, id)}
                  onPointerMove={onDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') { e.preventDefault(); stepBy(id, -1); }
                    if (e.key === 'ArrowDown') { e.preventDefault(); stepBy(id, 1); }
                  }}
                >
                  ≡
                </button>
                <span className="reorder-num">{i + 1}</span>
                <span className="reorder-text">
                  <span className="reorder-name">{it.name}</span>
                  <span className="muted-note reorder-moves">{it.sub}</span>
                </span>
                <button type="button" className="small ghost" title="Move to the top" disabled={i === 0} onClick={() => moveTo(id, 0)}>⤒</button>
                <button type="button" className="small ghost" title="Move to the bottom" disabled={i === order.length - 1} onClick={() => moveTo(id, order.length - 1)}>⤓</button>
              </li>
            );
          })}
        </ol>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!changed} onClick={() => onDone(order)}>Done</button>
        </div>
      </div>
    </div>
  );
}
