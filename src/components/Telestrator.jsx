import React, {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import BoardArrows from './BoardArrows';
import { PencilIcon } from './Icons';
import { classifyStroke } from '../lib/telestrator';
import {
  PENS, defaultPen, eventKey, shortcutKey,
} from '../lib/shortcuts';

// The telestrator: draw on any board with a finger, a mouse or a Pencil, the
// way a broadcast analyst draws over a replay — made for teaching from an
// iPad on a classroom smart board, whose own pens can't be relied on.
//
// One switch for the whole app (the pen in the bottom-right corner, or T), and every board
// on screen takes ink while it's on. Each board keeps its own strokes; the
// toolbar's Undo takes back the last stroke wherever it was drawn, and Clear
// wipes the lot. Nothing is saved — the ink is for the moment in the lesson,
// and it goes when the position changes or the switch goes off. Arrows saved
// in Analysis and the Board Editor are untouched by any of it.
//
// Every board gets this through Board.jsx, so there's nothing to add per view.

const TeleCtx = createContext(null);

export function useTelestrator() {
  return useContext(TeleCtx);
}

export function TelestratorProvider({ children }) {
  const { state } = useStore();
  const settings = state.settings;
  const [active, setActive] = useState(false);
  const [color, setColor] = useState(() => defaultPen(settings).value);
  const [boards, setBoards] = useState(0);
  const [inkCount, setInkCount] = useState(0);
  // id -> { undo, clear, count } for every board on screen.
  const registry = useRef(new Map());
  const lastDrawn = useRef(null);
  const fadeMs = Math.max(0, Number(settings.telestratorFade) || 0) * 1000;

  // Each time it's switched on, the pen starts as the default one.
  useEffect(() => {
    if (!active) setColor(defaultPen(settings).value);
  }, [active, settings.defaultPen]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshInk = useCallback(() => {
    let n = 0;
    registry.current.forEach((api) => { n += api.count(); });
    setInkCount(n);
  }, []);

  const register = useCallback((id, api) => {
    registry.current.set(id, api);
    setBoards(registry.current.size);
    return () => {
      registry.current.delete(id);
      setBoards(registry.current.size);
      if (lastDrawn.current === id) lastDrawn.current = null;
    };
  }, []);

  const clearAll = useCallback(() => {
    registry.current.forEach((api) => api.clear());
  }, []);

  // The last stroke drawn, on whichever board it was drawn on — or, if that
  // board has gone, the most recent one that still has ink.
  const undo = useCallback(() => {
    const own = registry.current.get(lastDrawn.current);
    if (own && own.count() > 0) { own.undo(); return; }
    const withInk = [...registry.current.values()].reverse().find((api) => api.count() > 0);
    withInk?.undo();
  }, []);

  const noteDrawn = useCallback((id) => { lastDrawn.current = id; }, []);

  // No board on screen, nothing to draw on: the switch goes off with it.
  useEffect(() => { if (boards === 0 && active) setActive(false); }, [boards, active]);

  // T (rebindable in Settings → Keyboard) switches it from anywhere a board is
  // showing; Escape switches it off. Escape is caught first, in the capture
  // phase, so leaving the telestrator doesn't also close the line viewer it
  // was drawing over.
  const toggleKey = shortcutKey(settings, 'toggleTelestrator');
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' && active) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setActive(false);
        return;
      }
      if (boards > 0 && toggleKey && eventKey(e).toLowerCase() === toggleKey) {
        e.preventDefault();
        setActive((a) => !a);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [active, boards, toggleKey]);

  const value = useMemo(() => ({
    active, color, fadeMs, register, refreshInk, noteDrawn, clearAll,
  }), [active, color, fadeMs, register, refreshInk, noteDrawn, clearAll]);

  return (
    <TeleCtx.Provider value={value}>
      {children}
      {boards > 0 && createPortal(
        <>
          <button
            type="button"
            className={`tele-fab${active ? ' active' : ''}`}
            aria-pressed={active}
            aria-label={active ? 'Stop drawing on the board' : 'Draw on the board'}
            title={active ? 'Stop drawing (Esc)' : `Draw on the board (${(toggleKey || 't').toUpperCase()})`}
            onClick={() => setActive((a) => !a)}
          >
            <PencilIcon size={20} />
          </button>
          {active && (
            <div className="tele-bar" role="toolbar" aria-label="Telestrator">
              <span className="tele-pens">
                {PENS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className={`tele-pen${color === p.value ? ' active' : ''}`}
                    style={{ background: p.value }}
                    aria-label={`${p.name} pen`}
                    aria-pressed={color === p.value}
                    onClick={() => setColor(p.value)}
                  />
                ))}
              </span>
              <button type="button" className="tele-btn" disabled={inkCount === 0} onClick={undo}>Undo</button>
              <button type="button" className="tele-btn" disabled={inkCount === 0} onClick={clearAll}>Clear</button>
              <button type="button" className="tele-btn done" onClick={() => setActive(false)}>Done</button>
            </div>
          )}
        </>,
        document.body,
      )}
    </TeleCtx.Provider>
  );
}

// A press that never wanders further than this (in px) is a tap, for the
// two-finger-tap-to-clear gesture.
const TAP_SLOP = 14;

// The drawing surface over one board. Mounted by Board.jsx for every board
// with a size of its own; draws nothing and catches nothing while the
// telestrator is off, so the board underneath plays as normal.
export function TelestratorLayer({ boardWidth, orientation, positionKey }) {
  const tele = useTelestrator();
  const id = useId();
  const [items, setItems] = useState([]); // { kind, color, at, … }
  const [live, setLive] = useState(null); // the stroke under the finger, in squares
  // The same stroke, current to the last pointer event — what's classified
  // on release, since the last move may not have rendered yet.
  const liveRef = useRef(null);
  const setStroke = (pts) => { liveRef.current = pts; setLive(pts); };
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pointers = useRef(new Map()); // pointerId -> { x, y, moved }
  const gesture = useRef({ multi: false, start: 0 });
  const layerRef = useRef(null);

  const register = tele?.register;
  const refreshInk = tele?.refreshInk;
  useEffect(() => {
    if (!register) return undefined;
    return register(id, {
      undo: () => setItems((list) => list.slice(0, -1)),
      clear: () => { setItems([]); liveRef.current = null; setLive(null); },
      count: () => itemsRef.current.length,
    });
  }, [register, id]);
  useEffect(() => { refreshInk?.(); }, [items, refreshInk]);

  // A new position — the next move, another line — starts clean, and so does
  // switching the telestrator off.
  useEffect(() => { setItems([]); liveRef.current = null; setLive(null); }, [positionKey]);
  const active = !!tele?.active;
  useEffect(() => { if (!active) { setItems([]); liveRef.current = null; setLive(null); } }, [active]);

  // Ink that fades: each mark leaves on its own once it's been up long enough.
  const fadeMs = tele?.fadeMs ?? 0;
  useEffect(() => {
    if (!fadeMs || items.length === 0) return undefined;
    const t = setInterval(() => {
      const now = Date.now();
      setItems((list) => (list.some((it) => now - it.at >= fadeMs) ? list.filter((it) => now - it.at < fadeMs) : list));
    }, 250);
    return () => clearInterval(t);
  }, [fadeMs, items.length]);

  if (!tele || !active || !boardWidth) return null;
  const size = boardWidth / 8;

  // Where the pointer is, in squares from the board's top-left as shown.
  const toSquares = (e) => {
    const r = layerRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 8, y: ((e.clientY - r.top) / r.height) * 8 };
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false });
    if (pointers.current.size === 1) {
      gesture.current = { multi: false, start: Date.now() };
      setStroke([toSquares(e)]);
    } else {
      // A second finger: this is a gesture, not a stroke.
      gesture.current.multi = true;
      setStroke(null);
    }
  };

  const onPointerMove = (e) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP) p.moved = true;
    if (gesture.current.multi) return;
    const pts = liveRef.current;
    if (!pts) return;
    const pt = toSquares(e);
    const last = pts[pts.length - 1];
    if (Math.hypot(pt.x - last.x, pt.y - last.y) * size >= 1.5) setStroke([...pts, pt]);
  };

  const onPointerEnd = (e) => {
    const p = pointers.current.get(e.pointerId);
    if (!p) return;
    pointers.current.delete(e.pointerId);
    if (gesture.current.multi) {
      // Two fingers down and up again without moving: clear the lot.
      if (pointers.current.size === 0) {
        const quick = Date.now() - gesture.current.start < 600;
        if (quick && e.type === 'pointerup' && !p.moved) tele.clearAll();
        gesture.current.multi = false;
      }
      return;
    }
    let pts = liveRef.current;
    setStroke(null);
    if (e.type !== 'pointerup' || !pts?.length) return;
    pts = [...pts, toSquares(e)]; // where it was let go, exactly
    const shape = classifyStroke(pts, orientation);
    const base = { color: tele.color, at: Date.now(), key: `${Date.now()}-${Math.random()}` };
    const item = shape.type === 'arrow'
      ? { ...base, kind: 'arrow', from: shape.from, to: shape.to }
      : shape.type === 'square'
        ? { ...base, kind: 'square', square: shape.square }
        : { ...base, kind: 'ink', points: pts };
    setItems((list) => {
      // The same square marked again in the same colour takes it away.
      if (item.kind === 'square') {
        const at = list.findIndex((it) => it.kind === 'square' && it.square === item.square);
        if (at >= 0 && list[at].color === item.color) return list.filter((_, i) => i !== at);
      }
      return [...list, item];
    });
    tele.noteDrawn(id);
  };

  // A square, from its name, to its top-left corner in squares on screen.
  const cornerOf = (sq) => {
    const file = sq.charCodeAt(0) - 97;
    const rank = Number(sq[1]) - 1;
    return orientation === 'black' ? { x: 7 - file, y: rank } : { x: file, y: 7 - rank };
  };
  const fadeStyle = fadeMs ? { animation: `tele-fade ${fadeMs}ms linear forwards` } : undefined;
  const line = (pts) => pts.map((p) => `${p.x * size},${p.y * size}`).join(' ');
  const inkWidth = Math.max(3, size * 0.09);

  return (
    <div
      ref={layerRef}
      className="tele-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => {
        if (it.kind === 'arrow') {
          return (
            <div key={it.key} className="tele-item" style={fadeStyle}>
              <BoardArrows arrows={[[it.from, it.to, it.color]]} boardWidth={boardWidth} orientation={orientation} />
            </div>
          );
        }
        if (it.kind === 'square') {
          const c = cornerOf(it.square);
          return (
            <div
              key={it.key}
              className="tele-item tele-square"
              style={{
                ...fadeStyle,
                left: c.x * size,
                top: c.y * size,
                width: size,
                height: size,
                background: `${it.color}55`,
                boxShadow: `inset 0 0 0 ${Math.max(3, size * 0.06)}px ${it.color}`,
              }}
            />
          );
        }
        return (
          <svg key={it.key} className="tele-item" style={fadeStyle} width={boardWidth} height={boardWidth}>
            <polyline
              points={line(it.points)}
              fill="none"
              stroke={it.color}
              strokeWidth={inkWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.9"
            />
          </svg>
        );
      })}
      {live && live.length > 0 && (
        <svg className="tele-item" width={boardWidth} height={boardWidth}>
          <polyline
            points={line(live)}
            fill="none"
            stroke={tele.color}
            strokeWidth={inkWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.9"
          />
        </svg>
      )}
    </div>
  );
}
