import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import Board from './Board';
import BoardArrows from './BoardArrows';
import MoveBadge from './MoveBadge';
import MoveTree from './MoveTree';
import LiveEvalBar from './LiveEvalBar';
import ErrorBoundary from './ErrorBoundary';
import { NotePart } from './StudyMode';
import {
  NextIcon, PrevIcon, SkipEndIcon, SkipStartIcon,
} from './Icons';
import { useStore } from '../store';
import { useViewportWidth, useViewportHeight } from './useViewportWidth';
import { useBackGuard } from '../lib/backGuard';
import { topInset, bottomInset } from '../lib/safeArea';
import { NOTE_HIGHLIGHT_STYLE } from '../lib/legalMoves';
import {
  fenAfter, lastMoveAfter, noteParts, resolveNote,
} from '../lib/studyText';
import {
  reviewModel, reviewBlocks, marksAtNode, lineMovesThrough, drawnSquareStyle, noteText,
} from '../lib/reviewText';
import { parseDoc, docFromGame } from '../lib/analysisDoc';
import { reviewsOf } from '../lib/cloud/reviews';
import {
  findNode, mainLineFrom, nodePath, lastMainLineAncestor, alternativesAt, gameLineOf,
} from '../lib/moveTree';
import { START } from '../lib/marks';

// A coach's review of a game, read the way a course is read (the study
// "read" view) — with the evaluation bar beside the board and the move box
// alongside the text. For the student it's their coach's review of their
// game; the coach sees the same thing as a preview.
//
// Opened from anywhere (the bell, the arrival note, a game's row) with
// openReview() — lib/openPlayer — and shown over whatever screen is up,
// without navigating: analysis or practice underneath carries on as it was.

const floor8 = (n) => Math.floor(n / 8) * 8;
// The review was written against other moves than the game has now (the
// student corrected their scoresheet since).
const movesChangedFor = (game, doc) => Boolean(game) && (game.moves ?? []).join(' ') !== (doc.moves ?? []).join(' ');
// A coloured variation (Studio's 1 / 2 / 3 ranking), as the move list draws it.
const LINE_HEX = { green: '#2ecc71', blue: '#3b9cff', yellow: '#e8b339' };

// Where the reader was asked to open: { gameId, coachUid?, preview?, doc?,
// title? }. Kept on window between the ask and the host picking it up, the
// way lib/openPlayer does for a person's card.
export function openReview(request) {
  window.__repertoireOpenReview = request;
  window.dispatchEvent(new Event('repertoire-open-review'));
}

// Mounted once, in App: shows the reader when one is asked for.
export function ReviewReaderHost() {
  const [request, setRequest] = useState(null);
  useEffect(() => {
    const on = () => {
      const r = window.__repertoireOpenReview;
      window.__repertoireOpenReview = null;
      if (r?.gameId) setRequest({ ...r, key: Date.now() });
    };
    window.addEventListener('repertoire-open-review', on);
    return () => window.removeEventListener('repertoire-open-review', on);
  }, []);
  if (!request) return null;
  return (
    <ErrorBoundary key={request.key}>
      <ReviewForGame request={request} onClose={() => setRequest(null)} />
    </ErrorBoundary>
  );
}

// The game, found by id among the student's own sections (or, for a coach's
// preview, anywhere), and the review to show on it.
function ReviewForGame({ request, onClose }) {
  const { state } = useStore();
  const game = useMemo(() => {
    for (const p of state.players ?? []) {
      if (!request.preview && (p.kind ?? 'self') !== 'self') continue;
      const g = (p.games ?? []).find((x) => x.id === request.gameId);
      if (g) return g;
    }
    return null;
  }, [state.players, request.gameId, request.preview]);
  const all = useMemo(() => (game ? reviewsOf(game) : []), [game]);
  const [coachUid, setCoachUid] = useState(request.coachUid ?? null);
  const current = request.preview ? null : (all.find((r) => r.coachUid === coachUid) ?? all[0] ?? null);

  const doc = useMemo(() => {
    if (request.preview) return request.doc ?? null;
    if (!game || !current) return null;
    if (current.kind === 'review') return parseDoc(game.reviews?.[current.coachUid]?.body);
    return docFromGame(game);
  }, [request.preview, request.doc, game, current?.coachUid, current?.kind, current?.rev]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!game && !request.preview) {
    return (
      <Shell onClose={onClose} title="Review">
        <p className="review-empty">This game isn’t on this device yet — it arrives with the next sync.</p>
      </Shell>
    );
  }
  if (!doc) {
    return (
      <Shell onClose={onClose} title={game?.name ?? 'Review'}>
        <p className="review-empty">There’s no review to read on this game.</p>
      </Shell>
    );
  }
  return (
    <ReviewReader
      game={game ?? request.game}
      doc={doc}
      preview={Boolean(request.preview)}
      by={request.preview ? (request.by ?? '') : (current?.by ?? '')}
      coachUid={current?.coachUid ?? null}
      kind={current?.kind ?? 'review'}
      rev={current?.rev ?? 0}
      others={request.preview ? [] : all}
      theirNotes={request.preview ? (request.theirNotes ?? {}) : null}
      onSwitch={setCoachUid}
      onClose={onClose}
    />
  );
}

function Shell({ title, onClose, children }) {
  useBackGuard(true, onClose);
  return (
    <div className="viewer-overlay review-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="review-shell">
        <div className="review-head">
          <h2>{title}</h2>
          <button type="button" className="ghost small" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ReviewReader({
  game, doc, preview, by, coachUid, kind, rev, others, theirNotes = null, onSwitch, onClose,
}) {
  const { state, dispatch } = useStore();
  const showBadges = state.settings.showMoveListBadges !== false;
  const W = useViewportWidth();
  const H = useViewportHeight();
  const model = useMemo(() => reviewModel(doc), [doc]);
  const blocks = useMemo(() => reviewBlocks(model), [model]);
  const orientation = game?.meta?.color === 'black' ? 'black' : 'white';

  // Where the reader is: a move in the tree (head), and optionally a line a
  // note mentions, played out on the board (side).
  const [head, setHead] = useState('root');
  const [side, setSide] = useState(null); // { base, path, at, label, refId }
  const [flash, setFlash] = useState(null);
  const [pane, setPane] = useState('read'); // phones: 'read' | 'moves'
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    if (!updated) return undefined;
    const t = setTimeout(() => setUpdated(false), 6000);
    return () => clearTimeout(t);
  }, [updated]);

  // Focus comes into the reader while it's open and goes back where it was
  // after: left on the button that opened it, Space or Enter would press
  // that button again underneath.
  const overlayRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    overlayRef.current?.focus({ preventScroll: true });
    return () => { if (opener?.isConnected) opener.focus?.({ preventScroll: true }); };
  }, []);

  // A newer version of the review arriving while it's open: keep the place if
  // that move is still in it, and say that it changed.
  const seenRev = useRef(rev);
  useEffect(() => {
    if (rev === seenRev.current) return;
    seenRev.current = rev;
    setUpdated(true);
    setSide(null);
    setHead((h) => (findNode(model.tree, h) ? h : 'root'));
  }, [rev, model.tree]);

  // Read means seen — on every device, since it's kept on the game.
  useEffect(() => {
    if (preview || !coachUid || !game) return;
    dispatch({
      type: 'markReviewSeen', gameId: game.id, coachUid, rev,
    });
  }, [preview, coachUid, rev, game?.id, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 1100);
    return () => clearTimeout(t);
  }, [flash]);

  const node = model.info[head] ?? model.info.root;
  const sideMoves = side ? [...side.base, ...side.path.slice(0, side.at)] : null;
  const fen = side ? (fenAfter(sideMoves, model.startFen) ?? node.fen) : node.fen;
  const lastMove = side ? lastMoveAfter(sideMoves, model.startFen) : node.lastMove;
  const marks = side ? { arrows: [], squares: {} } : marksAtNode(model, head);
  const badgeId = side ? null : (model.badges[head] ?? null);
  const squareStyles = useMemo(() => {
    const out = {};
    for (const [sq, c] of Object.entries(marks.squares)) out[sq] = drawnSquareStyle(c);
    if (flash) out[flash.square] = { ...out[flash.square], ...NOTE_HIGHLIGHT_STYLE };
    return out;
  }, [marks.squares, flash]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Moving through it ----------
  const step = useCallback((d) => {
    if (side) {
      setSide((s) => (s ? { ...s, at: Math.max(0, Math.min(s.path.length, s.at + d)) } : s));
      return;
    }
    if (d > 0) {
      const next = (head === 'root' ? model.tree : findNode(model.tree, head))?.children?.[0];
      if (next) setHead(next.id);
    } else if (head !== 'root') {
      setHead(model.info[head]?.parentId ?? 'root');
    }
  }, [side, head, model]);
  const goTo = useCallback((id) => { setSide(null); setHead(id); }, []);
  const toEnd = useCallback((end) => {
    setSide(null);
    if (!end) { setHead('root'); return; }
    const from = head === 'root' ? model.tree : findNode(model.tree, head);
    const tail = mainLineFrom(from);
    if (tail.length) setHead(tail[tail.length - 1].id);
  }, [head, model.tree]);
  const toGame = useCallback(() => { setSide(null); setHead(lastMainLineAncestor(model.tree, head)); }, [head, model.tree]);
  const onGameLine = head === 'root' || model.gameIds.has(head) || nodePath(model.tree, head).every((n) => model.gameIds.has(n.id));

  // The study view's note references need these (see StudyMode's NotePart).
  const study = useMemo(() => ({
    side,
    showSide: (line, at, label, refId) => setSide({ ...line, at, label, refId }),
    point: (square) => setFlash({ square, key: Date.now() }),
  }), [side]);

  // Keys, taken before anything underneath sees them: the reader can open over
  // the analysis board, whose own ← → F B would otherwise act as well.
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key;
      // Anything aimed at the page underneath comes back into the reader.
      const target = e.target instanceof Node ? e.target : null;
      if (target && !overlayRef.current?.contains(target) && (k === 'Enter' || k === ' ' || k === 'Tab')) {
        e.preventDefault();
        e.stopPropagation();
        overlayRef.current?.focus({ preventScroll: true });
        return;
      }
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      let handled = true;
      if (k === 'ArrowRight') step(1);
      else if (k === 'ArrowLeft') step(-1);
      else if (k === 'Home') toEnd(false);
      else if (k === 'End') toEnd(true);
      else if (k === 'ArrowDown') {
        const alt = alternativesAt(model.tree, head)[0];
        if (alt) goTo(alt.id);
      } else if (k === 'ArrowUp') toGame();
      else if (k === 'Escape') { if (side) setSide(null); else onClose(); }
      else handled = false;
      e.stopPropagation();
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [step, toEnd, toGame, goTo, side, onClose, head, model.tree]);

  useBackGuard(true, onClose);

  // ---------- Size ----------
  // Side by side when there's width for it (a desktop, an iPad on its side, a
  // phone on its side); otherwise stacked, with the text and the moves
  // sharing the space under the board. Nothing but one box ever scrolls.
  // Around the board: the overlay's margin, the header, the body's padding,
  // the step buttons — and a line for each note shown above it.
  const chrome = topInset() + bottomInset();
  const row = W >= 900 || (W > H && H < 600);
  const EVAL = state.settings.evalBar !== false ? 26 : 0;
  const banners = (updated ? 34 : 0) + (movesChangedFor(game, doc) ? 34 : 0);
  // Floors low enough that the step buttons stay on screen even on a phone
  // on its side, where height is what's short.
  const boardWidth = floor8(Math.max(row ? 160 : 200, row
    ? Math.min(720, H - chrome - 172 - banners, W - 420 - EVAL - 64)
    // Stacked: the board keeps to about three fifths of the height, so the
    // reading below it is more than a few lines on an iPad held upright.
    : Math.min(W - 32 - EVAL, (H - chrome - 150 - banners) * 0.62)));

  // ---------- The text ----------
  const box = useRef(null);
  useEffect(() => {
    const el = box.current?.querySelector('[data-current="true"]');
    const b = box.current;
    if (!el || !b) return;
    const a = el.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    if (a.top < r.top + 8 || a.bottom > r.bottom - 8) {
      b.scrollTo({ top: b.scrollTop + (a.top - r.top) - r.height / 3, behavior: 'smooth' });
    }
  }, [head, pane]);

  const onPath = useMemo(() => new Set(nodePath(model.tree, head).map((n) => n.id)), [model.tree, head]);
  const resolved = useMemo(() => {
    const out = {};
    for (const id of Object.keys(model.notes)) {
      const at = id === 'root' ? START : model.info[id].depth - 1;
      out[id] = resolveNote(lineMovesThrough(model, id), noteParts(noteText(model.notes[id])), model.startFen, at);
    }
    return out;
  }, [model]);
  // The student's own notes, beside the coach's, on the moves of the game —
  // only where this review was written against the same moves.
  // (A coach's preview is handed them — the game on the coach's side holds the
  // coach's own work too.)
  const theirs = useMemo(() => {
    if (theirNotes) return theirNotes;
    if (kind !== 'review' || !game) return {};
    const out = {};
    const same = (game.moves ?? []).length === model.moves.length && model.moves.every((m, i) => game.moves[i] === m);
    if (!same) return out;
    gameLineOf(model.tree, model.moves.length).forEach((n, i) => {
      const c = game.comments?.[i];
      if (typeof c === 'string' && noteText(c)) out[n.id] = noteText(c);
    });
    if (typeof game.comments?.[START] === 'string') out.root = noteText(game.comments[START]);
    return out;
  }, [theirNotes, kind, game, model]);
  const movesChanged = movesChangedFor(game, doc);

  const renderBlocks = (list) => list.map((b, k) => {
    if (b.kind === 'note') {
      const current = b.id === head && !side;
      return (
        <div key={`n${b.id}`} className={`study-note review-note${current ? ' current' : ''}`}>
          {b.id === 'root' && by && <div className="review-note-who">{by}</div>}
          {(resolved[b.id] ?? []).map((part, j) => (
            <NotePart key={j} part={part} study={study} refId={`${b.id}:${j}`} />
          ))}
          {theirs[b.id] && (
            <div className="review-mine"><span>Your note</span> {theirs[b.id]}</div>
          )}
        </div>
      );
    }
    if (b.kind === 'moves') {
      return (
        <p key={`m${b.ids[0]}`} className="study-moves">
          {b.ids.map((id, i) => {
            const inf = model.info[id];
            const white = inf.number.endsWith('.');
            const current = id === head && !side;
            return (
              <button
                type="button"
                key={id}
                data-current={current ? 'true' : undefined}
                className={`study-mv${current ? ' current' : ''}${onPath.has(id) && !current ? ' seen' : ''}`}
                onClick={() => goTo(id)}
              >
                {(white || i === 0) && <span className="study-num">{inf.number}</span>}
                {inf.san}
                {showBadges && model.badges[id] && <MoveBadge id={model.badges[id]} size={13} />}
              </button>
            );
          })}
          {/* The student's own note on a move without the coach's. */}
          {b.ids.filter((id) => theirs[id] && !noteText(model.notes[id] ?? '')).map((id) => (
            <span key={`t${id}`} className="review-mine inline"><span>Your note</span> {theirs[id]}</span>
          ))}
        </p>
      );
    }
    return (
      <div
        key={`l${b.rootId}:${k}`}
        className={`review-line depth-${Math.min(b.depth, 3)}`}
        style={LINE_HEX[model.highlights[b.rootId]] ? { '--line-mark': LINE_HEX[model.highlights[b.rootId]] } : undefined}
      >
        {renderBlocks(b.blocks)}
      </div>
    );
  });

  const title = game?.meta?.white || game?.meta?.black
    ? `${game.meta.white || '?'} vs ${game.meta.black || '?'}`
    : (game?.name ?? 'Game');
  const moveCount = model.trunk.length;

  const boardPart = (
    <div className="review-board-col">
      <div className="review-board-row">
        {EVAL > 0 && (
          <LiveEvalBar fen={fen} flipped={orientation === 'black'} height={boardWidth} />
        )}
        <div
          className="board-stack review-board"
          style={{ width: boardWidth, height: boardWidth }}
          onTouchStart={(e) => {
            e.currentTarget.dataset.x = e.touches.length === 1 ? e.touches[0].clientX : '';
            e.currentTarget.dataset.y = e.touches.length === 1 ? e.touches[0].clientY : '';
          }}
          onTouchEnd={(e) => {
            const { x, y } = e.currentTarget.dataset;
            if (!x) return;
            const dx = e.changedTouches[0].clientX - Number(x);
            const dy = e.changedTouches[0].clientY - Number(y);
            if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
          }}
        >
          <Board
            id="review"
            position={fen}
            boardOrientation={orientation}
            arePiecesDraggable={false}
            customSquareStyles={squareStyles}
            lastMove={lastMove}
            badge={badgeId}
            animationDuration={180}
            boardWidth={boardWidth}
          />
          <BoardArrows arrows={marks.arrows} boardWidth={boardWidth} orientation={orientation} />
        </div>
      </div>
      <div className="review-controls" style={{ width: boardWidth + EVAL }}>
        <button type="button" title="Start (Home)" aria-label="Start" disabled={head === 'root' && !side} onClick={() => toEnd(false)}><SkipStartIcon size={16} /></button>
        <button type="button" title="Back (←)" aria-label="Back" onClick={() => step(-1)}><PrevIcon size={18} /></button>
        <button type="button" title="Forward (→)" aria-label="Forward" onClick={() => step(1)}><NextIcon size={18} /></button>
        <button type="button" title="End (End)" aria-label="End" onClick={() => toEnd(true)}><SkipEndIcon size={16} /></button>
        {!onGameLine && !side && (
          <button type="button" className="small review-back-game" title="Back to the game (↑)" onClick={toGame}>Back to the game</button>
        )}
      </div>
    </div>
  );

  const textPart = (
    <div className="review-text" ref={box}>
      {side && (
        <div className="study-side-bar" role="status">
          <span className="study-side-label">Side line: <strong>{side.label}</strong></span>
          <button type="button" className="small" onClick={() => setSide(null)}>Back to the game</button>
        </div>
      )}
      <div className="study-moves-wrap">
        <button
          type="button"
          className={`study-start${head === 'root' && !side ? ' current' : ''}`}
          data-current={head === 'root' && !side ? 'true' : undefined}
          aria-label="The starting position"
          onClick={() => goTo('root')}
        >
          <SkipStartIcon size={14} />
        </button>
      </div>
      {renderBlocks(blocks)}
      {!Object.values(model.notes).some((r) => noteText(r)) && Object.keys(model.badges).length === 0 && (
        <p className="muted-note">No notes on this game yet — the moves and the engine are all there is to read.</p>
      )}
    </div>
  );

  const movesPart = (
    <div className="review-moves">
      <MoveTree
        root={model.tree}
        headId={side ? null : head}
        badges={model.badges}
        highlights={model.highlights}
        onGo={goTo}
        readOnly
      />
    </div>
  );

  return (
    <div
      className="viewer-overlay review-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Review of ${title}`}
      ref={overlayRef}
      tabIndex={-1}
    >
      <div className={`review-shell${row ? ' row' : ' stacked'}`}>
        <div className="review-head">
          <div className="review-head-text">
            <h2>{title}</h2>
            <div className="muted-note">
              {preview ? 'Preview — what your student sees' : (by ? `Reviewed by ${by}` : 'Your coach’s review')}
              {moveCount ? ` · ${Math.ceil(moveCount / 2)} moves` : ''}
            </div>
          </div>
          {others.length > 1 && (
            <select className="review-switch" value={coachUid ?? ''} onChange={(e) => onSwitch(e.target.value)} aria-label="Whose review">
              {others.map((o) => <option key={o.coachUid} value={o.coachUid}>{o.by || 'Coach'}</option>)}
            </select>
          )}
          <button type="button" className="ghost small" aria-label="Close" title="Close (Esc)" onClick={onClose}>✕</button>
        </div>
        {updated && (
          <div className="review-banner">
            {by || 'Your coach'} updated this review just now.
            <button type="button" className="small ghost" aria-label="Dismiss" onClick={() => setUpdated(false)}>✕</button>
          </div>
        )}
        {movesChanged && (
          <div className="review-banner warn">
            {by || 'Your coach'} reviewed an earlier version of these moves — the review shows the moves as they were then.
          </div>
        )}
        <div className="review-body">
          {boardPart}
          {row ? (
            <div className="review-side">
              {movesPart}
              {textPart}
            </div>
          ) : (
            <div className="review-side">
              <div className="review-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={pane === 'read'} className={pane === 'read' ? 'on' : ''} onClick={() => setPane('read')}>Read</button>
                <button type="button" role="tab" aria-selected={pane === 'moves'} className={pane === 'moves' ? 'on' : ''} onClick={() => setPane('moves')}>Moves</button>
              </div>
              {pane === 'read' ? textPart : movesPart}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
