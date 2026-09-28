import React, { useEffect, useMemo, useRef, useState } from 'react';
import Board from './Board';
import { lineFens } from '../lib/pgn';
import { Chess } from 'chess.js';
import { lastMoveOf } from '../lib/legalMoves';
import { startFenOf, moveNumberLabel, isStandardStart } from '../lib/startPos';
import MoveText from './MoveText';
import { BADGES, badgeAt } from '../lib/badges';
import { TagChips } from './TagEditor';
import { useBackGuard } from '../lib/backGuard';
import {
  parseMarks, toggleArrow, toggleSquare, commentAt, PEN, PEN_ORDER, START,
} from '../lib/marks';
import { isTouchCapable } from './Board';
import {
  TagIcon, StarIcon, CommentIcon, SkipStartIcon, SkipEndIcon, PrevIcon, NextIcon,
} from './Icons';

function moveLabel(moves, ply, startFen) {
  if (ply <= 0) return null;
  const i = ply - 1;
  return `${moveNumberLabel(i, startFen, '…')}${moves[i]}`;
}

// Modal that steps through one variation on a board, with per-move comments.
// `onPrevVariation`/`onNextVariation` (with `position`) let it walk to the
// neighbouring lines without closing — the whole point of the preview being
// quicker than opening each variation in turn.
const PEN_NAMES = { G: 'Green', R: 'Red', B: 'Blue', Y: 'Yellow' };

export default function VariationViewer({
  variation, orientation, onClose, onAnalyze, onSaveComment, onSetBadge, onToggleStar, onEditTags,
  onPrevVariation, onNextVariation, position,
  // Arrows and squares drawn on the line's moves, kept with it (lib/marks.js).
  onSaveMarks, startDrawing = false,
}) {
  // A line set up from a position is shown, and numbered, from there.
  const startFen = startFenOf(variation);
  const fens = useMemo(() => lineFens(variation.moves, startFen), [variation.moves, startFen]);
  // Open at the start so you can play the line through, not at the finish.
  const [ply, setPly] = useState(0);
  const [draft, setDraft] = useState('');
  const touchRef = useRef(null);
  useBackGuard(true, onClose);

  // Hold the move number across a change of line, so cycling ↑/↓ compares the
  // same point in each one and a divergence shows up as the board changing
  // under you. Only clamped, never reset: a shorter neighbour lands on its
  // last move rather than past its end.
  useEffect(() => { setPly((p) => Math.min(p, fens.length - 1)); }, [variation.id, fens.length]);

  // The comment on the position the board shows — the move just played, or
  // the starting position — taken apart into its words and its marks.
  const here = ply > 0 ? ply - 1 : START;
  const marks = parseMarks(commentAt(variation.comments, ply));
  const savedComment = marks.text;
  // Drawing: on a touch screen (no right button) you switch it on and tap;
  // with a mouse, right-drag works whenever it's on.
  const [drawing, setDrawing] = useState(Boolean(startDrawing) && Boolean(onSaveMarks));
  const [pen, setPen] = useState('G');
  const draw = onSaveMarks ? {
    arrows: marks.arrows,
    pen: PEN[pen],
    tapToDraw: drawing,
    onArrow: (from, to) => onSaveMarks(here, toggleArrow(marks, from, to, pen)),
    onSquare: (sq) => onSaveMarks(here, toggleSquare(marks, sq, pen)),
  } : { arrows: marks.arrows };
  const squareStyles = Object.fromEntries(Object.entries(marks.squares).map(([sq, fill]) => [sq, { backgroundColor: fill }]));

  // A new move, or the saved words changing — not an arrow being drawn, which
  // mustn't throw away a comment half typed.
  useEffect(() => {
    setDraft(savedComment);
  }, [ply, variation.id, savedComment]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      else if (e.key === 'ArrowRight') setPly((p) => Math.min(fens.length - 1, p + 1));
      // ← → walk the moves, so ↑ ↓ walk the lines — the same split Practice
      // already uses between stepping a line and changing which line it is.
      else if (e.key === 'ArrowUp') { e.preventDefault(); onPrevVariation?.(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); onNextVariation?.(); }
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fens.length, onClose, onPrevVariation, onNextVariation]);

  const boardWidth = Math.min(560, window.innerWidth - 140);

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div
          className="viewer-board"
          onTouchStart={(e) => { touchRef.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - (touchRef.current ?? 0);
            // While drawing, a finger on the board is drawing, not stepping.
            if (!drawing && Math.abs(dx) > 35) {
              setPly((p) => Math.min(fens.length - 1, Math.max(0, p + (dx < 0 ? 1 : -1))));
            }
          }}
        >
          <Board
            id="viewer"
            position={fens[Math.min(ply, fens.length - 1)]}
            lastMove={lastMoveOf(Chess, variation.moves, ply, startFen)}
            badge={badgeAt(variation.badges, ply - 1)?.id}
            boardOrientation={orientation}
            arePiecesDraggable={false}
            boardWidth={boardWidth}
            customSquareStyles={squareStyles}
            marks={draw}
          />
          {onSaveMarks && (
            <div className="draw-bar" style={{ maxWidth: boardWidth }}>
              <button
                type="button"
                className={`small${drawing ? ' primary' : ''}`}
                aria-pressed={drawing}
                title={isTouchCapable
                  ? 'Tap a square, then another, for an arrow; the same square twice to highlight it'
                  : 'Right-drag for an arrow, right-click a square to highlight it — or switch this on and click'}
                onClick={() => setDrawing((d) => !d)}
              >
                ✎ {drawing ? 'Drawing' : 'Draw'}
              </button>
              <span className="draw-pens" role="radiogroup" aria-label="Colour">
                {PEN_ORDER.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={pen === c}
                    aria-label={PEN_NAMES[c]}
                    title={PEN_NAMES[c]}
                    className={`draw-pen${pen === c ? ' on' : ''}`}
                    style={{ background: PEN[c] }}
                    onClick={() => setPen(c)}
                  />
                ))}
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="small ghost"
                disabled={!marks.cal.length && !marks.csl.length}
                title="Take every arrow and highlight off this position"
                onClick={() => onSaveMarks(here, { cal: [], csl: [] })}
              >
                Clear
              </button>
            </div>
          )}
          {onSaveMarks && (
            <p className="draw-hint-line muted-note" style={{ maxWidth: boardWidth }}>
              {drawing || isTouchCapable
                ? 'Tap a square, then another, for an arrow · the same square twice to highlight it · again to remove'
                : 'Right-drag for an arrow · right-click a square to highlight it · again to remove'}
              {' — saved with the line.'}
            </p>
          )}
          <div className="viewer-controls" style={{ marginTop: 12 }}>
            <button title="Start" disabled={ply === 0} onClick={() => setPly(0)}><SkipStartIcon size={17} /></button>
            <button title="Previous move" disabled={ply === 0} onClick={() => setPly((p) => Math.max(0, p - 1))}><PrevIcon size={17} /></button>
            <span className="book-count">{ply} / {fens.length - 1}</span>
            <button title="Next move" disabled={ply >= fens.length - 1} onClick={() => setPly((p) => Math.min(fens.length - 1, p + 1))}><NextIcon size={17} /></button>
            <button title="End" disabled={ply >= fens.length - 1} onClick={() => setPly(fens.length - 1)}><SkipEndIcon size={17} /></button>
          </div>
        </div>
        <div className="viewer-side">
          {(onPrevVariation || onNextVariation) && (
            <div className="viewer-pager">
              <button
                title="Previous variation (↑)"
                disabled={!position || position.index <= 0}
                onClick={onPrevVariation}
              >
                <PrevIcon size={15} />
              </button>
              <span className="muted-note">
                {position ? `Line ${position.index + 1} of ${position.total}` : 'Line'}
              </span>
              <button
                title="Next variation (↓)"
                disabled={!position || position.index >= position.total - 1}
                onClick={onNextVariation}
              >
                <NextIcon size={15} />
              </button>
            </div>
          )}
          <div className="viewer-title">
            {onToggleStar && (
              <button
                className={`star-btn${variation.starred ? ' on' : ''}`}
                title={variation.starred ? 'Remove from favorites' : 'Mark as a favorite'}
                onClick={onToggleStar}
              >
                <StarIcon size={17} filled={variation.starred} />
              </button>
            )}
            <h3 style={{ flex: 1 }}>{variation.name}</h3>
            {onEditTags && (
              <button className="small ghost" title="Themes / nickname for this variation" onClick={onEditTags}>
                <TagIcon size={15} /> Themes
              </button>
            )}
          </div>
          <TagChips tags={variation.tags} />
          <div className="viewer-moves">
            <MoveText
              moves={variation.moves}
              comments={variation.comments}
              badges={variation.badges}
              currentIndex={ply - 1}
              onClickMove={(i) => setPly(i + 1)}
              startFen={startFen}
            />
          </div>
          {onSaveComment ? (
            <div className="comment-editor">
              {ply === 0 ? (
                <>
                  <label><CommentIcon size={14} /> Comment on the {isStandardStart(startFen) ? 'starting' : 'set-up'} position</label>
                  <textarea
                    rows={2}
                    value={draft}
                    placeholder="An introduction to the line, shown before its first move in Study."
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  {draft !== savedComment && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button className="small" onClick={() => setDraft(savedComment)}>Discard</button>
                      <button className="small primary" onClick={() => onSaveComment(START, draft)}>
                        Save comment
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* The badge sits above the comment because it's the quicker
                      judgement: one click to say what kind of move this was,
                      then the words explaining why. Clicking the badge that's
                      already set clears it. */}
                  {onSetBadge && (
                    <div className="badge-picker">
                      <label><span>Badge</span></label>
                      <div className="badge-row">
                        {BADGES.map((b) => {
                          const on = (variation.badges ?? {})[ply - 1] === b.id;
                          return (
                            <button
                              key={b.id}
                              className={`badge-pick${on ? ' on' : ''}`}
                              title={b.label}
                              style={on ? { background: b.color, borderColor: b.color } : undefined}
                              onClick={() => onSetBadge(ply - 1, on ? null : b.id)}
                            >
                              <span className="bp-glyph" style={{ color: on ? '#fff' : b.color }}>
                                {b.symbol}
                              </span>
                              <span className="bp-label">{b.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <label><CommentIcon size={14} /> Comment on {moveLabel(variation.moves, ply, startFen)}</label>
                  <textarea
                    rows={2}
                    value={draft}
                    placeholder="e.g. Develops with tempo — the threat against f7 must be met."
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  {draft !== savedComment && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button className="small" onClick={() => setDraft(savedComment)}>Discard</button>
                      <button className="small primary" onClick={() => onSaveComment(ply - 1, draft)}>
                        Save comment
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            savedComment && <div className="comment-box"><CommentIcon size={14} /> {savedComment}</div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            {onAnalyze && (
              <button onClick={() => onAnalyze(variation, ply)}>Analyze this line</button>
            )}
            <button className="primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
