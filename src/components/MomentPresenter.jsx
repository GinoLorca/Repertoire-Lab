import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { useViewportWidth, useViewportHeight } from './useViewportWidth';
import { MomentBoard, useMomentPlaces } from './MomentBoards';
import { MomentPip } from './MomentsPanel';
import { NextIcon, PrevIcon } from './Icons';
import { useBackGuard } from '../lib/backGuard';
import { topInset, bottomInset, leftInset, rightInset } from '../lib/safeArea';
import { sideToMove } from '../lib/startPos';
import {
  presentPlan, planStart, placeAt, placeLabel, boardChange, defaultTitle, movesText,
} from '../lib/moments';

// Before & After, shown to the room (lib/moments presentSteps): full screen,
// a moment at a time — the Before with the After covered ("what happens
// next?"), the moves in between played one by one with the faded pieces
// piling up, the After uncovered with its scores and drawings, then the
// Better beside them. → / ↓ / Page Down / Space step on (a presenter
// clicker sends one of those), ← / ↑ / Page Up step back, Esc closes. The
// telestrator's pen works on every board here, as on any other.

const GAP = 16;
const HEAD = 58;
const FOOT = 62;
const PER_BOARD = 66; // a board's heading and the line under it
const NOTE = 76;

const NEXT = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter']);
const BACK = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']);

export default function MomentPresenter({
  moments, start = 0, baseFen, annotations, orientation, onClose,
}) {
  const { state, dispatch } = useStore();
  // Settings → presentCover: absent reads as on, so it has no default to
  // add to every device's settings (see lib/settingsDefaults).
  const cover = state.settings.presentCover !== false;
  const plan = useMemo(() => presentPlan(moments, { cover }), [moments, cover]);
  const [at, setAt] = useState(() => planStart(presentPlan(moments, { cover }), start));
  const pos = Math.min(at, plan.length - 1);
  const step = plan[pos];
  const moment = moments[step.index];
  const n = step.index + 1;
  const places = useMomentPlaces(moment, baseFen);
  const between = moment.after.length - moment.before.length;
  const vw = useViewportWidth();
  const vh = useViewportHeight();
  const rootRef = useRef(null);
  const enteredFull = useRef(false);
  useBackGuard(true, onClose);

  // The board on the right, part of the way to the After while it's replayed.
  const playing = useMemo(() => {
    if (step.kind !== 'play' || !places.before) return null;
    const path = moment.after.slice(0, moment.before.length + step.i);
    const place = placeAt(baseFen, path);
    return place && { ...place, path, change: boardChange(places.before.fen, place.fen) };
  }, [step, moment, baseFen, places]);

  const go = (d) => setAt((a) => Math.max(0, Math.min(plan.length - 1, Math.min(a, plan.length - 1) + d)));
  const goRef = useRef(go);
  goRef.current = go;
  const firstOf = (index) => planStart(plan, index);
  const afterOf = (index) => Math.max(0, plan.findIndex((s) => s.index === index && s.kind === 'after'));

  // Keys first, before the analysis board under this hears them — so a
  // clicker steps the presentation, not the board behind it.
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (!NEXT.has(k) && !BACK.has(k) && k !== 'Escape' && k !== 'Home' && k !== 'End') return;
      e.preventDefault();
      e.stopPropagation();
      if (k === 'Escape') onClose();
      else if (NEXT.has(k)) goRef.current(1);
      else if (BACK.has(k)) goRef.current(-1);
      else if (k === 'Home') setAt(firstOf(step.index));
      else setAt(afterOf(step.index));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }); // every render: it reads this step

  // Nothing scrolls behind it; full screen is let go of on the way out.
  useEffect(() => {
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = was;
      if (enteredFull.current && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);
  const canFull = typeof document !== 'undefined'
    && Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const toggleFull = () => {
    if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); return; }
    const el = document.documentElement;
    const ask = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (!ask) return;
    enteredFull.current = true;
    Promise.resolve(ask.call(el)).catch(() => {});
  };
  const toggleCover = () => {
    setAt(planStart(presentPlan(moments, { cover: !cover }), step.index));
    dispatch({ type: 'setSettings', settings: { presentCover: !cover } });
  };

  // ---------- What's on screen at this step ----------
  const revealed = step.kind === 'after' || step.kind === 'better';
  const boards = [{ slot: 'before', place: places.before, scored: revealed, showDrawn: true }];
  if (step.kind === 'before') {
    // Covered — and underneath, the Before itself, so the first move played
    // slides on from it.
    boards.push({
      slot: 'after', place: places.before, hidden: true, label: '', showDrawn: false,
    });
  } else if (step.kind === 'play' && playing) {
    boards.push({
      slot: 'after', place: playing, scored: false, showDrawn: false, animate: true,
      label: `${placeLabel(playing.path, baseFen)} · ${step.i} of ${between}`,
    });
  } else {
    boards.push({ slot: 'after', place: places.after, scored: true, showDrawn: true, animate: true });
  }
  if (step.kind === 'better' && places.better) {
    boards.push({ slot: 'better', place: places.better, scored: true, showDrawn: true });
  }

  // As big as the screen allows: side by side, or one above the other on a
  // tall narrow screen (an iPad held upright, a phone) — whichever is bigger.
  const k = boards.length;
  const W = vw - 32 - leftInset() - rightInset();
  const H = vh - topInset() - bottomInset() - HEAD - FOOT - 24 - NOTE;
  const across = Math.min((W - GAP * (k - 1)) / k, H - PER_BOARD);
  const down = Math.min(W, (H - GAP * (k - 1)) / k - PER_BOARD);
  const stacked = down > across;
  const size = Math.max(160, Math.floor(Math.max(across, down) / 8) * 8);

  const title = moment.title?.trim() || defaultTitle(moment, baseFen);
  const toMove = places.before ? (sideToMove(places.before.fen) === 'w' ? 'White' : 'Black') : null;
  let caption;
  if (step.kind === 'before') {
    caption = <>{toMove} to move. <strong>What would you play?</strong></>;
  } else if (step.kind === 'play' && playing) {
    caption = movesText(moment.before, playing.path, baseFen, { max: 14 });
  } else {
    caption = (
      <>
        {moment.note?.trim() && <span className="present-note">{moment.note.trim()}</span>}
        <span className="present-moves">{movesText(moment.before, moment.after, baseFen, { max: 14 })}</span>
      </>
    );
  }
  const last = pos === plan.length - 1;

  return createPortal(
    <div
      ref={rootRef}
      className="present"
      role="dialog"
      aria-label="Before and After, presented"
      style={{
        paddingTop: topInset(), paddingBottom: bottomInset(), paddingLeft: leftInset(), paddingRight: rightInset(),
      }}
    >
      <div className="present-head">
        <span className="present-count">Moment {n} of {moments.length}</span>
        <span className="present-title">{title}</span>
        <span style={{ flex: 1 }} />
        <label className="present-toggle" title="Start each moment with the After covered, and replay the moves to it">
          <input type="checkbox" checked={cover} onChange={toggleCover} /> Cover the After
        </label>
        {canFull && (
          <button type="button" className="small" onClick={toggleFull}>Full screen</button>
        )}
        <button type="button" className="small" onClick={onClose} title="Close (Esc)">Close</button>
      </div>

      <div className={`present-boards${stacked ? ' stacked' : ''}`} style={{ gap: GAP }}>
        {boards.map((b) => b.place && (
          <MomentBoard
            key={b.slot}
            moment={moment}
            n={n}
            slot={b.slot}
            place={b.place}
            baseFen={baseFen}
            annotations={annotations}
            orientation={orientation}
            width={size}
            hidden={b.hidden}
            onReveal={() => go(1)}
            label={b.label}
            scored={b.scored}
            showDrawn={b.showDrawn}
            animate={b.animate}
          />
        ))}
      </div>

      <p className="present-caption" style={{ minHeight: NOTE - 16 }}>{caption}</p>

      <div className="present-foot">
        <button type="button" className="present-nav" disabled={pos === 0} onClick={() => go(-1)} aria-label="Back">
          <PrevIcon size={20} /> Back
        </button>
        <span className="present-dots" aria-hidden="true">
          {moments.map((m, i) => (
            <button
              key={m.id}
              type="button"
              tabIndex={-1}
              className={`present-dot${i === step.index ? ' on' : ''}`}
              title={m.title?.trim() || defaultTitle(m, baseFen)}
              onClick={() => setAt(firstOf(i))}
            >
              <MomentPip role={i === step.index ? 'after' : 'before'} n={i + 1} />
            </button>
          ))}
        </span>
        <button type="button" className="present-nav primary" disabled={last} onClick={() => go(1)} aria-label="Next">
          {last ? 'The end' : 'Next'} <NextIcon size={20} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
