import React, { useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import Board from './Board';
import { lineFens } from '../lib/pgn';
import { lastMoveOf } from '../lib/legalMoves';
import { useBackGuard } from '../lib/backGuard';
import { mergeVariations, moveNumberAt, isWhiteAt, runToNextBranch } from '../lib/repertoireTree';
import {
  PrevIcon, SkipStartIcon, StarIcon, CheckIcon, ClockIcon, PlayIcon, MonitorIcon,
} from './Icons';
import { isDue, isPracticed } from '../lib/srs';

// Walks the chapter as one tree instead of a list of lines: play a move, see
// which of your variations still run through it, and watch them peel off at
// each branch until a single line is left.
export default function TreeBrowser({
  chapter, orientation, onClose, onOpenVariation, onAnalyze,
}) {
  const tree = useMemo(() => mergeVariations(chapter.variations), [chapter.variations]);
  // Nodes from the root down to where the board is standing.
  const [path, setPath] = useState([]);
  useBackGuard(true, onClose);

  const node = path.length ? path[path.length - 1] : tree;
  const sans = path.map((n) => n.san);
  const fen = useMemo(() => lineFens(sans).slice(-1)[0], [sans.join(' ')]);
  const byId = useMemo(
    () => Object.fromEntries(chapter.variations.map((v) => [v.id, v])),
    [chapter.variations],
  );

  const go = (child) => setPath((p) => [...p, child]);
  const back = () => setPath((p) => p.slice(0, -1));
  // Down a forced run in one go: everything up to the next real decision.
  const skipAhead = () => {
    const run = runToNextBranch(node);
    if (run.length) setPath((p) => [...p, ...run]);
  };

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') back();
      else if (e.key === 'ArrowRight') { if (node.children[0]) go(node.children[0]); }
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [node, onClose]);

  const boardWidth = Math.min(460, window.innerWidth - 140);
  const total = tree.lines.length;

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <div className="viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-board">
          <Board
            id="tree-browser"
            position={fen}
            lastMove={lastMoveOf(Chess, sans, sans.length)}
            boardOrientation={orientation}
            arePiecesDraggable={false}
            boardWidth={boardWidth}
          />
          <div className="viewer-controls" style={{ marginTop: 12 }}>
            <button title="Back to the start" disabled={!path.length} onClick={() => setPath([])}>
              <SkipStartIcon size={17} />
            </button>
            <button title="Back one move (←)" disabled={!path.length} onClick={back}>
              <PrevIcon size={17} />
            </button>
            <span className="book-count">
              {node.lines.length} of {total} line{total === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className="viewer-side">
          <div className="viewer-title">
            <h3 style={{ flex: 1 }}>Browse tree</h3>
            {onAnalyze && (
              <button
                className="small ghost"
                disabled={sans.length === 0}
                title="Open this position on the analysis board"
                onClick={() => onAnalyze(sans)}
              >
                <MonitorIcon size={15} /> Analyze
              </button>
            )}
          </div>

          {/* The moves played to get here — click any of them to stand there
              again, the way the breadcrumb of a folder works. */}
          <div className="tree-path">
            <span
              className={`tb-crumb${path.length === 0 ? ' current' : ''}`}
              onClick={() => setPath([])}
            >
              Start
            </span>
            {path.map((n, i) => (
              <span
                key={n.key}
                className={`tb-crumb${i === path.length - 1 ? ' current' : ''}`}
                onClick={() => setPath((p) => p.slice(0, i + 1))}
              >
                {isWhiteAt(i + 1) && <span className="mvnum">{moveNumberAt(i + 1)}.</span>}
                {n.san}
              </span>
            ))}
          </div>

          <div className="tree-body">
            {node.children.length > 0 && (
              <>
                <div className="tb-heading">
                  {node.children.length === 1 ? 'Continues with' : `${node.children.length} continuations`}
                </div>
                {node.children.map((child) => {
                  const only = child.lines.length === 1 ? byId[child.lines[0]] : null;
                  return (
                    <button key={child.key} className="tb-move" onClick={() => go(child)}>
                      <span className="tb-san">
                        {isWhiteAt(path.length + 1)
                          ? <span className="mvnum">{moveNumberAt(path.length + 1)}.</span>
                          : <span className="mvnum">{moveNumberAt(path.length + 1)}…</span>}
                        {child.san}
                      </span>
                      <span className="tb-meta">
                        {only ? only.name : `${child.lines.length} lines`}
                      </span>
                    </button>
                  );
                })}
                {node.children.length === 1 && runToNextBranch(node).length > 1 && (
                  <button className="small ghost tb-skip" onClick={skipAhead}>
                    Skip the forced moves — {runToNextBranch(node).length} to the next branch
                  </button>
                )}
              </>
            )}

            {node.ends.length > 0 && (
              <>
                <div className="tb-heading">
                  {node.children.length > 0 ? 'Also ends here' : 'Line complete'}
                </div>
                {node.ends.map((id) => {
                  const v = byId[id];
                  if (!v) return null;
                  return (
                    <div key={id} className="tb-end">
                      <span className="tb-end-name">
                        {v.starred && <StarIcon size={13} filled />}
                        {v.name}
                      </span>
                      {isPracticed(v) && !isDue(v) && <span className="practiced-pill"><CheckIcon size={12} /> practiced</span>}
                      {isDue(v) && <span className="due-pill"><ClockIcon size={12} /> due</span>}
                      {onOpenVariation && (
                        <button className="small" onClick={() => onOpenVariation(v.id)}>
                          <PlayIcon size={13} /> Open
                        </button>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {node.children.length === 0 && node.ends.length === 0 && (
              <div className="muted-note">Nothing goes on from here.</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
