import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import Board from './Board';
import BoardArrows from './BoardArrows';
import MoveBadge from './MoveBadge';
import {
  BookIcon, NextIcon, PrevIcon, SkipStartIcon,
} from './Icons';
import { useStore } from '../store';
import { NOTE_HIGHLIGHT_STYLE } from '../lib/legalMoves';
import {
  fenAfter, lastMoveAfter, marksAt, noteParts, resolveNote, studySegments,
} from '../lib/studyText';

// Study mode: a line read the way a course teaches it — the Chessable "read"
// view. The big board is the teaching board: it shows the position at the
// move you're reading, the last move, and whatever the note on that move
// draws (the [%cal]/[%csl] arrows and squares a Lichess or Chessable export
// carries). Beside it the line reads like a book: runs of moves, and after
// the move a note is about, the note — with the moves it mentions clickable,
// played out on the board as a side line.
//
// Three pieces sharing one hook, so the practice screen can put the board in
// its board column and the text in its side column, exactly where the
// practice board and its panel were: opening Study doesn't move anything.

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const NONE = [];

export function useStudy({
  active, lineKey, moves, comments, badges, startPly = 0, onClose, onPrevVariation, onNextVariation,
}) {
  const [ply, setPly] = useState(startPly);
  // A line mentioned in a note, played out: { base, path, at, label, refId }.
  const [side, setSide] = useState(null);
  const [flash, setFlash] = useState(null); // { square, key } — a square a note points at

  // A new line (or Study reopened) starts at the position practice was at —
  // reset while rendering, not after, so no frame pairs the new line with
  // the old position or side line.
  const [seenKey, setSeenKey] = useState(lineKey);
  if (seenKey !== lineKey) {
    setSeenKey(lineKey);
    setPly(Math.min(startPly, moves.length));
    setSide(null);
    setFlash(null);
  }

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 1100);
    return () => clearTimeout(t);
  }, [flash]);

  // Worked out only while Study is open — practice renders this hook on every
  // line, and reading the notes means playing out every sequence in them.
  const segments = useMemo(() => (active ? studySegments(moves, comments) : NONE), [active, moves, comments]);
  const notes = useMemo(() => {
    const out = {};
    for (const s of segments) if (s.kind === 'note') out[s.i] = resolveNote(moves, noteParts(s.text));
    return out;
  }, [segments, moves]);

  const shownMoves = side ? [...side.base, ...side.path.slice(0, side.at)] : moves.slice(0, ply);
  const fen = useMemo(() => fenAfter(shownMoves) ?? START_FEN, [shownMoves.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastMove = useMemo(() => lastMoveAfter(shownMoves), [shownMoves.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps
  const marks = side ? { arrows: [], squares: {} } : marksAt(comments, ply);

  const step = useCallback((d) => {
    if (side) setSide((s) => (s ? { ...s, at: Math.max(0, Math.min(s.path.length, s.at + d)) } : s));
    else setPly((p) => Math.max(0, Math.min(moves.length, p + d)));
  }, [side, moves.length]);
  const goTo = useCallback((p) => { setSide(null); setPly(Math.max(0, Math.min(moves.length, p))); }, [moves.length]);
  const toEnd = useCallback((end) => {
    if (side) setSide((s) => ({ ...s, at: end ? s.path.length : 0 }));
    else setPly(end ? moves.length : 0);
  }, [side, moves.length]);

  // ← → step, Home/End jump, ↑ ↓ change line, Esc leaves a side line and then
  // Study itself.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'Home') { e.preventDefault(); toEnd(false); }
      else if (e.key === 'End') { e.preventDefault(); toEnd(true); }
      else if (e.key === 'ArrowUp' && onPrevVariation) { e.preventDefault(); onPrevVariation(); }
      else if (e.key === 'ArrowDown' && onNextVariation) { e.preventDefault(); onNextVariation(); }
      else if (e.key === 'Escape') { e.preventDefault(); if (side) setSide(null); else onClose(); }
      // B opened it; B closes it.
      else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, step, toEnd, side, onClose, onPrevVariation, onNextVariation]);

  return {
    moves,
    badges,
    ply,
    side,
    segments,
    notes,
    fen,
    lastMove,
    arrows: marks.arrows,
    squares: marks.squares,
    flash,
    badgeId: side ? null : badges?.[ply - 1] ?? null,
    step,
    goTo,
    toEnd,
    showSide: (line, at, label, refId) => setSide({ ...line, at, label, refId }),
    leaveSide: () => setSide(null),
    point: (square) => setFlash({ square, key: Date.now() }),
    atStart: side ? side.at === 0 : ply === 0,
    atEnd: side ? side.at >= side.path.length : ply >= moves.length,
  };
}

// The teaching board, and under it the way through: back, forward, on to the
// next line, and out.
export function StudyBoard({
  study, boardWidth, orientation, onExit, onNextVariation, nextLabel = 'Next variation',
}) {
  const touch = useRef(null);
  const squareStyles = useMemo(() => {
    const out = {};
    // backgroundColor, not background: the shorthand would wipe the move
    // badge the board draws on the same square as a background image.
    for (const [sq, fill] of Object.entries(study.squares)) out[sq] = { backgroundColor: fill };
    if (study.flash) out[study.flash.square] = { ...out[study.flash.square], ...NOTE_HIGHLIGHT_STYLE };
    return out;
  }, [study.squares, study.flash]);
  return (
    <>
      <div
        className="board-stack study-board"
        style={{ width: boardWidth, height: boardWidth }}
        // A swipe across the board steps the line — the phone's ← / →.
        // Only a clearly sideways swipe: scrolling the page with a thumb that
        // starts on the board arcs a little, and mustn't step the line too.
        onTouchStart={(e) => {
          touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
        }}
        onTouchEnd={(e) => {
          const from = touch.current;
          touch.current = null;
          if (!from) return;
          const dx = e.changedTouches[0].clientX - from.x;
          const dy = e.changedTouches[0].clientY - from.y;
          if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) study.step(dx < 0 ? 1 : -1);
        }}
      >
        <Board
          id="study"
          position={study.fen}
          boardOrientation={orientation}
          arePiecesDraggable={false}
          customSquareStyles={squareStyles}
          lastMove={study.lastMove}
          badge={study.badgeId}
          animationDuration={180}
          boardWidth={boardWidth}
        />
        <BoardArrows arrows={study.arrows} boardWidth={boardWidth} orientation={orientation} />
      </div>
      <div className="study-controls" style={{ maxWidth: boardWidth }}>
        <button type="button" title="Back a move (←)" aria-label="Back a move" disabled={study.atStart} onClick={() => study.step(-1)}>
          <PrevIcon size={18} />
        </button>
        <button type="button" title="Forward a move (→)" aria-label="Forward a move" disabled={study.atEnd} onClick={() => study.step(1)}>
          <NextIcon size={18} />
        </button>
        <span style={{ flex: 1 }} />
        {onNextVariation && (
          <button type="button" title="The next line, still in Study (↓)" onClick={onNextVariation}>
            {nextLabel} <NextIcon size={15} />
          </button>
        )}
        <button type="button" className="primary" title="Back to practice (Esc)" onClick={onExit}>Exit</button>
      </div>
    </>
  );
}

// The line as a book reads it.
export function StudyText({
  study, title, meta, onExit, onNextVariation, nextLabel = 'Next variation', style,
}) {
  const { state } = useStore();
  const showBadges = state.settings.showMoveListBadges !== false;
  const scroller = useRef(null);

  // Keep the move being read in view. Measured against the part of the text
  // box actually on screen — under the board on an iPad upright or a phone,
  // much of the box is below the edge — and then the page itself nudged if
  // the move is still out of sight.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const el = box.querySelector(`[data-ply="${study.ply - 1}"]`) ?? (study.ply === 0 ? box.firstElementChild : null);
    if (!el) { box.scrollTop = 0; return; }
    const a = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const barBottom = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    const top = Math.max(b.top, barBottom);
    const bottom = Math.min(b.bottom, window.innerHeight);
    if (bottom - top > 40 && (a.top < top + 8 || a.bottom > bottom - 8)) {
      box.scrollTop += a.top - top - (bottom - top) / 3;
    }
    const after = el.getBoundingClientRect();
    if (after.bottom > window.innerHeight || after.top < barBottom) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [study.ply, study.moves]);

  const current = study.side ? -2 : study.ply - 1;
  return (
    <div className="study-panel" style={style}>
      <div className="study-head">
        <div className="study-head-text">
          <h3>{title}</h3>
          {meta && <div className="muted-note">{meta}</div>}
        </div>
        <button type="button" className="ghost small book-btn active" title="Back to practice (Esc)" aria-label="Close Study" onClick={onExit}>
          <BookIcon />
        </button>
      </div>

      {study.side && (
        <div className="study-side-bar" role="status">
          <span className="study-side-label">
            Side line: <strong>{study.side.label}</strong>
          </span>
          <span className="study-side-steps">
            <button type="button" className="small ghost" aria-label="Back" disabled={study.side.at === 0} onClick={() => study.step(-1)}><PrevIcon size={14} /></button>
            <button type="button" className="small ghost" aria-label="Forward" disabled={study.side.at >= study.side.path.length} onClick={() => study.step(1)}><NextIcon size={14} /></button>
          </span>
          <button type="button" className="small" onClick={study.leaveSide}>Back to the line</button>
        </div>
      )}

      <div className="study-text" ref={scroller}>
        {study.segments.length === 0 && <p className="muted-note">This line has no moves yet.</p>}
        {study.segments.map((seg, k) => (seg.kind === 'moves' ? (
          <p key={`m${seg.moves[0].i}`} className="study-moves">
            {k === 0 && (
              <button
                type="button"
                className={`study-start${study.ply === 0 && !study.side ? ' current' : ''}`}
                title="The starting position"
                aria-label="The starting position"
                onClick={() => study.goTo(0)}
              >
                <SkipStartIcon size={14} />
              </button>
            )}
            {seg.moves.map((m) => (
              <button
                type="button"
                key={m.i}
                data-ply={m.i}
                className={`study-mv${m.i === current ? ' current' : ''}${m.i < study.ply && !study.side ? ' seen' : ''}`}
                onClick={() => study.goTo(m.i + 1)}
              >
                {m.number && <span className="study-num">{m.number}</span>}
                {m.san}
                {showBadges && study.badges?.[m.i] && <MoveBadge id={study.badges[m.i]} size={13} />}
              </button>
            ))}
          </p>
        ) : (
          <div key={`n${seg.i}`} className={`study-note${seg.i === current ? ' current' : ''}`}>
            {(study.notes[seg.i] ?? []).map((part, j) => <NotePart key={j} part={part} study={study} refId={`${seg.i}:${j}`} />)}
          </div>
        )))}
        {study.moves.length > 0 && (
          <div className="study-end">
            <span className="muted-note">End of the line.</span>
            {onNextVariation && (
              <button type="button" className="small" onClick={onNextVariation}>
                {nextLabel} <NextIcon size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NotePart({ part, study, refId }) {
  if (part.kind === 'text') return <>{part.text}</>;
  if (part.kind === 'loose') {
    // No move number to place it: all that can be shown is where it lands.
    if (!part.square) return <strong>{part.text}</strong>;
    return (
      <button type="button" className="study-ref loose" title="Show the square on the board" onClick={() => study.point(part.square)}>
        {part.text}
      </button>
    );
  }
  const label = part.moves.map((m) => m.text).join(' ');
  return (
    <span className="study-seq">
      {part.line && part.moves[0].ply === 0 && (
        <SkipStartIcon size={12} className="study-seq-start" aria-hidden="true" />
      )}
      {part.moves.map((m, k) => {
        // Moves past the first one that can't be played (a slip in the text)
        // only show where they land.
        const playable = part.line && k < part.line.playable;
        return (
        <React.Fragment key={k}>
          {k > 0 && ' '}
          <button
            type="button"
            className={`study-ref${playable ? '' : ' unplayable'}${study.side?.refId === refId && study.side.at === k + 1 ? ' current' : ''}`}
            title={playable ? 'Play it out on the board' : 'Show where it lands'}
            onClick={() => {
              if (playable) study.showSide(part.line, k + 1, label, refId);
              else {
                const squares = m.san.match(/[a-h][1-8]/g);
                if (squares) study.point(squares[squares.length - 1]);
              }
            }}
          >
            {m.text}
          </button>
        </React.Fragment>
        );
      })}
    </span>
  );
}
