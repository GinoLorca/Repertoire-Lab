import { useEffect, useRef } from 'react';

// Hold to draw, on a touch screen or with a pencil — the gesture from the
// Private Student Planner. There's no right button on a finger, so a finger
// resting on a square takes its place: rest a moment, then drag to another
// square for an arrow, or lift where you are to light the square. A finger
// that moves first is a piece drag or a scroll, as ever, and a quick tap is
// the board's own (`onTap` hears about it, for a board that clears its marks
// on one). A mouse is left alone: it has the right button.
//
// While a press is drawing, the page mustn't scroll under the finger and the
// piece under it mustn't be dragged off. react-dnd's touch backend (see
// Board.jsx) listens on the document, so one listener on the window, which
// hears every touchmove first, holds them back for as long as a press draws.
// Its touchSlop, set to HOLD_SLOP there, is the other half: a finger has to
// travel as far to start a piece drag as it does to give up a hold.

export const HOLD_MS = 350;
export const HOLD_SLOP = 6;

let drawingNow = false;
let guarded = false;
function guardTouchMoves() {
  if (guarded || typeof window === 'undefined') return;
  guarded = true;
  window.addEventListener('touchmove', (e) => {
    if (!drawingNow) return;
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true, passive: false });
}

// The click the browser sends after a press that drew (or a tap that only
// cleared) isn't a tap on the board: it would pick a piece up, or clear what
// was just drawn. Caught on the window, ahead of everything — React's own
// listeners included — and only near where the finger lifted, just after.
export function swallowClickAt(x, y) {
  if (typeof window === 'undefined') return;
  const swallow = (ev) => {
    if (Math.hypot(ev.clientX - x, ev.clientY - y) > 30) return;
    ev.stopPropagation();
    ev.preventDefault();
    window.removeEventListener('click', swallow, true);
  };
  window.addEventListener('click', swallow, true);
  setTimeout(() => window.removeEventListener('click', swallow, true), 700);
}

// `squareAt(x, y)`: the square under a point on this board, or null.
// `onHold(from)` when a press turns into drawing; `onMove(from, to)` as the
// finger crosses squares; `onDone(from, to)` at the lift (`to === from` for a
// square); `onCancel()` if the browser takes the gesture back; `onTap(square)`
// for a quick tap that never became a drawing.
export function useHoldToDraw({
  enabled = true, squareAt, onHold, onMove, onDone, onCancel, onTap,
}) {
  const handlers = useRef(null);
  handlers.current = {
    enabled, squareAt, onHold, onMove, onDone, onCancel, onTap,
  };
  const live = useRef(null);
  useEffect(() => {
    guardTouchMoves();
    return () => live.current?.();
  }, []);

  const onPointerDown = (e) => {
    const h = handlers.current;
    if (!h.enabled || e.pointerType === 'mouse' || !e.isPrimary) return;
    const from = h.squareAt(e.clientX, e.clientY);
    if (!from) return;
    live.current?.();
    const id = e.pointerId;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let held = false;
    let to = from;
    let timer = 0;

    const end = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      if (held) drawingNow = false;
      live.current = null;
    };
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      if (!held) {
        // Moving before the hold: a piece drag or a scroll, not ours.
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) >= HOLD_SLOP) end();
        return;
      }
      const sq = handlers.current.squareAt(ev.clientX, ev.clientY);
      if (sq && sq !== to) {
        to = sq;
        handlers.current.onMove?.(from, sq);
      }
    };
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      const drew = held;
      const at = handlers.current.squareAt(ev.clientX, ev.clientY);
      end();
      if (drew) {
        swallowClickAt(ev.clientX, ev.clientY);
        handlers.current.onDone?.(from, at ?? to);
      } else if (at) {
        handlers.current.onTap?.(at, ev);
      }
    };
    const cancel = (ev) => {
      if (ev.pointerId !== id) return;
      const drew = held;
      end();
      if (drew) handlers.current.onCancel?.();
    };
    timer = setTimeout(() => {
      held = true;
      drawingNow = true;
      handlers.current.onHold?.(from);
    }, HOLD_MS);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    live.current = end;
  };

  return { onPointerDown };
}
