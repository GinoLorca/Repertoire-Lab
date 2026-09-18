import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { ChessboardDnDProvider, SparePiece } from 'react-chessboard';
import { TouchBackend } from 'react-dnd-touch-backend';
import { useStore, uid } from '../store';
import Board from './Board';
import {
  START_MAP, fenToBoardMap, fenMeta, boardMapToFen, PRESETS,
} from '../lib/boardEditor';
import { makePieces, DEFAULT_PIECE_LIGHT, DEFAULT_PIECE_DARK } from '../lib/pieces';
import { boardColors } from '../lib/theme';
import { shortcutMap } from '../lib/shortcuts';
import { MonitorIcon, ShuffleIcon } from './Icons';

const PALETTE = ['K', 'Q', 'R', 'B', 'N', 'P'];

// Unlike Board.jsx's shared dndProviderProps (HTML5Backend on a mouse,
// TouchBackend only where touch is actually detected), the editor always
// takes TouchBackend — mouse included, via enableMouseEvents. Removing a
// piece here means dragging it to nowhere on purpose, and native HTML5 drag
// treats a drop with no valid target as REJECTED (dropEffect stays 'none'):
// the browser won't fire dragend until it's finished the native "drag image
// snaps back" animation, which macOS runs at full length even though the
// image itself (getEmptyImage()) is invisible — the piece visibly sits there
// for the best part of a second before it's actually gone. TouchBackend never
// opens a native drag session at all, so there's nothing to snap back.
//
// react-dnd caches ONE manager per context object (createSingletonDndContext
// in its bundled core), defaulting to `window` when no context is given —
// so leaving `context` unset here doesn't get the editor its own manager, it
// gets whichever ONE ALREADY EXISTS on window. Engine mode's board never
// wraps itself in a provider, so opening Analysis (which lands on Engine
// mode first) silently creates that global singleton with HTML5Backend
// before the editor is ever opened — and once it exists, EVERY provider on
// the page reuses it, backend prop and all, ignoring whatever's passed here.
// This `context` object is what gives the editor's manager its own slot
// instead, so it actually gets built with TouchBackend as configured.
const EDITOR_DND_CONTEXT = {};
const EDITOR_DND_PROPS = {
  backend: TouchBackend,
  options: { enableMouseEvents: true, delayTouchStart: 0 },
  context: EDITOR_DND_CONTEXT,
};

// Two ways to place a piece. Drag any piece already on the board to any
// other square, or pick one from the tray below and tap a square to drop a
// new one (tap again to erase); dragging off the board removes it.
//
// A drag that's a legal chess move from the current position is RECORDED as
// one — that's what lets a line built by playing it out, e.g. e4 e5 Nf3
// Nc6, arrive at Analysis as a real, steppable move list instead of just a
// final position. Anything else — a knight teleported across the board, a
// hand-placed queen, a pawn parked on the 1st rank — still works with no
// legality check at all, exactly the freedom a real board has when you're
// setting one up by hand; it just can't be written down as a move, so it
// becomes the new starting point and whatever was recorded before it stops
// counting as "played" (a teleport has no notation to hand off along with
// it).
export default function BoardEditor({ onSendToAnalysis, boardWidth }) {
  const { state, dispatch } = useStore();
  const [map, setMap] = useState(START_MAP);
  const [sideToMove, setSideToMove] = useState('w');
  const [castling, setCastling] = useState({ K: true, Q: true, k: true, q: true });
  // Which move a preset or a pasted FEN actually starts on — carried through
  // to Analysis so its move list numbers from here, not from move 1 as if
  // this were a brand new game.
  const [halfmove, setHalfmove] = useState(0);
  const [fullmove, setFullmove] = useState(1);
  // Where the current run of recorded legal moves began, and the SAN list
  // played since — reset to "right here, nothing played yet" by any setup
  // action (a preset, Clear/Starting position, a hand-placed piece) and
  // extended by every legal drag. What actually goes to Analysis.
  const [baseSnapshot, setBaseSnapshot] = useState(
    () => boardMapToFen(START_MAP, 'w', { K: true, Q: true, k: true, q: true }, 0, 1),
  );
  const [recordedMoves, setRecordedMoves] = useState([]);
  // A piece code like 'wK', or 'erase', or null — nothing pre-held by
  // default, so a stray tap on the board (easy to land while trying to drag)
  // can't silently overwrite whatever's there with a leftover tray selection.
  const [held, setHeld] = useState(null);
  const [orientation, setOrientation] = useState('white');
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [posName, setPosName] = useState('');
  const [selectedPosId, setSelectedPosId] = useState('');
  const [oppositeSide, setOppositeSide] = useState('wK'); // which colour goes kingside, for the opposite-castling preset

  // The editor has its own board and its own orientation — separate from the
  // engine board's — so the global flip shortcut in AnalysisView's keydown
  // handler was flipping a board nobody could see while this one was open.
  // Same rebindable key (Settings → Keyboard), just wired to this board too.
  const keyMap = useMemo(() => shortcutMap(state.settings), [state.settings.shortcuts]);
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (keyMap[e.key.toLowerCase()] === 'flipBoard') {
        setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyMap]);

  // Right-click (or long-press) a square and it says its own name, big, in the
  // middle of the screen — the thing you want while setting a position up from
  // a diagram or a coach's instruction, without counting files across the
  // board. `at` is only there to restart the animation when the same square is
  // asked for twice in a row: same text, new element, so it pops again.
  const [squareName, setSquareName] = useState(null); // { square, at }
  const flashTimer = useRef(null);
  const flashSquare = (square) => {
    if (!square) return;
    clearTimeout(flashTimer.current);
    setSquareName({ square, at: Date.now() });
    flashTimer.current = setTimeout(() => setSquareName(null), 3000);
  };
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  // The long-press half, for touch. Held in a ref rather than state so a press
  // that turns into a drag doesn't re-render the board mid-gesture.
  const press = useRef(null); // { timer, x, y }
  const endPress = () => {
    if (!press.current) return;
    clearTimeout(press.current.timer);
    press.current = null;
  };
  const onPressStart = (e) => {
    if (e.pointerType === 'mouse') return; // a mouse has a right button
    const square = document.elementFromPoint(e.clientX, e.clientY)
      ?.closest?.('[data-square]')?.getAttribute('data-square');
    if (!square) return;
    endPress();
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => flashSquare(square), 500),
    };
  };
  const onPressMove = (e) => {
    if (!press.current) return;
    if (Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 8) endPress();
  };

  const chosenColors = boardColors(state.settings);
  const pieceLight = chosenColors.pieceLight ?? DEFAULT_PIECE_LIGHT;
  const pieceDark = chosenColors.pieceDark ?? DEFAULT_PIECE_DARK;
  const pieces = useMemo(() => makePieces(pieceLight, pieceDark), [pieceLight, pieceDark]);

  const fen = useMemo(
    () => boardMapToFen(map, sideToMove, castling, halfmove, fullmove),
    [map, sideToMove, castling, halfmove, fullmove],
  );

  const loadFen = (f) => {
    setMap(fenToBoardMap(f));
    const meta = fenMeta(f);
    setSideToMove(meta.sideToMove);
    setCastling(meta.castling);
    setHalfmove(meta.halfmove);
    setFullmove(meta.fullmove);
    setBaseSnapshot(f);
    setRecordedMoves([]);
  };

  // A raw, non-move edit: apply it, then treat the result as a fresh
  // starting point — whatever was recorded before it no longer leads
  // anywhere real.
  const rawEdit = (next) => {
    setMap(next);
    setBaseSnapshot(boardMapToFen(next, sideToMove, castling, halfmove, fullmove));
    setRecordedMoves([]);
  };

  const onSquareClick = (square) => {
    if (!held) return;
    const next = { ...map };
    if (held === 'erase') delete next[square];
    else next[square] = held;
    rawEdit(next);
  };

  // Dragging straight from the tray onto a square — alongside the tap-a-
  // piece-then-tap-a-square flow above, not instead of it. Same outcome as
  // placing a held piece, so it goes through the same rawEdit reset.
  const onSparePieceDrop = (piece, targetSquare) => {
    rawEdit({ ...map, [targetSquare]: piece });
    return true;
  };

  const onPieceDrop = (from, to) => {
    if (from === to) return false;
    let legalFen = null;
    let san = null;
    try {
      const clone = new Chess(fen);
      const mv = clone.move({ from, to, promotion: 'q' });
      if (mv) { legalFen = clone.fen(); san = mv.san; }
    } catch { /* current position isn't a valid one to check legality against
                 (no king yet, say) — falls through to the raw edit below */ }

    if (legalFen) {
      setMap(fenToBoardMap(legalFen));
      const meta = fenMeta(legalFen);
      setSideToMove(meta.sideToMove);
      setCastling(meta.castling);
      setHalfmove(meta.halfmove);
      setFullmove(meta.fullmove);
      setRecordedMoves((rm) => [...rm, san]);
    } else {
      if (!map[from]) return false;
      const next = { ...map };
      next[to] = next[from];
      delete next[from];
      rawEdit(next);
    }
    return true;
  };

  const onPieceDropOffBoard = (square) => {
    if (!map[square]) return;
    const next = { ...map };
    delete next[square];
    rawEdit(next);
  };

  const clearBoard = () => {
    const empty = {};
    const noCastle = { K: false, Q: false, k: false, q: false };
    setMap(empty);
    setCastling(noCastle);
    setHalfmove(0);
    setFullmove(1);
    setBaseSnapshot(boardMapToFen(empty, sideToMove, noCastle, 0, 1));
    setRecordedMoves([]);
  };
  const resetBoard = () => {
    const allCastle = { K: true, Q: true, k: true, q: true };
    setMap(START_MAP);
    setSideToMove('w');
    setCastling(allCastle);
    setHalfmove(0);
    setFullmove(1);
    setBaseSnapshot(boardMapToFen(START_MAP, 'w', allCastle, 0, 1));
    setRecordedMoves([]);
  };

  const applyFenInput = () => {
    try {
      loadFen(fenInput.trim());
      setFenError(null);
    } catch {
      setFenError('Could not read that FEN.');
    }
  };

  const savePosition = () => {
    if (!posName.trim()) return;
    const id = uid();
    dispatch({ type: 'savePosition', id, name: posName.trim(), fen });
    setPosName('');
    setSaveOpen(false);
    setSelectedPosId(id); // land straight on the one just saved in the dropdown
  };

  const loadSaved = (id) => {
    setSelectedPosId(id);
    const p = (state.savedPositions ?? []).find((sp) => sp.id === id);
    if (p) loadFen(p.fen);
  };

  const deleteSaved = () => {
    if (!selectedPosId) return;
    dispatch({ type: 'deletePosition', id: selectedPosId });
    setSelectedPosId('');
  };

  return (
    // One shared drag-and-drop context for the board AND the spare-piece
    // tray below it — react-chessboard sets up its own internal DnD provider
    // per board by default, which would leave a SparePiece dragged from the
    // tray with nowhere connected to land. Wrapping both in the same
    // provider is what lets a drag start in the tray and end on a square.
    <ChessboardDnDProvider {...EDITOR_DND_PROPS}>
    <div className="board-editor">
      <div
        className="board-editor-board"
        style={{ width: boardWidth }}
        // Touch has no right button, so a press that stays still for half a
        // second names the square instead. Any movement cancels it — that's a
        // piece being dragged, not a question about the square.
        onPointerDown={onPressStart}
        onPointerMove={onPressMove}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onPointerLeave={endPress}
        // The right-click half. react-chessboard has an onSquareRightClick of
        // its own, but it only fires when its mousedown has re-rendered before
        // the mouseup arrives — press and release inside one frame and the
        // callback is silently skipped. contextmenu fires either way, and the
        // square under the pointer is a hit-test away, so this owes the
        // library nothing. It already preventDefaults on the square itself;
        // the event still bubbles here.
        onContextMenu={(e) => {
          const square = document.elementFromPoint(e.clientX, e.clientY)
            ?.closest?.('[data-square]')?.getAttribute('data-square');
          if (!square) return;
          e.preventDefault();
          flashSquare(square);
        }}
      >
        <Board
          id="board-editor"
          position={map}
          boardOrientation={orientation}
          onSquareClick={onSquareClick}
          onPieceDrop={onPieceDrop}
          onPieceDropOffBoard={onPieceDropOffBoard}
          onSparePieceDrop={onSparePieceDrop}
          dropOffBoardAction="trash"
          arePiecesDraggable
          // No such thing as a promotion here — a pawn dragged to the back
          // rank just sits there as a pawn until you swap it by hand.
          onPromotionCheck={() => false}
          // Placing a piece isn't a move — react-chessboard's own diffing
          // between position objects can misread two unrelated placements
          // (say, a king dropped on e1 right after one on e8) as one piece
          // sliding between them, animating a piece across the board that
          // was never actually there. Instant placement sidesteps that.
          animationDuration={0}
          // Setting a position up isn't analysis — no arrows to draw here, and
          // the overlay's pointer handling would only get in the way of
          // dragging pieces off the board.
          ownArrows={false}
          boardWidth={boardWidth}
        />
      </div>

      <div className="board-editor-panel">
        <div className="editor-palette">
          {['w', 'b'].map((color) => (
            <div key={color} className="editor-palette-row">
              {PALETTE.map((type) => {
                const code = `${color}${type}`;
                return (
                  <button
                    key={code}
                    className={`editor-piece${held === code ? ' active' : ''}`}
                    title={`${code} — click to hold and tap a square, or drag it straight onto the board`}
                    onClick={() => setHeld(held === code ? null : code)}
                  >
                    {/* SparePiece supplies the drag; the button around it still
                        supplies the click — a drag that never leaves the piece
                        doesn't fire the click, so tapping still just holds it. */}
                    <SparePiece piece={code} width={30} dndId="board-editor" customPieceJSX={pieces[code]} />
                  </button>
                );
              })}
            </div>
          ))}
          <button
            className={`editor-piece editor-erase${held === 'erase' ? ' active' : ''}`}
            title="Erase — tap a square to clear it"
            onClick={() => setHeld(held === 'erase' ? null : 'erase')}
          >
            ✕
          </button>
        </div>

        <div className="editor-row">
          <button className="small" onClick={clearBoard}>Clear board</button>
          <button className="small" onClick={resetBoard}>Starting position</button>
          <button className="small ghost" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
            <ShuffleIcon size={14} /> Flip
          </button>
        </div>

        <div className="editor-row">
          <span className="editor-label">To move</span>
          <button className={`small${sideToMove === 'w' ? ' primary' : ''}`} onClick={() => setSideToMove('w')}>White</button>
          <button className={`small${sideToMove === 'b' ? ' primary' : ''}`} onClick={() => setSideToMove('b')}>Black</button>
        </div>

        <div className="editor-row">
          <span className="editor-label">Castling</span>
          {[['K', 'O-O (White)'], ['Q', 'O-O-O (White)'], ['k', 'O-O (Black)'], ['q', 'O-O-O (Black)']].map(([key, label]) => (
            <label key={key} className="editor-check">
              <input
                type="checkbox"
                checked={castling[key]}
                onChange={(e) => setCastling((c) => ({ ...c, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>

        <div className="editor-presets">
          <span className="editor-label">Quick setups</span>
          <div className="editor-row">
            <button className="small ghost" onClick={() => loadFen(PRESETS.kingsideBoth.fen)}>Kingside castled</button>
            <button className="small ghost" onClick={() => loadFen(PRESETS.queensideBoth.fen)}>Queenside castled</button>
          </div>
          <div className="editor-row">
            <span className="muted-note">Opposite castling —</span>
            <select value={oppositeSide} onChange={(e) => setOppositeSide(e.target.value)}>
              <option value="wK">White kingside / Black queenside</option>
              <option value="wQ">White queenside / Black kingside</option>
            </select>
            <button
              className="small ghost"
              onClick={() => loadFen(oppositeSide === 'wK' ? PRESETS.oppositeWKbQ.fen : PRESETS.oppositeWQbK.fen)}
            >
              Load
            </button>
          </div>
        </div>

        <div className="editor-fen-row">
          <input
            type="text"
            placeholder={fen}
            value={fenInput}
            onChange={(e) => { setFenInput(e.target.value); setFenError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') applyFenInput(); }}
          />
          <button className="small" onClick={applyFenInput}>Set FEN</button>
        </div>
        {fenError && <span className="muted-note editor-fen-error">{fenError}</span>}

        <div className="editor-row">
          <button className="small" onClick={() => setSaveOpen((o) => !o)}>Save position…</button>
          {recordedMoves.length > 0 && (
            <span className="muted-note" title="Dragged as legal moves since the last setup action — these go to Analysis as a real, steppable line">
              {recordedMoves.length} move{recordedMoves.length === 1 ? '' : 's'} recorded
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button
            className="small primary"
            onClick={() => onSendToAnalysis({ baseFen: baseSnapshot, moves: recordedMoves })}
          >
            <MonitorIcon size={14} /> Send to analysis
          </button>
        </div>
        {saveOpen && (
          <div className="editor-row">
            <input
              type="text"
              placeholder="e.g. Rook endgame — 4 vs 3 same side"
              value={posName}
              onChange={(e) => setPosName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') savePosition(); }}
            />
            <button className="small primary" disabled={!posName.trim()} onClick={savePosition}>Save</button>
          </div>
        )}

        {(state.savedPositions ?? []).length > 0 && (
          <div className="editor-row">
            <span className="editor-label">Saved positions</span>
            <select value={selectedPosId} onChange={(e) => loadSaved(e.target.value)}>
              <option value="" disabled>Choose a saved position…</option>
              {state.savedPositions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button
              className="small ghost danger"
              disabled={!selectedPosId}
              title="Delete this saved position"
              onClick={deleteSaved}
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
    {/* Fixed to the viewport, not the board, so it lands in the middle of the
        screen wherever the board happens to sit — and keyed on the timestamp
        so asking for the same square twice replays the pop. */}
    {squareName && (
      <div className="square-flash" key={squareName.at} aria-live="polite">
        <span>{squareName.square}</span>
      </div>
    )}
    </ChessboardDnDProvider>
  );
}
