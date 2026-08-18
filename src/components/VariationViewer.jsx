import React, { useEffect, useMemo, useRef, useState } from 'react';
import Board from './Board';
import { lineFens } from '../lib/pgn';
import { Chess } from 'chess.js';
import { lastMoveOf } from '../lib/legalMoves';
import MoveText from './MoveText';
import { TagChips } from './TagEditor';
import { useBackGuard } from '../lib/backGuard';
import {
  TagIcon, StarIcon, CommentIcon, SkipStartIcon, SkipEndIcon, PrevIcon, NextIcon,
} from './Icons';

function moveLabel(moves, ply) {
  if (ply <= 0) return null;
  const i = ply - 1;
  return `${Math.floor(i / 2) + 1}${i % 2 === 0 ? '.' : '…'}${moves[i]}`;
}

// Modal that steps through one variation on a board, with per-move comments.
export default function VariationViewer({
  variation, orientation, onClose, onAnalyze, onSaveComment, onToggleStar, onEditTags,
}) {
  const fens = useMemo(() => lineFens(variation.moves), [variation.moves]);
  // Open at the start so you can play the line through, not at the finish.
  const [ply, setPly] = useState(0);
  const [draft, setDraft] = useState('');
  const touchRef = useRef(null);
  useBackGuard(true, onClose);

  const savedComment = ply > 0 ? (variation.comments?.[ply - 1] ?? '') : '';

  useEffect(() => {
    setDraft(savedComment);
  }, [ply, variation]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      else if (e.key === 'ArrowRight') setPly((p) => Math.min(fens.length - 1, p + 1));
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fens.length, onClose]);

  const boardWidth = Math.min(560, window.innerWidth - 140);

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div
          className="viewer-board"
          onTouchStart={(e) => { touchRef.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - (touchRef.current ?? 0);
            if (Math.abs(dx) > 35) {
              setPly((p) => Math.min(fens.length - 1, Math.max(0, p + (dx < 0 ? 1 : -1))));
            }
          }}
        >
          <Board
            id="viewer"
            position={fens[ply]}
            lastMove={lastMoveOf(Chess, variation.moves, ply)}
            boardOrientation={orientation}
            arePiecesDraggable={false}
            boardWidth={boardWidth}
          />
          <div className="viewer-controls" style={{ marginTop: 12 }}>
            <button title="Start" disabled={ply === 0} onClick={() => setPly(0)}><SkipStartIcon size={17} /></button>
            <button title="Previous move" disabled={ply === 0} onClick={() => setPly((p) => Math.max(0, p - 1))}><PrevIcon size={17} /></button>
            <span className="book-count">{ply} / {fens.length - 1}</span>
            <button title="Next move" disabled={ply >= fens.length - 1} onClick={() => setPly((p) => Math.min(fens.length - 1, p + 1))}><NextIcon size={17} /></button>
            <button title="End" disabled={ply >= fens.length - 1} onClick={() => setPly(fens.length - 1)}><SkipEndIcon size={17} /></button>
          </div>
        </div>
        <div className="viewer-side">
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
              currentIndex={ply - 1}
              onClickMove={(i) => setPly(i + 1)}
            />
          </div>
          {onSaveComment ? (
            <div className="comment-editor">
              {ply === 0 ? (
                <span className="muted-note">Step to a move to read or write its comment.</span>
              ) : (
                <>
                  <label><CommentIcon size={14} /> Comment on {moveLabel(variation.moves, ply)}</label>
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
