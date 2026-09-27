import {
  useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import { flushSync } from 'react-dom';

// Dragging cards around a grid to rearrange them — the Library's chapters
// and folders.
//
// With a mouse or trackpad the whole card drags, once it has moved a few
// pixels (so a click still opens it). With a finger it's the grip on the
// card, held for a moment first — a long press on the card itself opens its
// menu, a finger elsewhere on it is scrolling the page, and a flick that
// happens to start on the grip mustn't rearrange anything. Drop marks show
// where it will land — a bar before or after a card, or, over the middle of
// a folder or its open contents, the folder itself ("file it in here"). Near
// the top or bottom of the screen the page scrolls on its own. Esc cancels.
//
// Cards say what they are with data attributes (see `item`), so one drag
// serves every grid on the page: a drag only ever lands on cards of its own
// `scope`. Only the pointer that started a drag moves, drops or cancels it —
// a thumb resting on the iPad, or a trackpad nudge, doesn't take it over.
//
//   meta: { scope, key, label, canInto?, ...anything onDrop needs }
//   onDrop(meta, { key, where: 'before' | 'after' | 'into' })

const SLOP = 6; // px a mouse moves before a press becomes a drag
const HOLD_MS = 150; // a finger rests on the grip this long before it drags
const TOUCH_SLOP = 8; // …without moving more than this
const EDGE = 70; // px from the top/bottom of the visible page where it scrolls
const MAX_SPEED = 900; // px a second, right at the edge

const sameTarget = (a, b) => (a?.key ?? null) === (b?.key ?? null) && a?.where === b?.where && a?.axis === b?.axis;

export function useCardDrag(onDrop) {
  // What's drawn — the dragged card, the drop mark, the ghost's words. The
  // pointer's position lives in `live` and moves the ghost directly, so a
  // move only re-renders the page when the drop mark changes.
  const [view, setView] = useState(null); // { meta, target }
  const live = useRef(null); // { meta, pointerId, type, x, y, target, barBottom }
  const pending = useRef(null); // a press that may become a drag
  const ghostRef = useRef(null);
  const stop = useRef(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const placeGhost = () => {
    const el = ghostRef.current;
    const d = live.current;
    if (!el || !d) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // Beside the pointer on the side with room; above a finger, where the
    // hand doesn't cover it.
    let left = d.type === 'mouse' ? (d.x > window.innerWidth / 2 ? d.x - w - 14 : d.x + 14) : d.x - w / 2;
    let top = d.type === 'mouse' ? d.y + 14 : d.y - h - 40;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - h - 8, top));
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  };
  useLayoutEffect(placeGhost, [view]);

  const retarget = () => {
    const d = live.current;
    if (!d) return;
    const t = targetAt(d.x, d.y, d);
    if (!sameTarget(t, d.target)) {
      d.target = t;
      setView({ meta: d.meta, target: t });
    }
  };

  // `release`: 'now' — the button just came up on a card, so the click it
  // makes isn't one; 'later' — Esc, with the button still down; 'none'.
  const finish = (drop, release) => {
    const d = live.current;
    if (!d) return;
    live.current = null;
    stop.current?.();
    stop.current = null;
    document.body.classList.remove('card-dragging');
    setView(null);
    if (drop && d.target) dropRef.current(d.meta, d.target);
    swallowClick(release);
  };

  const begin = (meta, pointerId, type, x, y) => {
    window.getSelection?.()?.removeAllRanges();
    const barBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    live.current = { meta, pointerId, type, x, y, target: null, barBottom: Math.max(0, barBottom) };
    document.body.classList.add('card-dragging');
    // Listening from this moment, not after a render: a release in the same
    // instant still ends the drag.
    const move = (e) => {
      const d = live.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (d.type === 'mouse' && !(e.buttons & 1)) { finish(false, 'none'); return; }
      e.preventDefault();
      d.x = e.clientX;
      d.y = e.clientY;
      placeGhost();
      retarget();
    };
    const up = (e) => {
      const d = live.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.x = e.clientX;
      d.y = e.clientY;
      retarget();
      finish(true, 'now');
    };
    const cancel = (e) => {
      const d = live.current;
      if (d && e.pointerId === d.pointerId) finish(false, 'none');
    };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(false, 'later'); } };
    // A wheel or trackpad scroll mid-drag puts a different card under the
    // pointer.
    const scrolled = () => retarget();
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', scrolled, { passive: true });
    // Scrolling near the edges, by the clock rather than per frame; the top
    // edge is the bottom of the app's bar, not the screen.
    let frame;
    let last = performance.now();
    let carry = 0;
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const d = live.current;
      if (d) {
        let depth = 0;
        const top = d.barBottom;
        if (d.y < top + EDGE) depth = -Math.min(1, (top + EDGE - d.y) / EDGE);
        else if (d.y > window.innerHeight - EDGE) depth = Math.min(1, (d.y - (window.innerHeight - EDGE)) / EDGE);
        if (depth) {
          carry += depth * MAX_SPEED * dt;
          const px = Math.trunc(carry);
          carry -= px;
          if (px) window.scrollBy(0, px); // the scroll listener re-aims
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    stop.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scrolled);
      cancelAnimationFrame(frame);
    };
    flushSync(() => setView({ meta, target: null }));
    placeGhost();
  };

  // A press that may become a drag: a mouse once it moves, a finger on the
  // grip once it has rested there.
  useEffect(() => {
    const move = (e) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      const far = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (p.type === 'mouse') {
        if (!(e.buttons & 1)) { pending.current = null; return; }
        if (far > SLOP) { pending.current = null; begin(p.meta, p.pointerId, 'mouse', e.clientX, e.clientY); }
      } else if (far > TOUCH_SLOP) {
        // Moving before it was held: a flick, not a drag.
        clearTimeout(p.timer);
        pending.current = null;
      } else {
        p.lastX = e.clientX;
        p.lastY = e.clientY;
      }
    };
    const drop = (e) => {
      const p = pending.current;
      if (p && (e.type === 'dragstart' || e.pointerId === p.pointerId)) {
        clearTimeout(p.timer);
        pending.current = null;
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', drop);
    window.addEventListener('dragstart', drop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', drop);
      window.removeEventListener('dragstart', drop);
      clearTimeout(pending.current?.timer);
      stop.current?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    drag: view,
    ghostRef,
    // On the card: what it is, how it looks mid-drag, and a mouse drag.
    item(meta, { into = false } = {}) {
      const mine = view && view.meta.scope === meta.scope;
      const source = mine && view.meta.key === meta.key;
      const hit = mine && view.target?.key === meta.key ? view.target : null;
      const where = hit ? `${hit.where}${hit.axis === 'y' && hit.where !== 'into' ? '-y' : ''}` : null;
      return {
        'data-drag-scope': meta.scope,
        'data-drag-key': meta.key,
        'data-drag-into': into ? 'yes' : undefined,
        dragClass: `drag-item${source ? ' drag-source' : ''}${where ? ` drop-${where}` : ''}`,
        onPointerDown: (e) => {
          if (e.pointerType !== 'mouse' || e.button !== 0 || live.current) return;
          // Buttons and fields on the card keep their own clicks.
          if (e.target.closest('button, a, input, select, textarea, [role="button"]')) return;
          pending.current = { meta, pointerId: e.pointerId, type: 'mouse', x: e.clientX, y: e.clientY };
        },
      };
    },
    // The grip: a mouse drags from here straight away, a finger once held.
    grip(meta) {
      return {
        role: 'button',
        tabIndex: -1,
        'aria-label': `Drag to rearrange ${meta.label}`,
        title: 'Drag to rearrange',
        className: 'drag-grip',
        onPointerDown: (e) => {
          if (e.button !== 0 || live.current) return;
          e.preventDefault();
          e.stopPropagation(); // not the card's long press
          if (e.pointerType === 'mouse') { begin(meta, e.pointerId, 'mouse', e.clientX, e.clientY); return; }
          clearTimeout(pending.current?.timer);
          const p = {
            meta, pointerId: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY,
          };
          p.timer = setTimeout(() => {
            if (pending.current !== p) return;
            pending.current = null;
            navigator.vibrate?.(8);
            begin(p.meta, p.pointerId, p.type, p.lastX, p.lastY);
          }, HOLD_MS);
          pending.current = p;
        },
        onClick: (e) => e.stopPropagation(),
      };
    },
  };
}

// After a drag, the release that ends it isn't a click on whatever it lands
// on. `when`: 'now' (the button just came up), 'later' (it's still down —
// Esc), or 'none'.
function swallowClick(when) {
  if (when === 'none') return;
  const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  const arm = () => {
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 80);
  };
  if (when === 'later') window.addEventListener('pointerup', arm, { capture: true, once: true });
  else arm();
}

// Where a drop at (x, y) would land, for a drag of `d.meta`.
function targetAt(x, y, d) {
  const { meta } = d;
  // Over the app's bar (cards scroll underneath it), or above it: nothing.
  if (y < d.barBottom) return null;
  const stack = document.elementsFromPoint(x, y);
  if (stack[0]?.closest?.('.topbar')) return null;
  let card = null;
  for (const el of stack) {
    // An open folder's contents, in a drag of the grid the folder is in:
    // a chapter goes in the folder; anything else lands nowhere here.
    const panel = el.closest?.('[data-drag-panel-scope]');
    if (panel && panel.dataset.dragPanelScope === meta.scope) {
      return meta.canInto ? { key: panel.dataset.dragPanelKey, where: 'into', axis: 'x' } : null;
    }
    // The "+ Add Chapter" tile: at the end.
    const end = el.closest?.('[data-drag-end]');
    if (end && end.dataset.dragEnd === meta.scope) {
      const lastKey = end.dataset.dragLast;
      return lastKey && lastKey !== meta.key ? { key: lastKey, where: 'after', axis: 'x' } : null;
    }
    const c = el.closest?.('[data-drag-scope]');
    if (c && c.dataset.dragScope === meta.scope) { card = c; break; }
  }
  if (!card) {
    // Between cards of the same grid: the last mark stays.
    const inGrid = stack.some((el) => el.closest?.(`[data-drag-grid="${CSS.escape(meta.scope)}"]`));
    return inGrid ? d.target : null;
  }
  const key = card.dataset.dragKey;
  if (key === meta.key) return null;
  const r = card.getBoundingClientRect();
  if (card.dataset.dragInto && meta.canInto) {
    const inX = x > r.left + r.width * 0.2 && x < r.right - r.width * 0.2;
    const inY = y > r.top + r.height * 0.2 && y < r.bottom - r.height * 0.2;
    if (inX && inY) return { key, where: 'into', axis: 'x' };
  }
  // One card to a row (a phone): before or after by height; otherwise by
  // side, reading across the rows.
  const row = card.parentElement?.getBoundingClientRect();
  const single = row && r.width > row.width * 0.6;
  const before = single ? y < r.top + r.height / 2 : x < r.left + r.width / 2;
  return { key, where: before ? 'before' : 'after', axis: single ? 'y' : 'x' };
}
