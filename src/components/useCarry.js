import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  pieceAt, sureAfter, carriedCentre, released,
} from '../lib/grab';
import { swallowClickAt, HOLD_EVENT, CARRY_EVENT } from './useHoldToDraw';

// Carrying a piece — the app's own, in place of the board library's
// drag-and-drop, on the boards where pieces are moved (Learn and Practice,
// the analysis board, Browse as a tree).
//
// The library's felt sticky, and set side by side with lichess's board the
// same drag showed why (finger and mouse, frame by frame):
//   · Nothing answered the press. Lichess marks the square within a frame;
//     here nothing changed until the piece was already moving.
//   · The first of the movement was lost. The board never told the browser
//     the touch was a piece's, so the browser held the finger's first 15–20
//     pixels back while it decided between a tap and a scroll, and the
//     library waited another six: the piece sat still, then jumped to catch
//     up. With a mouse it was the browser's own drag-and-drop — four pixels
//     before anything, then trailing the cursor.
//   · On lichess the piece is with the pointer on every frame.
//
// So, as lichess's board does it:
//   · A touch that lands on a piece that can be lifted is claimed there and
//     then (preventDefault on touchstart): every pixel of movement arrives.
//   · The square is marked at once, and the piece goes with the pointer
//     from the first pixel — a copy of it, made as it's pressed and moved
//     by the events themselves, with no React in between — settling centred
//     under the pointer over the first half-square (lib/grab carriedCentre):
//     no dead zone, no jump.
//   · Let go over another square, the board is asked about the move, as the
//     library asked it (onPieceDrop), and an accepted piece is simply there.
//
// What a press may still turn out to be is left as it was:
//   · A tap. A claimed touch gets no click from the browser, so one that
//     never travelled is handed the click it would have had — the views'
//     own tap-to-pick, tap-to-clear and the rest never know the difference.
//   · A hold to draw, where a rested finger draws from a piece (the analysis
//     board and the tree unless switched off; a pencil anywhere). The piece
//     still goes with the finger from the first pixel, but until the finger
//     has gone as far as gives up a hold (lib/grab sureAfter) the view isn't
//     told — and if the hold begins first (HOLD_EVENT) the piece goes back.
//
// And nothing of React's is done while a piece is in motion, where it would
// be felt: a view redrawing (a whole screen, to show a picked square and its
// dots) takes a frame or two, more on an older tablet. So the view hears of
// a carry (onPieceDragBegin) when the pointer first rests, or with the drop
// itself — unless the board says it can't wait (`eager`: Learn and Practice,
// where the reply is brought on by the lift and the drop depends on it).
//
// `on`: whether this board carries its own pieces. `hostRef`: the element
// round the board. `cfg`, read afresh at every event: { id, position,
// canLift(square), pieceFirst, eager, view } — `view` a ref to the view's
// own onPieceDrop / onPieceDragBegin / onPieceDragEnd. Returns { instant }:
// true for the one redraw in which a carried piece's move arrives, so the
// board doesn't slide it there from where it was.
const REST_MS = 70; // the pointer hasn't moved for this long: it's resting
export function useCarry(on, hostRef, cfg) {
  const live = useRef(cfg);
  live.current = cfg;
  const press = useRef(null);
  const api = useRef(null);
  const [instant, setInstant] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!on || !host) return undefined;
    let lastPointer = 'mouse';
    let lastTouch = -1e9;
    let instantOff = 0;
    // A point at the corner "fixed" is measured from (see `begin`).
    const corner = document.createElement('div');
    corner.className = 'carry-corner';
    host.appendChild(corner);

    // This board's square at a point: the square itself, whatever is over it
    // (a piece still sliding in belongs to the square it left).
    const squareElAt = (x, y) => document.elementsFromPoint(x, y).find((n) => (
      n.hasAttribute?.('data-square')
      && n.closest('[data-boardid]')?.getAttribute('data-boardid') === live.current.id
      && host.contains(n)
    )) ?? null;
    const onThisBoard = (target) => {
      const el = target?.nodeType === 1 ? target : target?.parentElement;
      const board = el?.closest?.('[data-boardid]');
      return Boolean(board && host.contains(board) && board.getAttribute('data-boardid') === live.current.id);
    };
    // Typing a note, and then a piece is touched: the note is left, as any
    // press outside it leaves it (a claimed press has no default to do it).
    const leaveEditing = () => {
      const a = document.activeElement;
      if (!a || a === document.body || host.contains(a)) return;
      if (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) a.blur();
    };

    // ---------- the copy that's carried ----------
    // Made as the piece is pressed, sitting exactly on it: the page is
    // measured there (square, piece, where "fixed" starts) while nothing is
    // moving, so that once the pointer moves there's only a transform to
    // write — no measuring, nothing laid out again, mid-gesture.
    const copyOf = (p) => {
      // The piece's own element: on its square — or, still sliding in, the
      // one that was pressed.
      let src = p.sqEl.querySelector('[data-piece]');
      if (src?.getAttribute('data-piece') !== p.piece) {
        const pressed = (p.target?.nodeType === 1 ? p.target : p.target?.parentElement)?.closest?.('[data-piece]');
        src = pressed?.getAttribute('data-piece') === p.piece ? pressed : null;
      }
      return src;
    };
    const lift = (p, src) => {
      if (!src) return;
      const copy = src.cloneNode(true);
      Object.assign(copy.style, {
        opacity: '1', visibility: 'visible', transform: 'none', transition: 'none',
      });
      const el = document.createElement('div');
      el.className = 'carry-piece';
      // (Themes dress a piece by its square as well as by itself.)
      el.setAttribute('data-square', '');
      el.style.width = `${p.size}px`;
      el.style.height = `${p.size}px`;
      el.appendChild(copy);
      p.el = el;
      place(p);
      host.appendChild(el);
      p.away = [p.sqEl, src.closest('[data-square]')].filter((sq, i, all) => sq && all.indexOf(sq) === i);
      p.away.forEach((sq) => sq.classList.add('carry-away'));
    };
    const place = (p) => {
      const c = carriedCentre({
        x: p.x, y: p.y, grab: p.grab, far: p.far, settle: p.size * 0.45,
      });
      p.el.style.transform = `translate3d(${c.x - p.size / 2 - p.origin.x}px, ${c.y - p.size / 2 - p.origin.y}px, 0)`;
    };
    const putBack = (p) => {
      p.el?.remove();
      p.el = null;
      p.away?.forEach((sq) => sq.classList.remove('carry-away'));
      p.sqEl.classList.remove('carry-press');
    };
    // The move was taken: the copy sits on its new square until the board
    // itself has the piece there — and goes in the same breath, so there's
    // never a moment with neither, nor one with both.
    const land = (p, toEl) => {
      p.sqEl.classList.remove('carry-press');
      if (!p.el) { putBack(p); return; }
      if (toEl) {
        const r = toEl.getBoundingClientRect();
        p.el.style.transform = `translate3d(${r.left + (r.width - p.size) / 2 - p.origin.x}px, ${r.top + (r.height - p.size) / 2 - p.origin.y}px, 0)`;
      }
      const still = () => p.away?.some((sq) => sq.isConnected && sq.querySelector(`[data-piece="${p.piece}"]`));
      let watch = null;
      let giveUp = 0;
      const done = () => {
        watch?.disconnect();
        clearTimeout(giveUp);
        putBack(p);
      };
      if (!still()) { done(); return; }
      // (Told of the board's own change as it's made, before it's drawn.)
      watch = new MutationObserver(() => { if (!still()) done(); });
      watch.observe(host, { subtree: true, childList: true });
      giveUp = setTimeout(done, 1500);
    };

    // ---------- a press ----------
    const begin = (kind, e, pt, id) => {
      if (!onThisBoard(e.target)) return false;
      const c = live.current;
      const sqEl = squareElAt(pt.clientX, pt.clientY);
      const sq = sqEl?.getAttribute('data-square');
      if (!sq || !c.canLift(sq)) return false;
      const piece = pieceAt(c.position, sq);
      if (!piece) return false;
      const r = sqEl.getBoundingClientRect();
      // Where "fixed" puts things: the window's corner — unless something
      // round the board (a transform, a filter) has made itself the corner.
      const o = corner.getBoundingClientRect();
      const p = {
        kind, id, sq, sqEl, piece, target: e.target,
        x0: pt.clientX, y0: pt.clientY, x: pt.clientX, y: pt.clientY, far: 0,
        grab: { x: pt.clientX - (r.left + r.width / 2), y: pt.clientY - (r.top + r.height / 2) },
        size: r.width,
        origin: { x: o.left, y: o.top },
        // Where a rested finger draws from a piece, this press may yet be that.
        hold: kind === 'pen' || (kind === 'touch' && !c.pieceFirst),
        sure: false, told: false, rest: 0, el: null, away: null,
      };
      const src = copyOf(p);
      // (Measured; from here on, only written.)
      press.current = p;
      lift(p, src);
      sqEl.classList.add('carry-press');
      host.classList.remove('carry-over');
      listen(kind);
      return true;
    };
    const moveTo = (x, y) => {
      const p = press.current;
      if (!p) return;
      p.x = x;
      p.y = y;
      const d = Math.hypot(x - p.x0, y - p.y0);
      if (d > p.far) p.far = d;
      // (No copy yet: the piece was still sliding in as it was pressed.)
      if (!p.el) lift(p, copyOf(p));
      if (p.el) place(p);
      if (!p.sure && p.far >= sureAfter(p.kind)) {
        // A carry for certain — and so not a hold to draw.
        p.sure = true;
        if (p.hold) window.dispatchEvent(new Event(CARRY_EVENT));
        if (p.kind === 'mouse') host.classList.add('carrying');
        if (live.current.eager) tell(p);
      }
      if (p.sure && !p.told) {
        clearTimeout(p.rest);
        p.rest = setTimeout(() => { if (press.current === p) tell(p); }, REST_MS);
      }
    };
    // The view hears of the carry (its square picked, its moves shown; in
    // Practice the reply brought on) — and has redrawn before anything
    // else happens, so what's asked of it next is asked of what it now knows.
    const tell = (p) => {
      if (p.told) return;
      p.told = true;
      clearTimeout(p.rest);
      flushSync(() => live.current.view.current.onPieceDragBegin?.(p.piece, p.sq));
    };
    const over = () => {
      const p = press.current;
      press.current = null;
      unlisten();
      clearTimeout(p.rest);
      host.classList.remove('carrying');
      return p;
    };
    const finish = (x, y) => {
      if (!press.current) return;
      const p = over();
      if (typeof x === 'number') { p.x = x; p.y = y; }
      const v = live.current.view.current;
      const toEl = p.sure ? squareElAt(p.x, p.y) : null;
      const to = toEl?.getAttribute('data-square') ?? null;
      const what = released({ sure: p.sure, from: p.sq, to });
      if (what === 'tap') {
        putBack(p);
        // The click the browser would have made of it, had the touch not
        // been claimed. (A mouse's comes by itself.)
        if (p.kind !== 'mouse') {
          const target = p.target?.isConnected ? p.target : document.elementFromPoint(p.x, p.y);
          target?.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true, composed: true, view: window, detail: 1, button: 0, clientX: p.x, clientY: p.y,
          }));
        }
        return;
      }
      // A carry: whatever click the browser makes of the release isn't one.
      swallowClickAt(p.x, p.y);
      let played = false;
      try {
        if (what === 'drop' && v.onPieceDrop) {
          // Not told yet (it never rested): the beginning, the drop and the
          // end go to the view together, and it redraws once for the lot.
          if (!p.told) { p.told = true; v.onPieceDragBegin?.(p.piece, p.sq); }
          // (In the same redraw as the view's answer: see `instant`.)
          setInstant(true);
          clearTimeout(instantOff);
          instantOff = setTimeout(() => setInstant(false), 600);
          played = Boolean(v.onPieceDrop(p.sq, to, p.piece));
        }
      } finally {
        if (!played) setInstant(false);
        // The drop first, then the end of the drag: the order the library
        // kept. (A piece put straight back that the view never heard of
        // being lifted has nothing to end.)
        if (p.told) v.onPieceDragEnd?.(p.piece, p.sq);
        if (played) land(p, toEl);
        else putBack(p);
      }
    };
    // Called off: Escape, another button, the window left, a touch the
    // system took back, a hold that began first, the piece gone from under
    // the hand. The piece goes back; nothing is played.
    const abort = () => {
      if (!press.current) return;
      const p = over();
      putBack(p);
      if (p.told) live.current.view.current.onPieceDragEnd?.(p.piece, p.sq);
      if (p.kind === 'mouse') {
        // The button is still down: its coming up isn't a click on the board.
        let eat = null;
        const off = () => { window.removeEventListener('click', eat, true); window.removeEventListener('mousedown', off, true); };
        eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); off(); };
        window.addEventListener('click', eat, true);
        window.addEventListener('mousedown', off, true);
      }
    };

    // ---------- the events ----------
    const mine = (e) => {
      const p = press.current;
      if (!p) return null;
      for (const t of e.changedTouches) if (t.identifier === p.id) return t;
      return null;
    };
    const onTouchMove = (e) => { const t = mine(e); if (t) moveTo(t.clientX, t.clientY); };
    const onTouchEnd = (e) => { const t = mine(e); if (t) finish(t.clientX, t.clientY); };
    const onTouchCancel = (e) => { if (mine(e)) abort(); };
    const onMouseMove = (e) => moveTo(e.clientX, e.clientY);
    const onMouseUp = (e) => { if (e.button === 0) finish(e.clientX, e.clientY); };
    const onOtherButton = (e) => { if (e.button !== 0) abort(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); abort(); } };
    const onHold = () => { const p = press.current; if (p && p.hold && !p.sure) abort(); };
    let listening = [];
    const listen = (kind) => {
      const add = (type, fn, opts) => { window.addEventListener(type, fn, opts); listening.push([type, fn, opts]); };
      if (kind === 'mouse') {
        add('mousemove', onMouseMove, true);
        add('mouseup', onMouseUp, true);
        add('mousedown', onOtherButton, true);
      } else {
        add('touchmove', onTouchMove, { capture: true, passive: true });
        add('touchend', onTouchEnd, true);
        add('touchcancel', onTouchCancel, true);
      }
      add('keydown', onKey, true);
      add('blur', abort, false);
      add(HOLD_EVENT, onHold, false);
    };
    const unlisten = () => {
      listening.forEach(([type, fn, opts]) => window.removeEventListener(type, fn, opts));
      listening = [];
    };

    const onPointerDown = (e) => { lastPointer = e.pointerType || 'mouse'; };
    const onTouchStart = (e) => {
      lastTouch = e.timeStamp;
      // One piece at a time; a second finger on the board isn't a grab.
      if (press.current) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const kind = t.touchType === 'stylus' || lastPointer === 'pen' ? 'pen' : 'touch';
      if (!begin(kind, e, t, t.identifier)) return;
      // The touch is this piece's. Unclaimed, the browser keeps the first of
      // its movement to itself (a tap? a scroll?) and the piece sits still;
      // claimed, every pixel arrives — and no mouse events or click follow,
      // which is why a tap is handed its click at the other end.
      if (e.cancelable) e.preventDefault();
      leaveEditing();
    };
    const onMouseDown = (e) => {
      if (press.current || e.button !== 0 || e.ctrlKey) return;
      // (Not the mouse events a browser sends after a touch it wasn't asked to keep.)
      if (e.timeStamp - lastTouch < 800) return;
      if (!begin('mouse', e, e, null)) return;
      // No dragging the piece's picture off, no text selected. The click
      // still comes.
      e.preventDefault();
      leaveEditing();
    };
    // A hand over a piece that will come up.
    const onMouseOver = (e) => {
      if (press.current) return;
      const el = e.target?.closest?.('[data-square]');
      const sq = el && onThisBoard(el) ? el.getAttribute('data-square') : null;
      host.classList.toggle('carry-over', Boolean(sq && live.current.canLift(sq)));
    };
    const onMouseLeave = () => host.classList.remove('carry-over');

    host.addEventListener('pointerdown', onPointerDown, true);
    host.addEventListener('touchstart', onTouchStart, { passive: false });
    host.addEventListener('mousedown', onMouseDown);
    host.addEventListener('mouseover', onMouseOver);
    host.addEventListener('mouseleave', onMouseLeave);
    api.current = { abort };
    return () => {
      abort();
      api.current = null;
      clearTimeout(instantOff);
      host.removeEventListener('pointerdown', onPointerDown, true);
      host.removeEventListener('touchstart', onTouchStart, { passive: false });
      host.removeEventListener('mousedown', onMouseDown);
      host.removeEventListener('mouseover', onMouseOver);
      host.removeEventListener('mouseleave', onMouseLeave);
      host.classList.remove('carry-over');
      corner.remove();
    };
  }, [on, hostRef]);

  // The position changed under a press: if the piece is no longer the one
  // on that square (taken, moved on by a key), there's nothing to carry.
  // And the redraw a carried move arrived in is done: the next move slides.
  useEffect(() => {
    const p = press.current;
    if (p && pieceAt(cfg.position, p.sq) !== p.piece) api.current?.abort();
    setInstant(false);
  }, [cfg.position]);

  return { instant };
}
