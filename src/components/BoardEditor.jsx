import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Chess } from 'chess.js';
import { ChessboardDnDProvider, SparePiece } from 'react-chessboard';
import { TouchBackend } from 'react-dnd-touch-backend';
import { useStore, uid } from '../store';
import Board from './Board';
import BoardArrows from './BoardArrows';
import {
  START_MAP, fenToBoardMap, fenMeta, boardMapToFen, PRESETS,
} from '../lib/boardEditor';
import { makePieces, DEFAULT_PIECE_LIGHT, DEFAULT_PIECE_DARK } from '../lib/pieces';
import { boardColors } from '../lib/theme';
import { shortcutMap, PENS, defaultPen } from '../lib/shortcuts';
import { pathFor } from '../lib/routes';
import { copyText } from '../lib/clipboard';
import {
  folderOf, folderNames, groupPositions, canMove,
} from '../lib/savedPositions';
import { useBackGuard } from '../lib/backGuard';
import MoreMenu from './MoreMenu';
import {
  MonitorIcon, ShuffleIcon, TargetIcon, PencilIcon, LinkIcon, FolderIcon,
} from './Icons';

const PALETTE = ['K', 'Q', 'R', 'B', 'N', 'P'];

// Arrows and highlighted squares drawn on the board being set up — the same
// shape Analysis keeps per position, so they go across to it as they are.
const EMPTY_MARKS = { arrows: [], squares: {} };
const marksOf = (p) => ({ arrows: p?.arrows ?? [], squares: p?.squares ?? {} });
const hasAnyMarks = (m) => m.arrows.length > 0 || Object.keys(m.squares).length > 0;
const sameMarks = (a, b) => JSON.stringify(a.arrows) === JSON.stringify(b.arrows)
  && JSON.stringify(a.squares) === JSON.stringify(b.squares);

const squareFromPoint = (x, y) => document.elementFromPoint(x, y)
  ?.closest?.('[data-square]')?.getAttribute('data-square') ?? null;

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
// `positionId` is a saved position asked for by the address
// (/analysis/editor/<id>): it's set up here, marks and all, as soon as it's
// in the store — which may be a moment after a cold start, while sync is
// still bringing the list in. `onPositionChange` reports which saved position
// the board is standing on, so the address keeps up and can be copied.
export default function BoardEditor({
  onSendToAnalysis, boardWidth, positionId = null, onPositionChange,
}) {
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
  const [selectedPosId, setSelectedPosId] = useState(positionId ?? '');
  const [oppositeSide, setOppositeSide] = useState('wK'); // which colour goes kingside, for the opposite-castling preset
  const [linkCopied, setLinkCopied] = useState(false);
  // Which folder Save files into ('' for none), and the "+ New folder" box.
  const [saveFolder, setSaveFolder] = useState('');
  const [newFolder, setNewFolder] = useState(null); // null, or the name being typed
  const lastFolder = useRef(''); // the folder last saved into, offered first next time
  const [folderPickOpen, setFolderPickOpen] = useState(false);
  useBackGuard(folderPickOpen, () => setFolderPickOpen(false));

  // What the board is for right now. In Squares mode a right-click or a
  // long-press names the square (the help you want while setting up from a
  // diagram); in Draw mode the same gestures draw instead — the two couldn't
  // share the board, so the switch beside it picks one. Pieces don't drag in
  // Draw mode: there the board is a canvas, as in Analysis.
  const [boardMode, setBoardMode] = useState('squares'); // 'squares' | 'draw'
  const [marks, setMarks] = useState(EMPTY_MARKS);
  const [drawColor, setDrawColor] = useState(() => defaultPen(state.settings).value);
  const [drawFrom, setDrawFrom] = useState(null); // the square a draw-drag started on
  const drawing = boardMode === 'draw';
  const hasMarks = hasAnyMarks(marks);

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
  // board. Two seconds, fading in and out; the timeout has to match the CSS
  // animation or the element would sit there invisible, or vanish mid-fade.
  // `at` is only there to restart the animation when the same square is asked
  // for twice in a row: same text, new element, so it replays.
  const [squareName, setSquareName] = useState(null); // { square, at }
  const flashTimer = useRef(null);
  const flashSquare = (square) => {
    if (!square) return;
    clearTimeout(flashTimer.current);
    setSquareName({ square, at: Date.now() });
    flashTimer.current = setTimeout(() => setSquareName(null), 2000);
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

  // A whole new position: the pieces, and whatever was drawn on it (nothing,
  // for a preset or a pasted FEN — the marks belonged to the old set-up).
  const loadFen = (f, nextMarks = EMPTY_MARKS) => {
    setMap(fenToBoardMap(f));
    const meta = fenMeta(f);
    setSideToMove(meta.sideToMove);
    setCastling(meta.castling);
    setHalfmove(meta.halfmove);
    setFullmove(meta.fullmove);
    setBaseSnapshot(f);
    setRecordedMoves([]);
    setMarks(nextMarks);
    setDrawFrom(null);
  };
  // A preset, a pasted FEN, Clear or Starting position: the board is no
  // longer the saved position it may have been showing, so the address and
  // the Update button stop pointing at it.
  const loadFresh = (f) => { setSelectedPosId(''); loadFen(f); };

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
    setMarks(EMPTY_MARKS);
    setSelectedPosId('');
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
    setMarks(EMPTY_MARKS);
    setSelectedPosId('');
  };

  const applyFenInput = () => {
    try {
      loadFresh(fenInput.trim());
      setFenError(null);
    } catch {
      setFenError('Could not read that FEN.');
    }
  };

  // ---------- Drawing ----------
  // Press a square and drag to another for an arrow; release on the same
  // square to highlight it. The same again takes it away; another colour on
  // the same squares recolours it. Pointer-driven rather than click-driven,
  // because a drag never fires a click — and on touch the pointer's target
  // stays where the finger went down, so the square under it at release has
  // to be found by position.
  const isDrawButton = (e) => e.pointerType !== 'mouse' || e.button === 0 || e.button === 2;
  const onDrawPointerDown = (e) => {
    if (!e.isPrimary || !isDrawButton(e)) return;
    const square = squareFromPoint(e.clientX, e.clientY);
    if (!square) return;
    e.preventDefault();
    setDrawFrom(square);
  };
  const onDrawPointerUp = (e) => {
    if (!drawFrom || !e.isPrimary || !isDrawButton(e)) return;
    const square = squareFromPoint(e.clientX, e.clientY);
    if (square) {
      if (square === drawFrom) toggleSquare(square);
      else addArrow(drawFrom, square);
    }
    setDrawFrom(null);
  };
  const addArrow = (from, to) => setMarks((m) => ({
    ...m,
    arrows: m.arrows.some((a) => a[0] === from && a[1] === to && a[2] === drawColor)
      ? m.arrows.filter((a) => !(a[0] === from && a[1] === to))
      : [...m.arrows.filter((a) => !(a[0] === from && a[1] === to)), [from, to, drawColor]],
  }));
  const toggleSquare = (square) => setMarks((m) => {
    const squares = { ...m.squares };
    if (squares[square] === drawColor) delete squares[square];
    else squares[square] = drawColor;
    return { ...m, squares };
  });
  const clearMarks = () => { setMarks(EMPTY_MARKS); setDrawFrom(null); };

  const squareStyles = useMemo(() => {
    const styles = {};
    for (const [sq, color] of Object.entries(marks.squares)) {
      styles[sq] = { background: `${color}66`, boxShadow: `inset 0 0 0 3px ${color}` };
    }
    if (drawFrom) styles[drawFrom] = { background: `${drawColor}88` };
    return styles;
  }, [marks.squares, drawFrom, drawColor]);

  // ---------- Saved positions ----------
  const savedPositions = state.savedPositions ?? [];
  const selectedPos = savedPositions.find((sp) => sp.id === selectedPosId) ?? null;
  // The board has moved on from the saved copy — pieces or marks — so there's
  // something for Update to write back.
  const savedDirty = !!selectedPos
    && (selectedPos.fen !== fen || !sameMarks(marksOf(selectedPos), marks));

  const folders = folderNames(savedPositions);
  const groups = groupPositions(savedPositions);

  // Opening the Save box offers the folder you're working in: the open
  // position's, or else the one last saved into.
  const openSave = () => {
    if (!saveOpen) {
      setSaveFolder(selectedPos ? folderOf(selectedPos) : lastFolder.current);
      setNewFolder(null);
    }
    setSaveOpen((o) => !o);
  };

  const savePosition = () => {
    if (!posName.trim()) return;
    const id = uid();
    const folder = (newFolder ?? '').trim() || saveFolder;
    dispatch({
      type: 'savePosition',
      id,
      name: posName.trim(),
      fen,
      arrows: marks.arrows,
      squares: marks.squares,
      folder,
    });
    lastFolder.current = folder;
    setPosName('');
    setNewFolder(null);
    setSaveOpen(false);
    setSelectedPosId(id); // land straight on the one just saved in the dropdown
  };

  // ---------- The ⋯ menu on the open position ----------
  const renameSaved = () => {
    if (!selectedPos) return;
    const name = window.prompt('Rename this position', selectedPos.name);
    if (name && name.trim()) dispatch({ type: 'renamePosition', id: selectedPos.id, name });
  };
  const fileInto = (folder) => {
    setFolderPickOpen(false);
    if (!selectedPos) return;
    dispatch({ type: 'setPositionFolder', id: selectedPos.id, folder });
    if (folder) lastFolder.current = folder;
  };
  const fileIntoNew = () => {
    const name = window.prompt('New folder name');
    if (name && name.trim()) fileInto(name.trim());
  };
  const renameFolderOfSaved = () => {
    const from = folderOf(selectedPos);
    if (!from) return;
    const to = window.prompt(`Rename the folder “${from}”`, from);
    if (to && to.trim() && to.trim() !== from) {
      dispatch({ type: 'renamePositionFolder', from, to });
      if (lastFolder.current === from) lastFolder.current = to.trim();
    }
  };

  const updateSaved = () => {
    if (!selectedPos) return;
    dispatch({
      type: 'updatePosition', id: selectedPos.id, fen, arrows: marks.arrows, squares: marks.squares,
    });
  };

  const loadSaved = (id) => {
    setSelectedPosId(id);
    const p = savedPositions.find((sp) => sp.id === id);
    if (p) loadFen(p.fen, marksOf(p));
  };

  const deleteSaved = () => {
    if (!selectedPos) return;
    if (!window.confirm(`Delete “${selectedPos.name}”? Links to it will stop working.`)) return;
    dispatch({ type: 'deletePosition', id: selectedPos.id });
    setSelectedPosId('');
  };

  // The address asked for a saved position: set it up once it's here. A
  // different id arriving later (Back, or a second link) sets that one up.
  const appliedPosId = useRef(null);
  useEffect(() => {
    if (!positionId || appliedPosId.current === positionId) return;
    const p = savedPositions.find((sp) => sp.id === positionId);
    if (!p) return; // not in the store yet — sync may still be bringing it
    appliedPosId.current = positionId;
    setSelectedPosId(positionId);
    loadFen(p.fen, marksOf(p));
  }, [positionId, savedPositions]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onPositionChange?.(selectedPosId || null); }, [selectedPosId]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyLink = async () => {
    if (!selectedPos) return;
    const url = `${window.location.origin}${pathFor({ view: 'analysis', sub: 'editor', position: selectedPos.id })}`;
    const ok = await copyText(url);
    if (!ok) { window.prompt('Copy this link:', url); return; }
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1800);
  };

  const savedMenu = selectedPos ? [
    { label: 'Rename', icon: <PencilIcon size={16} />, onClick: renameSaved },
    {
      label: 'Move to folder',
      icon: <FolderIcon size={16} />,
      hint: folderOf(selectedPos) || 'No folder',
      onClick: () => setFolderPickOpen(true),
    },
    {
      label: 'Move up',
      icon: <span aria-hidden="true">↑</span>,
      disabled: !canMove(savedPositions, selectedPos.id, -1),
      onClick: () => dispatch({ type: 'movePosition', id: selectedPos.id, dir: -1 }),
    },
    {
      label: 'Move down',
      icon: <span aria-hidden="true">↓</span>,
      disabled: !canMove(savedPositions, selectedPos.id, 1),
      onClick: () => dispatch({ type: 'movePosition', id: selectedPos.id, dir: 1 }),
    },
    folderOf(selectedPos) && {
      label: `Rename folder “${folderOf(selectedPos)}”`,
      icon: <PencilIcon size={16} />,
      onClick: renameFolderOfSaved,
    },
    { sep: true },
    { label: 'Copy link', icon: <LinkIcon size={16} />, onClick: copyLink },
    { sep: true },
    {
      label: 'Delete position', icon: <span aria-hidden="true">✕</span>, danger: true, onClick: deleteSaved,
    },
  ] : [];

  return (
    // One shared drag-and-drop context for the board AND the spare-piece
    // tray below it — react-chessboard sets up its own internal DnD provider
    // per board by default, which would leave a SparePiece dragged from the
    // tray with nowhere connected to land. Wrapping both in the same
    // provider is what lets a drag start in the tray and end on a square.
    <ChessboardDnDProvider {...EDITOR_DND_PROPS}>
    <div className="board-editor">
      <div className="board-editor-stage">
        {/* The switch between what a press on the board means. Beside the
            board rather than in the panel, so it's in reach of the hand
            that's about to draw. */}
        <div className="editor-modes" role="group" aria-label="Board mode">
          <button
            type="button"
            className={`editor-mode${!drawing ? ' active' : ''}`}
            aria-pressed={!drawing}
            title="Squares: right-click or hold a square to see its name"
            onClick={() => { setBoardMode('squares'); setDrawFrom(null); }}
          >
            <TargetIcon size={18} />
            <span>Squares</span>
          </button>
          <button
            type="button"
            className={`editor-mode${drawing ? ' active' : ''}`}
            aria-pressed={drawing}
            title="Draw: drag from one square to another for an arrow, or tap a square to highlight it"
            onClick={() => setBoardMode('draw')}
          >
            <PencilIcon size={18} />
            <span>Draw</span>
          </button>
          {drawing && (
            <div className="editor-pens" role="group" aria-label="Pen colour">
              {PENS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`pen${drawColor === p.value ? ' active' : ''}`}
                  style={{ background: p.value }}
                  title={p.name}
                  aria-label={`${p.name} pen`}
                  onClick={() => setDrawColor(p.value)}
                />
              ))}
            </div>
          )}
          {hasMarks && (
            <button
              type="button"
              className="editor-mode editor-clear"
              title="Clear every arrow and highlight"
              onClick={clearMarks}
            >
              <span aria-hidden="true">✕</span>
              <span>Clear</span>
            </button>
          )}
        </div>
      <div
        className={`board-editor-board${drawing ? ' drawing' : ''}`}
        // In Draw mode the finger is a pen: the page mustn't scroll under it.
        style={{ width: boardWidth, touchAction: drawing ? 'none' : undefined }}
        // Squares mode — touch has no right button, so a press that stays
        // still for half a second names the square instead. Any movement
        // cancels it — that's a piece being dragged, not a question about the
        // square. Draw mode — the press is the start of an arrow.
        onPointerDown={drawing ? onDrawPointerDown : onPressStart}
        onPointerMove={drawing ? undefined : onPressMove}
        onPointerUp={drawing ? onDrawPointerUp : endPress}
        onPointerCancel={drawing ? () => setDrawFrom(null) : endPress}
        onPointerLeave={drawing ? () => setDrawFrom(null) : endPress}
        // The right-click half. react-chessboard has an onSquareRightClick of
        // its own, but it only fires when its mousedown has re-rendered before
        // the mouseup arrives — press and release inside one frame and the
        // callback is silently skipped. contextmenu fires either way, and the
        // square under the pointer is a hit-test away, so this owes the
        // library nothing. It already preventDefaults on the square itself;
        // the event still bubbles here. In Draw mode the right button draws
        // (see onDrawPointerDown), so the menu is simply kept away.
        onContextMenu={(e) => {
          const square = squareFromPoint(e.clientX, e.clientY);
          if (!square) return;
          e.preventDefault();
          if (!drawing) flashSquare(square);
        }}
      >
        <Board
          id="board-editor"
          position={map}
          boardOrientation={orientation}
          onSquareClick={drawing ? undefined : onSquareClick}
          onPieceDrop={onPieceDrop}
          onPieceDropOffBoard={onPieceDropOffBoard}
          onSparePieceDrop={onSparePieceDrop}
          dropOffBoardAction="trash"
          arePiecesDraggable={!drawing}
          customSquareStyles={squareStyles}
          // No such thing as a promotion here — a pawn dragged to the back
          // rank just sits there as a pawn until you swap it by hand.
          onPromotionCheck={() => false}
          // Placing a piece isn't a move — react-chessboard's own diffing
          // between position objects can misread two unrelated placements
          // (say, a king dropped on e1 right after one on e8) as one piece
          // sliding between them, animating a piece across the board that
          // was never actually there. Instant placement sidesteps that.
          animationDuration={0}
          // This board runs its own pen (the Draw mode beside it) — Board's
          // right-drag arrows would fight the square-name gesture, and its
          // overlay's pointer handling would get in the way of dragging
          // pieces off the board.
          ownArrows={false}
          boardWidth={boardWidth}
        />
        <BoardArrows arrows={marks.arrows} boardWidth={boardWidth} orientation={orientation} />
      </div>
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
            <button className="small ghost" onClick={() => loadFresh(PRESETS.pawnRace.fen)}>Pawn race</button>
            <button className="small ghost" onClick={() => loadFresh(PRESETS.kingsideBoth.fen)}>Kingside castled</button>
            <button className="small ghost" onClick={() => loadFresh(PRESETS.queensideBoth.fen)}>Queenside castled</button>
          </div>
          <div className="editor-row">
            <span className="muted-note">Opposite castling —</span>
            <select value={oppositeSide} onChange={(e) => setOppositeSide(e.target.value)}>
              <option value="wK">White kingside / Black queenside</option>
              <option value="wQ">White queenside / Black kingside</option>
            </select>
            <button
              className="small ghost"
              onClick={() => loadFresh(oppositeSide === 'wK' ? PRESETS.oppositeWKbQ.fen : PRESETS.oppositeWQbK.fen)}
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
          <button className="small" onClick={openSave}>Save position…</button>
          {recordedMoves.length > 0 && (
            <span className="muted-note" title="Dragged as legal moves since the last setup action — these go to Analysis as a real, steppable line">
              {recordedMoves.length} move{recordedMoves.length === 1 ? '' : 's'} recorded
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button
            className="small primary"
            // The marks belong to the board as it stands — after any recorded
            // moves — so they travel with that position's FEN, not the base.
            onClick={() => onSendToAnalysis({
              baseFen: baseSnapshot, moves: recordedMoves, marks, marksFen: fen,
            })}
          >
            <MonitorIcon size={14} /> Send to analysis
          </button>
        </div>
        {saveOpen && (
          <div className="editor-save">
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
            <div className="editor-folder-chips" role="radiogroup" aria-label="Folder">
              <span className="editor-label">Folder</span>
              {folders.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={newFolder === null && saveFolder === f}
                  className={`folder-chip${newFolder === null && saveFolder === f ? ' on' : ''}`}
                  onClick={() => { setSaveFolder(f); setNewFolder(null); }}
                >
                  {f}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={newFolder === null && !saveFolder}
                className={`folder-chip${newFolder === null && !saveFolder ? ' on' : ''}`}
                onClick={() => { setSaveFolder(''); setNewFolder(null); }}
              >
                No folder
              </button>
              {newFolder === null ? (
                <button type="button" className="folder-chip new" onClick={() => setNewFolder('')}>
                  + New folder
                </button>
              ) : (
                <input
                  type="text"
                  className="folder-chip-input"
                  placeholder="New folder name"
                  autoFocus
                  value={newFolder}
                  onChange={(e) => setNewFolder(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') savePosition();
                    if (e.key === 'Escape') setNewFolder(null);
                  }}
                />
              )}
            </div>
          </div>
        )}

        {savedPositions.length > 0 && (
          <div className="editor-row editor-saved-row">
            <span className="editor-label">Saved positions</span>
            {/* Folders are headings inside the dropdown — still one tap to
                any position, on a phone's own picker as much as a Mac's. With
                no folders yet it's the plain list it always was. */}
            <select value={selectedPosId} onChange={(e) => loadSaved(e.target.value)}>
              <option value="" disabled>Choose a saved position…</option>
              {folders.length === 0
                ? savedPositions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)
                : groups.map((g) => (
                  <optgroup key={g.folder || '(unfiled)'} label={g.folder || 'No folder'}>
                    {g.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                ))}
            </select>
            {savedDirty && (
              <button
                className="small primary"
                title="Save the board as it is now — pieces, arrows and highlights — to this saved position"
                onClick={updateSaved}
              >
                Update
              </button>
            )}
            {/* Everything else about the open position lives behind this —
                rename, folders, order, its link, delete — so the editor's own
                row stays the dropdown and nothing more. */}
            {selectedPos && <MoreMenu items={savedMenu} title={selectedPos.name} label="Saved position actions" />}
            {linkCopied && <span className="muted-note editor-copied" aria-live="polite">Link copied</span>}
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
    {/* Move to folder: the same bottom sheet as the ⋯ menu it comes from. */}
    {folderPickOpen && selectedPos && createPortal(
      <div className="sheet-scrim" onClick={() => setFolderPickOpen(false)}>
        <div className="sheet" role="menu" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-grip" aria-hidden="true" />
          <div className="sheet-title">Move “{selectedPos.name}” to…</div>
          <div className="sheet-rows">
            {folders.map((f) => (
              <button key={f} type="button" role="menuitem" className="sheet-row" onClick={() => fileInto(f)}>
                <span className="sheet-icon"><FolderIcon size={16} /></span>
                <span className="sheet-label">{f}</span>
                {folderOf(selectedPos) === f && <span className="sheet-check" aria-label="current">✓</span>}
              </button>
            ))}
            <button type="button" role="menuitem" className="sheet-row" onClick={() => fileInto('')}>
              <span className="sheet-icon" />
              <span className="sheet-label">No folder</span>
              {!folderOf(selectedPos) && <span className="sheet-check" aria-label="current">✓</span>}
            </button>
            <div className="sheet-sep" role="separator" />
            <button type="button" role="menuitem" className="sheet-row" onClick={fileIntoNew}>
              <span className="sheet-icon">+</span>
              <span className="sheet-label">New folder…</span>
            </button>
          </div>
          <button type="button" className="sheet-cancel" onClick={() => setFolderPickOpen(false)}>Cancel</button>
        </div>
      </div>,
      document.body,
    )}
    </ChessboardDnDProvider>
  );
}
