import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board from '../components/Board';
import { useStore } from '../store';
import { Engine, formatScore } from '../lib/engine';
import { fetchExplorer, explorerTotals, pct } from '../lib/explorer';
import MoveText from '../components/MoveText';
import { useViewportWidth } from '../components/useViewportWidth';
import BoardArrows from '../components/BoardArrows';
import CompareView from './CompareView';
import GameEditor from '../components/GameEditor';
import EvalBar from '../components/EvalBar';
import { playMoveSound } from '../lib/sound';
import {
  EVENT_TYPES, resultFor, tidyEvent, matchPlayerByName,
} from '../lib/games';
import { buildPositionIndex, bookMovesAt, matchGameToRepertoire, moveLabel } from '../lib/repertoire';
import LegalDots from '../components/LegalDots';
import { lastMoveOf } from '../lib/legalMoves';
import MoveTree from '../components/MoveTree';
import {
  makeTree, lineThrough, nodePath, addMove, promote, promoteOne, removeNode,
  keepMainLineOnly, hasVariations,
} from '../lib/moveTree';
import {
  BookIcon, PencilIcon, AlertIcon, PlayIcon, SkipStartIcon, SkipEndIcon, DownloadIcon, GearIcon,
} from '../components/Icons';
import {
  PENS, SHORTCUTS, defaultPen, shortcutKey, shortcutMap, isComboKey, comboMatchesEvent, formatShortcutKey,
} from '../lib/shortcuts';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const EMPTY_MARKS = { arrows: [], squares: {} };

// Best move, second, third — three hues rather than three blues, so a glance at
// the board tells you which arrow is which line. Read on light and dark squares.
const ARROW_COLORS = [
  'rgba(56, 176, 120, 0.92)', // green — the engine's first choice
  'rgba(59, 132, 235, 0.85)', // blue
  'rgba(226, 142, 46, 0.85)', // amber
];

export default function AnalysisView({ initialLine }) {
  const { state, dispatch } = useStore();
  const [mode, setMode] = useState('engine'); // 'engine' | 'compare'
  const [baseFen, setBaseFen] = useState(START_FEN);
  // The game is a tree: playing something else from an earlier move keeps what
  // came after as a variation. `head` is the move the board is sitting on.
  const [tree, setTree] = useState(() => makeTree(initialLine?.moves ?? []));
  const [head, setHead] = useState('root'); // loaded lines open at the start
  const [orientation, setOrientation] = useState('white');
  // The engine runs from the moment the board opens unless you've turned that
  // off — arrows and the eval bar are Stockfish's, so nothing to draw until it
  // is thinking.
  const [engineOn, setEngineOn] = useState(state.settings.engineAuto !== false);
  const [engineLines, setEngineLines] = useState({});
  const [engineStatus, setEngineStatus] = useState('off');
  const [db, setDb] = useState('lichess');
  const [explorer, setExplorer] = useState(null);
  const [explorerError, setExplorerError] = useState(null);
  const [fenInput, setFenInput] = useState('');
  const engineRef = useRef(null);
  const viewportWidth = useViewportWidth();

  // ---------- Board annotations (arrows + square highlights) ----------
  // Kept per position, so stepping back and forth keeps each position's marks.
  const [annotations, setAnnotations] = useState({});
  // The active pen — what a touch drag draws in, and a mouse drag falls back
  // to when no pen key (below) is held. Starts at, and resets to, whatever
  // Settings → default pen colour says; the swatches can still change it
  // in between for a touch user, who has no key to hold.
  const [drawColor, setDrawColor] = useState(() => defaultPen(state.settings).value);
  useEffect(() => {
    setDrawColor(defaultPen(state.settings).value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings.defaultPen]);
  const [drawMode, setDrawMode] = useState(false);
  const [drawFrom, setDrawFrom] = useState(null);
  const [picked, setPicked] = useState(null); // click-to-move: the piece you tapped
  const [saving, setSaving] = useState(false); // "save to Games" dialog
  const [sidePane, setSidePane] = useState('engine'); // engine | explorer

  // Board options, shared with the Settings tab.
  const showEvalBar = state.settings.evalBar !== false;
  const showEngineLines = state.settings.engineLines !== false;
  const showEngineArrows = state.settings.engineArrows !== false;
  // Each candidate can be drawn or left off on its own — some people only want
  // the best move on the board.
  const arrowOn = [
    state.settings.arrowBest !== false,
    state.settings.arrowSecond !== false,
    state.settings.arrowThird !== false,
  ];
  const soundOn = state.settings.soundEnabled !== false;
  const [boardMenu, setBoardMenu] = useState(false); // the board's own settings

  useEffect(() => {
    if (initialLine) {
      setBaseFen(START_FEN);
      setTree(makeTree(initialLine.moves));
      setHead('root');
    }
  }, [initialLine]);

  // The line on the board: how you reached this move, then how it carries on.
  const lineNodes = useMemo(() => lineThrough(tree, head), [tree, head]);
  const moves = useMemo(() => lineNodes.map((n) => n.san), [lineNodes]);
  const ply = useMemo(() => nodePath(tree, head).length, [tree, head]);
  // Step to a point on the current line by its ply number.
  const setPly = (value) => {
    const n = typeof value === 'function' ? value(ply) : value;
    const clamped = Math.max(0, Math.min(moves.length, n));
    setHead(clamped === 0 ? 'root' : lineNodes[clamped - 1].id);
  };

  const game = useMemo(() => {
    const c = new Chess(baseFen);
    for (let i = 0; i < ply; i += 1) c.move(moves[i]);
    return c;
  }, [baseFen, moves, ply]);
  const fen = game.fen();
  const fenRef = useRef(fen); // read by the engine listener, which is set up once
  fenRef.current = fen;

  // Keyboard, roughly what chess.com and Lichess use — the letter/digit keys
  // below are rebindable from Settings → Keyboard; lib/shortcuts.js holds the
  // defaults and current bindings.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const keyMap = useMemo(() => shortcutMap(state.settings), [state.settings.shortcuts]);
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const settings = (patch) => dispatch({ type: 'setSettings', settings: patch });
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); setPly(ply - 1); return;
        case 'ArrowRight': e.preventDefault(); setPly(ply + 1); return;
        case 'ArrowUp': e.preventDefault(); setPly(0); return;
        case 'ArrowDown': e.preventDefault(); setPly(moves.length); return;
        case 'Home': e.preventDefault(); setPly(0); return;
        case 'End': e.preventDefault(); setPly(moves.length); return;
        case '?': setShortcutsOpen((o) => !o); return;
        case 'Escape': setShortcutsOpen(false); return;
        default: break;
      }
      // Pen keys aren't here — they're held during a drag (see currentPenColor
      // above), not pressed once to fire an action.
      switch (keyMap[e.key.toLowerCase()]) {
        case 'flipBoard': setOrientation((o) => (o === 'white' ? 'black' : 'white')); break;
        case 'toggleEngine': setEngineOn((v) => !v); break;
        case 'toggleArrows': settings({ engineArrows: !showEngineArrows }); break;
        case 'toggleLines': settings({ engineLines: !showEngineLines }); break;
        case 'toggleEvalBar': settings({ evalBar: !showEvalBar }); break;
        case 'toggleCheckHighlight': settings({ checkHighlight: state.settings.checkHighlight === false }); break;
        case 'toggleDrawMode': setDrawMode((d) => !d); break;
        case 'switchExplorer': setSidePane((p) => (p === 'engine' ? 'explorer' : 'engine')); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves.length, ply, lineNodes, showEngineArrows, showEngineLines, showEvalBar, keyMap]);

  // ---------- Repertoire awareness ----------

  // A student's game (ownerId set when it was sent here — see PlayerRoster's
  // onAnalyze) checks against their own book, not yours.
  const repertoireOwnerId = initialLine?.ownerId ?? null;
  const repertoireOwner = repertoireOwnerId
    ? state.players.find((p) => p.id === repertoireOwnerId)
    : null;
  const positionIndex = useMemo(
    () => buildPositionIndex(
      state.openings.filter((o) => (o.ownerId ?? null) === repertoireOwnerId),
    ),
    [state.openings, repertoireOwnerId],
  );
  const fromStart = baseFen === START_FEN;

  // Which of your uploaded lines does this game follow, and where did it leave book?
  const gameMatch = useMemo(
    () => (fromStart && moves.length ? matchGameToRepertoire(moves, positionIndex) : { matched: false }),
    [fromStart, moves, positionIndex],
  );

  // Your repertoire's move(s) in the position currently on the board. Turning
  // book moves off leaves the engine to judge a game on its own merits.
  const useBook = state.settings.bookMoves !== false;
  const bookHere = useMemo(
    () => (fromStart && useBook ? bookMovesAt(positionIndex, fen) : []),
    [fromStart, useBook, positionIndex, fen],
  );

  // ---------- Engine ----------

  useEffect(() => {
    if (!engineOn) {
      engineRef.current?.stop();
      setEngineStatus('off');
      return undefined;
    }
    if (!engineRef.current) {
      engineRef.current = new Engine();
      engineRef.current.onInfo((info) => {
        // A search that was already running when you moved on still reports for
        // a few hundred milliseconds — those lines belong to the old position.
        if (info.fen !== fenRef.current) return;
        setEngineLines((lines) => ({ ...lines, [info.multipv]: info }));
        setEngineStatus('running');
      });
    }
    setEngineLines({});
    setEngineStatus('starting');
    engineRef.current.analyze(fen);
    return undefined;
  }, [fen, engineOn]);

  useEffect(() => () => { engineRef.current?.quit(); engineRef.current = null; }, []);

  // ---------- Lichess explorer ----------

  useEffect(() => {
    setExplorer(null);
    setExplorerError(null);
    const t = setTimeout(async () => {
      try {
        const data = await fetchExplorer(fen, db, state.settings.lichessToken);
        setExplorer(data);
      } catch (err) {
        setExplorerError(String(err.message || err));
      }
    }, 450);
    return () => clearTimeout(t);
  }, [fen, db]);

  // ---------- Annotations ----------

  const marks = annotations[fen] ?? EMPTY_MARKS;

  const updateMarks = (fn) => setAnnotations((all) => {
    const next = fn(all[fen] ?? EMPTY_MARKS);
    return { ...all, [fen]: next };
  });

  const addArrow = (from, to, color = drawColor) => updateMarks((m) => ({
    ...m,
    // Drawing the same arrow twice removes it, like Lichess.
    arrows: m.arrows.some((a) => a[0] === from && a[1] === to && a[2] === color)
      ? m.arrows.filter((a) => !(a[0] === from && a[1] === to))
      : [...m.arrows.filter((a) => !(a[0] === from && a[1] === to)), [from, to, color]],
  }));

  // Which pen keys (see lib/shortcuts.js) are currently held down, checked
  // at the end of a drag rather than a single keydown — so holding one
  // colours just that one arrow without touching any persistent selection.
  // Tracked independently of the action shortcuts below: pen keys are meant
  // to be held through a drag, not fired once.
  const heldKeysRef = useRef(new Set());
  useEffect(() => {
    const isTypingTarget = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
    const onKeyDown = (e) => { if (!isTypingTarget(e)) heldKeysRef.current.add(e.key.toLowerCase()); };
    const onKeyUp = (e) => heldKeysRef.current.delete(e.key.toLowerCase());
    const onBlur = () => heldKeysRef.current.clear(); // a held key surviving a tab-switch would get stuck "on"
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // The colour a drag ending right now would use: whichever pen's key is
  // held, or the pen picked as the default (Settings → default pen colour,
  // and the pen swatches below) if none is. A pen's binding is either a
  // plain letter (checked against what's been held via keydown/up above) or
  // a pure modifier chord like ⌥ or ⌃⌥ — those are read straight off the
  // release event's own altKey/ctrlKey/etc, which the browser already
  // tracks accurately, rather than through our own key-tracking.
  const currentPenColor = (e) => {
    for (const pen of PENS) {
      const key = shortcutKey(state.settings, pen.shortcutId);
      if (!key) continue;
      if (isComboKey(key)) {
        if (e && comboMatchesEvent(key, e)) return pen.value;
      } else if (heldKeysRef.current.has(key)) {
        return pen.value;
      }
    }
    return drawColor;
  };

  // Right-click drag on a mouse: press on the origin square, release on the
  // target. Arrows are owned entirely here, because react-chessboard clears
  // its own whenever the controlled `customArrows` prop changes.
  const rightFrom = useRef(null);
  const squareAt = (e) => e.target?.closest?.('[data-square]')?.getAttribute('data-square') ?? null;

  const onMouseDown = (e) => {
    if (e.button !== 2) return;
    rightFrom.current = squareAt(e);
  };

  const onMouseUp = (e) => {
    // A plain left click on the board wipes this position's marks.
    if (e.button === 0) {
      if (hasMarks && !drawMode) clearMarks();
      return;
    }
    if (e.button !== 2) return;
    const from = rightFrom.current;
    const to = squareAt(e);
    rightFrom.current = null;
    if (!from || !to) return;
    const color = currentPenColor(e);
    if (from === to) toggleSquare(from, color);
    else addArrow(from, to, color);
  };

  // Draw mode (mouse, trackpad or touch — needed on iPad, which has no
  // right-click): press a square and drag to another for an arrow, release
  // without moving for a highlight. This has to be pointer-driven rather than
  // built on `click`/`onSquareClick`, because a native click only fires when
  // press and release land on the same element — a real drag (what everyone
  // reaches for first, on a mouse or a finger) would otherwise fire nothing
  // and silently do nothing, which is the "sometimes the arrow just doesn't
  // come out" behaviour. Touch also implicitly locks a pointer's `target` to
  // wherever the gesture started, so the square under the finger at release
  // has to be found with elementFromPoint, not e.target.
  const squareFromPoint = (x, y) => document.elementFromPoint(x, y)
    ?.closest?.('[data-square]')?.getAttribute('data-square') ?? null;

  // Right-click still runs its own always-on handler above (with the same
  // held-pen-key trick), so a mouse's right button is excluded here to avoid
  // both systems firing on one drag.
  const isDrawButton = (e) => e.pointerType !== 'mouse' || e.button === 0;

  const onDrawPointerDown = (e) => {
    if (!drawMode || !e.isPrimary || !isDrawButton(e)) return;
    const square = squareFromPoint(e.clientX, e.clientY);
    if (!square) return;
    e.preventDefault();
    setDrawFrom(square);
  };

  const onDrawPointerUp = (e) => {
    if (!drawMode || !e.isPrimary || !drawFrom || !isDrawButton(e)) return;
    const square = squareFromPoint(e.clientX, e.clientY);
    if (square) {
      const color = currentPenColor(e);
      if (square === drawFrom) toggleSquare(square, color);
      else addArrow(drawFrom, square, color);
    }
    setDrawFrom(null);
  };

  const toggleSquare = (square, color = drawColor) => updateMarks((m) => {
    const squares = { ...m.squares };
    if (squares[square] === color) delete squares[square];
    else squares[square] = color;
    return { ...m, squares };
  });

  const clearMarks = () => setAnnotations((all) => {
    const next = { ...all };
    delete next[fen];
    return next;
  });

  const hasMarks = marks.arrows.length > 0 || Object.keys(marks.squares).length > 0;
  const markedCount = Object.keys(annotations).filter((k) => {
    const m = annotations[k];
    return m.arrows.length > 0 || Object.keys(m.squares).length > 0;
  }).length;

  const position = useMemo(() => {
    try { return new Chess(fen); } catch { return null; }
  }, [fen]);

  const showLegal = state.settings.showLegalMoves !== false;
  // The move that produced this position, marked on the board.
  const lastMove = useMemo(
    () => lastMoveOf(Chess, moves, ply, baseFen),
    [moves, ply, baseFen],
  );

  // The piece sounds you get in practice, here too: play a move or step through
  // the game and it clicks.
  const prevPlyRef = useRef(0);
  useEffect(() => {
    const prev = prevPlyRef.current;
    prevPlyRef.current = ply;
    if (!soundOn || ply === prev || ply === 0) return;
    const san = moves[ply - 1];
    if (san) playMoveSound(san);
  }, [ply, soundOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the move you're on in view: a long game scrolls itself as you step
  // through instead of leaving you looking at move 9 of 41.
  const moveListRef = useRef(null);
  useEffect(() => {
    const box = moveListRef.current;
    if (!box) return;
    const el = box.querySelector('.mt-move.current');
    // scrollTo rather than assigning scrollTop: the engine re-renders this list
    // several times a second, which cancels an in-flight scroll.
    if (!el) { if (ply === 0) box.scrollTo({ top: 0, behavior: 'instant' }); return; }
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    const view = box.clientHeight;
    if (top < box.scrollTop || bottom > box.scrollTop + view) {
      // Centre it, so you can see what came before and what's coming.
      box.scrollTo({ top: Math.max(0, top - (view - el.offsetHeight) / 2), behavior: 'instant' });
    }
  }, [ply, moves.length]);

  // Stockfish's top moves as arrows. One colour each, matching the dot beside
  // the line in the panel, so three candidates don't read as one suggestion.
  const engineArrows = useMemo(() => {
    if (!engineOn || !showEngineArrows || !position) return [];
    const out = [];
    [1, 2, 3].forEach((n, i) => {
      if (!arrowOn[i]) return;
      const san = engineLines[n]?.sans?.[0];
      if (!san) return;
      try {
        const clone = new Chess(position.fen());
        const mv = clone.move(san);
        if (mv) out.push([mv.from, mv.to, ARROW_COLORS[i]]);
      } catch { /* the line may lag a move behind the board */ }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineOn, showEngineArrows, engineLines, position, arrowOn[0], arrowOn[1], arrowOn[2]]);

  // Highlighted squares are drawn as translucent overlays; a picked piece also
  // shows every square it can legally reach.
  const squareStyles = useMemo(() => {
    const styles = {};
    if (picked) styles[picked] = { background: 'rgba(59, 156, 255, 0.5)' };
    for (const [sq, color] of Object.entries(marks.squares)) {
      styles[sq] = { background: `${color}66`, boxShadow: `inset 0 0 0 3px ${color}` };
    }
    if (drawFrom) styles[drawFrom] = { background: `${drawColor}88` };
    return styles;
  }, [marks.squares, drawFrom, drawColor, picked, position, showLegal]);

  // ---------- Moves ----------

  // Every move goes into the tree. Playing something new from an earlier point
  // starts a variation there; replaying a move that's already recorded simply
  // follows it.
  const record = (san) => {
    const { tree: next, nodeId } = addMove(tree, head, san);
    setTree(next);
    setHead(nodeId);
  };

  const playSan = (san) => {
    const clone = new Chess(fen);
    let mv = null;
    try { mv = clone.move(san); } catch { mv = null; }
    if (!mv) return;
    record(mv.san);
  };

  const onPieceDrop = (from, to) => {
    if (drawMode) return false; // in draw mode the board is a canvas, not a game
    const clone = new Chess(fen);
    let mv = null;
    try { mv = clone.move({ from, to, promotion: 'q' }); } catch { mv = null; }
    if (!mv) return false;
    record(mv.san);
    setPicked(null);
    return true;
  };

  const onSquareClick = (square) => {
    if (drawMode) return; // press-and-drag owns drawing now, see onDrawPointer* below
    // Click-to-move, so a trackpad or a finger can play without dragging.
    if (picked) {
      const played = onPieceDrop(picked, square);
      setPicked(played ? null : (position?.get(square) ? square : null));
      return;
    }
    const piece = position?.get(square);
    if (piece && piece.color === position.turn()) setPicked(square);
  };

  // Loading anything new replaces the tree and opens at move 1.
  const loadMoves = (sans) => {
    setTree(makeTree(sans));
    setHead('root');
  };

  const loadFen = () => {
    try {
      const c = new Chess(fenInput.trim());
      setBaseFen(c.fen());
      loadMoves([]);
    } catch {
      setExplorerError('Invalid FEN');
    }
  };

  // Used by Compare's "Analyze" buttons — hand a line straight to the engine.
  const loadLine = (variation, color) => {
    setBaseFen(START_FEN);
    loadMoves(variation.moves);
    if (color) setOrientation(color);
  };

  const loadVariation = (value) => {
    if (!value) return;
    const [oid, cid, vid] = value.split('|');
    const opening = state.openings.find((o) => o.id === oid);
    const chapter = opening?.chapters.find((c) => c.id === cid);
    const variation = chapter?.variations.find((v) => v.id === vid);
    if (variation) {
      setBaseFen(START_FEN);
      loadMoves(variation.moves);
      setOrientation(opening.color);
    }
  };

  // Keep the engine and explorer beside the board whenever they fit: the board
  // takes what's left after the side panel, instead of being sized from the
  // window and pushing the panel onto its own row.
  const BOARD_MAX = 760; // a wide screen gets a big board, but not a scroll
  // Three side-by-side columns need real width; below that the engine and moves
  // share one column, and below that everything stacks under the board.
  // An iPad in landscape has room for all three columns if the middle and right
  // ones are kept narrow — better than a tall right-hand column you have to
  // scroll to reach the repertoire card.
  // 1040 catches every iPad in landscape (1080, 1112, 1133, 1180, 1194).
  const wide = viewportWidth >= 1040;
  const tight = wide && viewportWidth < 1380; // three columns, iPad-sized
  const layoutClass = sideFitsFor(viewportWidth, wide);
  // The grid decides the split (see .analysis-layout); we just read how wide the
  // board's column ended up. That survives the scrollbar appearing or vanishing,
  // which never fires a resize event and used to leave the board mis-sized.
  const [colEl, setColEl] = useState(null);
  const [colW, setColW] = useState(0);
  useEffect(() => {
    if (!colEl || typeof ResizeObserver === 'undefined') return undefined;
    const read = (w) => { if (w > 200) setColW(w); };
    // Debounced past react-chessboard's ~300ms move animation: the scrollbar
    // flickering in or out as the engine panel repaints right after a move
    // used to resize the board mid-slide, stranding the piece between
    // squares — its animation was computed for the old square size, and the
    // new one landed under it before that slide finished.
    let pending = null;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      clearTimeout(pending);
      pending = setTimeout(() => read(w), 350);
    });
    ro.observe(colEl);
    read(colEl.getBoundingClientRect().width); // the initial measurement can land immediately
    return () => { clearTimeout(pending); ro.disconnect(); };
  }, [colEl]);

  // Stacking is a coarse decision, so a stray 15px can't flip it.
  const sideFits = viewportWidth >= 900;
  // eslint-disable-next-line no-inner-declarations
  function sideFitsFor(w, isWide) {
    if (w < 900) return 'stacked';
    return isWide ? 'three-col' : 'two-col';
  }
  // Keep the whole board on screen: the header, annotation bar and controls need
  // room too, so cap by height as well as width.
  // Header, the annotation bar, the hint line and the step controls all live
  // under the board — leave them room so the whole thing fits without scrolling.
  const winH = typeof window === 'undefined' ? 900 : window.innerHeight;
  // A little more room reserved on a tablet, where the whole thing — board,
  // controls and the FEN box — is meant to land on one screen.
  const heightCap = Math.max(320, winH - (tight ? 330 : 290));
  // The page itself is the last word. A fixed-width board inside its column can
  // otherwise widen that column and keep itself wide — on a phone that reads as
  // a board hanging off the side of the screen.
  // Whole squares only — a fractional square size leaves the last file and rank
  // looking a hair wider than the others.
  const boardWidth = Math.floor(
    Math.max(280, Math.min(BOARD_MAX, colW || 520, heightCap, viewportWidth - 26)) / 8,
  ) * 8;
  const totals = explorer ? explorer.white + explorer.draws + explorer.black : 0;

  if (mode === 'compare') {
    return (
      <div className="page wide">
        <div className="page-head">
          <h1>Analysis</h1>
          <div className="mode-tabs">
            <button onClick={() => setMode('engine')}>Engine</button>
            <button className="active">Compare lines</button>
          </div>
        </div>
        <CompareView onAnalyze={(v) => { setMode('engine'); loadLine(v); }} />
      </div>
    );
  }

  return (
    <div className={`page wide${tight ? ' tight-page' : ''}`}>
      <div className="page-head">
        <h1>Analysis</h1>
        <div className="mode-tabs">
          <button className="active">Engine</button>
          <button
            title="Put two similar lines side by side and see exactly where they part"
            onClick={() => setMode('compare')}
          >
            Compare lines
          </button>
        </div>
        <button
          title="Keep this position's game in your Games tab"
          disabled={moves.length === 0}
          onClick={() => setSaving(true)}
        >
          <DownloadIcon size={15} /> Save to Games
        </button>
        <select
          className="line-picker"
          defaultValue=""
          onChange={(e) => { loadVariation(e.target.value); e.target.value = ''; }}
        >
          <option value="" disabled>Load a repertoire line…</option>
          {state.openings.map((o) =>
            o.chapters.map((c) =>
              c.variations.map((v) => (
                <option key={v.id} value={`${o.id}|${c.id}|${v.id}`}>
                  {o.name} / {c.name} / {v.name}
                </option>
              ))))}
        </select>
      </div>

      <div
        className={`analysis-layout ${layoutClass}${tight ? ' tight' : ''}`}
        // The side columns take their height from the board, so everything
        // beside it stays beside it.
        style={{ '--board-h': `${boardWidth + 86}px` }}
      >
        <div
          ref={setColEl}
          className="analysis-board"
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onPointerDown={onDrawPointerDown}
          onPointerUp={onDrawPointerUp}
          onPointerCancel={() => setDrawFrom(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="board-with-eval">
          {showEvalBar && (
            <EvalBar
              score={engineLines[1]?.score}
              height={boardWidth}
              running={engineOn && engineStatus === 'running'}
            />
          )}
          <div
            style={{
              position: 'relative', width: boardWidth, height: boardWidth,
              // Otherwise a finger dragging to draw an arrow reads as a page
              // scroll on a touchscreen, which cancels the gesture partway.
              touchAction: drawMode ? 'none' : undefined,
            }}
          >
          <Board
            id="analysis"
            position={fen}
            onPieceDrop={onPieceDrop}
            onSquareClick={onSquareClick}
            onPieceDragBegin={(piece, square) => setPicked(square)}
            onPieceDragEnd={() => setPicked(null)}
            arePiecesDraggable={!drawMode}
            areArrowsAllowed={false}
            customSquareStyles={squareStyles}
            lastMove={lastMove}
            boardOrientation={orientation}
            boardWidth={boardWidth}
          />
          <BoardArrows
            arrows={[...engineArrows, ...marks.arrows]}
            boardWidth={boardWidth}
            orientation={orientation}
          />
          {/* Drawn above the arrows: an engine arrow crossing a dot used to
              make it look like two dots on one square. */}
          {showLegal && (
            <LegalDots
              game={position}
              square={picked}
              boardWidth={boardWidth}
              orientation={orientation}
            />
          )}
          </div>
          </div>

          <div className="annotate-bar" style={{ maxWidth: boardWidth }}>
            <span className="board-menu-wrap">
              <button
                className={`small${boardMenu ? ' primary' : ''}`}
                title="Board options"
                onClick={() => setBoardMenu((o) => !o)}
              >
                <GearIcon size={15} />
              </button>
              {boardMenu && (() => {
                const toggle = (key) => (e) => dispatch({
                  type: 'setSettings', settings: { [key]: e.target.checked },
                });
                const row = ([key, label, on, dot]) => (
                  <label key={key} className={`board-menu-row${on ? ' on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={toggle(key)} />
                    {dot && <span className="pv-dot" style={{ background: dot }} />}
                    {label}
                  </label>
                );
                return (
                  <div className="board-menu" onMouseLeave={() => setBoardMenu(false)}>
                    {[
                      ['evalBar', 'Evaluation bar', state.settings.evalBar !== false],
                      ['engineLines', 'Engine lines', showEngineLines],
                      ['engineArrows', 'Engine arrows', showEngineArrows],
                    ].map(row)}
                    {/* Which of the three candidates get drawn. */}
                    <div className={`board-menu-group${showEngineArrows ? '' : ' off'}`}>
                      {[
                        ['arrowBest', 'Best move', arrowOn[0], ARROW_COLORS[0]],
                        ['arrowSecond', '2nd best', arrowOn[1], ARROW_COLORS[1]],
                        ['arrowThird', '3rd best', arrowOn[2], ARROW_COLORS[2]],
                      ].map(row)}
                    </div>
                    {[
                      ['bookMoves', 'Repertoire book moves', useBook],
                      ['engineAuto', 'Engine on when the board opens', state.settings.engineAuto !== false],
                      ['soundEnabled', 'Move sounds', soundOn],
                    ].map(row)}
                  </div>
                );
              })()}
            </span>
            <button
              className={`small${drawMode ? ' primary' : ''}`}
              title={drawMode
                ? 'Drawing: press a square and drag to another for an arrow, or release without moving to highlight it'
                : 'Draw arrows and highlights (also: right-click drag on a mouse)'}
              onClick={() => { setDrawMode((d) => !d); setDrawFrom(null); }}
            >
              <PencilIcon size={15} /> {drawMode ? 'Drawing' : 'Draw'}
            </button>
            <span className="pens">
              {PENS.map((p) => (
                <button
                  key={p.value}
                  className={`pen${drawColor === p.value ? ' active' : ''}`}
                  style={{ background: p.value }}
                  title={p.id === (state.settings.defaultPen ?? 'green')
                    ? `${p.name} (default)`
                    : `${p.name} (hold ${formatShortcutKey(shortcutKey(state.settings, p.shortcutId))} while dragging)`}
                  onClick={() => setDrawColor(p.value)}
                />
              ))}
            </span>
            <span style={{ flex: 1 }} />
            {markedCount > 1 && (
              <span className="muted-note">{markedCount} positions marked</span>
            )}
            <button className="small ghost" disabled={!hasMarks} onClick={clearMarks}>
              Clear
            </button>
          </div>
          {/* On a tablet the two-line reminder is what pushes the controls off
              the screen, and there's no right-click there anyway. */}
          <div className="muted-note draw-hint" style={{ maxWidth: boardWidth }}>
            {tight ? (
              <>Press <strong>Draw</strong>, then drag a square to mark up the board · left-click to clear</>
            ) : (
              <>
                Right-click drag to draw in <strong>{defaultPen(state.settings).name.toLowerCase()}</strong> (the
                default, set in Settings) · hold {PENS.filter((p) => p.id !== (state.settings.defaultPen ?? 'green')).map((p) => (
                  <React.Fragment key={p.id}><kbd>{formatShortcutKey(shortcutKey(state.settings, p.shortcutId))}</kbd> </React.Fragment>
                ))}while dragging for {PENS.filter((p) => p.id !== (state.settings.defaultPen ?? 'green')).map((p) => p.name.toLowerCase()).join(' / ')} ·
                left-click the board to clear
              </>
            )}
          </div>

          <div className="viewer-controls">
            <button title="Start" onClick={() => setPly(0)}><SkipStartIcon size={16} /></button>
            <button onClick={() => setPly((p) => Math.max(0, p - 1))}>◀</button>
            <button onClick={() => setPly((p) => Math.min(moves.length, p + 1))}>▶</button>
            <button title="End" onClick={() => setPly(moves.length)}><SkipEndIcon size={16} /></button>
            <button onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>⇅ Flip</button>
            <button onClick={() => { setBaseFen(START_FEN); loadMoves([]); }}>Reset</button>
          </div>
          <div className="fen-row">
            <input
              type="text"
              placeholder={fen}
              value={fenInput}
              onChange={(e) => setFenInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') loadFen(); }}
            />
            <button onClick={loadFen} disabled={!fenInput.trim()}>Set FEN</button>
          </div>
        </div>

        <div className="analysis-engine">
          {(initialLine?.meta || initialLine?.subtitle) && moves.length > 0 && (
            <AnalysedGame line={initialLine} />
          )}
          {fromStart && moves.length > 0 && (
            <div className={`panel book-panel-summary${gameMatch.matched ? '' : ' unmatched'}`}>
              <h3><BookIcon size={16} /> {repertoireOwner ? `${repertoireOwner.name}'s repertoire` : 'Your repertoire'}</h3>
              {gameMatch.matched ? (
                <>
                  <div className="book-match">
                    <strong>{gameMatch.opening.name}</strong> — {gameMatch.variation.name}
                    <span className="depth-tag"> ({gameMatch.chapter.name})</span>
                  </div>
                  <div className="sub" style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 4 }}>
                    {gameMatch.exhausted
                      ? `The whole game follows this line (${gameMatch.depth} moves).`
                      : `Followed for ${gameMatch.depth} move${gameMatch.depth === 1 ? '' : 's'}.`}
                  </div>
                  {gameMatch.deviation && (
                    <div
                      className="deviation-note"
                      onClick={() => setPly(gameMatch.deviation.atPly)}
                      title="Jump to the position before this move"
                    >
                      <AlertIcon size={13} className="warn-tick" /> Left book at{' '}
                      <strong>{moveLabel(gameMatch.deviation.atPly)}{gameMatch.deviation.played}</strong>
                      {' '}— repertoire plays{' '}
                      <strong>{gameMatch.deviation.expected.join(' or ')}</strong>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                  This game doesn't match any uploaded opening — pure engine analysis below.
                </div>
              )}
            </div>
          )}

          <div className="panel side-tabs-panel">
            <div className="side-tabs">
              <button
                className={sidePane === 'engine' ? 'active' : ''}
                onClick={() => setSidePane('engine')}
              >
                Engine
              </button>
              <button
                className={sidePane === 'explorer' ? 'active' : ''}
                onClick={() => setSidePane('explorer')}
              >
                Explorer
              </button>
            </div>

          {sidePane === 'engine' && (
          <div>
            <h3>
              {bookHere.length > 0 ? <><BookIcon size={13} /> Book move</> : 'Stockfish 16'}
              {engineStatus === 'running' && engineLines[1] && (
                <span className="depth-tag">depth {engineLines[1].depth}</span>
              )}
              <span className="spacer" />
              <button className="small" onClick={() => setEngineOn((v) => !v)}>
                {engineOn ? 'Stop' : <><PlayIcon size={14} /> Analyze</>}
              </button>
            </h3>
            {bookHere.map((b) => (
              <div key={b.san} className="engine-line book-line" onClick={() => playSan(b.san)}>
                <span className="eval book-eval">book</span>
                <span className="pv">
                  <strong>{b.san}</strong>
                  <span style={{ color: 'var(--muted)' }}> — {b.opening.name}: {b.variation.name}</span>
                </span>
              </div>
            ))}
            {bookHere.length > 0 && (
              <div className="muted-note" style={{ margin: '2px 0 10px' }}>
                From your uploaded openings. Engine lines below.
              </div>
            )}
            {!engineOn && (
              <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                Engine is off — press Analyze for the lines, the arrows on the board and the
                evaluation bar.
              </div>
            )}
            {engineOn && !showEngineArrows && (
              <div className="muted-note" style={{ margin: '2px 0 10px' }}>
                Arrows are off.{' '}
                <button
                  className="linkish"
                  onClick={() => dispatch({ type: 'setSettings', settings: { engineArrows: true } })}
                >
                  Show them on the board
                </button>
              </div>
            )}
            {engineOn && engineStatus === 'starting' && (
              <div style={{ color: 'var(--muted)', fontSize: 14 }}>Starting engine…</div>
            )}
            {engineOn && !showEngineLines && (
              <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                Lines are hidden — the bar beside the board still follows the evaluation.
              </div>
            )}
            {engineOn && showEngineLines && [1, 2, 3].map((n) => {
              const line = engineLines[n];
              if (!line) return null;
              const good = line.score.type === 'mate' ? line.score.value > 0 : line.score.value >= 0;
              return (
                <div key={n} className="engine-line" onClick={() => line.sans[0] && playSan(line.sans[0])}>
                  {showEngineArrows && (
                    <span
                      className="pv-dot"
                      style={{ background: ARROW_COLORS[n - 1] }}
                      title={`Drawn on the board in this colour${n === 1 ? ' — the engine’s first choice' : ''}`}
                    />
                  )}
                  <span className={`eval ${good ? 'white-good' : 'black-good'}`}>{formatScore(line.score)}</span>
                  <span className="pv">{line.sans.join(' ')}</span>
                </div>
              );
            })}
          </div>
          )}

          {sidePane === 'explorer' && (
          <div>
            <h3>
              Opening explorer
              <span className="spacer" />
              <select value={db} onChange={(e) => setDb(e.target.value)}>
                <option value="lichess">Lichess players</option>
                <option value="masters">Masters</option>
              </select>
            </h3>
            {explorerError && <div style={{ color: 'var(--muted)', fontSize: 14 }}><AlertIcon size={13} /> {explorerError}</div>}
            {!explorer && !explorerError && <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</div>}
            {explorer && explorer.moves.length === 0 && (
              <div style={{ color: 'var(--muted)', fontSize: 14 }}>No games from this position.</div>
            )}
            {explorer && explorer.moves.length > 0 && (
              <table className="explorer-table">
                <thead>
                  <tr><th>Move</th><th>Games</th><th>%</th><th>White / Draw / Black</th></tr>
                </thead>
                <tbody>
                  {explorer.moves.map((m) => {
                    const total = explorerTotals(m);
                    return (
                      <tr key={m.uci} onClick={() => playSan(m.san)}>
                        <td>{m.san}</td>
                        <td>{total.toLocaleString()}</td>
                        <td>{pct(total, totals)}</td>
                        <td>
                          <div className="wdl-bar">
                            <span className="w" style={{ width: pct(m.white, total) }}>{pct(m.white, total)}</span>
                            <span className="d" style={{ width: pct(m.draws, total) }} />
                            <span className="b" style={{ width: pct(m.black, total) }}>{pct(m.black, total)}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          )}
          </div>
        </div>

        <div className="analysis-moves-col">
          {moves.length > 0 && (
            <div className="panel analysis-movelist-panel">
              <div className="movelist-head">
                <span>Moves</span>
                <span className="muted-note">
                  {ply === 0 ? 'start' : `${Math.floor((ply - 1) / 2) + 1}${(ply - 1) % 2 === 0 ? '.' : '…'}${moves[ply - 1]}`}
                  {' · '}{ply} of {moves.length}
                </span>
                <span style={{ flex: 1 }} />
                {hasVariations(tree) && (
                  <button
                    className="small ghost"
                    title="Delete every variation, keeping the main line"
                    onClick={() => { setTree(keepMainLineOnly(tree)); setHead('root'); }}
                  >
                    Clear variations
                  </button>
                )}
              </div>
              <div
                className="movelist-scroll"
                ref={moveListRef}
                style={layoutClass === 'stacked' ? undefined : {
                  // In two columns the moves share the height with the engine
                  // below them; in three they get the board's full height.
                  maxHeight: layoutClass === 'two-col'
                    ? Math.max(150, (boardWidth + 86) * 0.44 - 52)
                    : Math.max(200, boardWidth - 44),
                }}
              >
                <MoveTree
                  root={tree}
                  headId={head}
                  onGo={setHead}
                  onPromote={(id) => setTree(promote(tree, id))}
                  onPromoteOne={(id) => setTree(promoteOne(tree, id))}
                  onDelete={(id) => {
                    // Standing on the move you're deleting: step back first.
                    if (nodePath(tree, id).some((n) => n.id === head)) {
                      const trail = nodePath(tree, id);
                      setHead(trail.length > 1 ? trail[trail.length - 2].id : 'root');
                    }
                    setTree(removeNode(tree, id));
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {shortcutsOpen && (
        <div className="modal-overlay" onClick={() => setShortcutsOpen(false)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <h3>Keyboard shortcuts</h3>
            <div className="shortcut-grid">
              <React.Fragment><kbd>← →</kbd><span>Step back and forward</span></React.Fragment>
              <React.Fragment><kbd>↑ ↓</kbd><span>Jump to the start / the end</span></React.Fragment>
              {SHORTCUTS.map((s) => (
                <React.Fragment key={s.id}>
                  <kbd>{formatShortcutKey(shortcutKey(state.settings, s.id))}</kbd>
                  <span>{s.label}</span>
                </React.Fragment>
              ))}
              <React.Fragment><kbd>?</kbd><span>This list</span></React.Fragment>
            </div>
            <p className="hint">
              Right-click a move in the list to promote a variation or delete it. Change any key
              above in Settings → Keyboard.
            </p>
            <div className="modal-actions">
              <button className="primary" onClick={() => setShortcutsOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {saving && (
        <SaveToGames
          moves={moves.slice(0, ply)}
          meta={initialLine?.meta ?? null}
          state={state}
          dispatch={dispatch}
          onClose={() => setSaving(false)}
        />
      )}
    </div>
  );
}

// What's on the board: the players, result and where it came from, so the
// analysis isn't just an anonymous position.
function AnalysedGame({ line }) {
  const m = line.meta ?? {};
  const res = m.result && m.result !== '*' ? resultFor({ meta: m }) : null;
  const site = EVENT_TYPES.find((t) => t.value === m.eventType)?.label;
  const bits = [
    line.date ? new Date(line.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null,
    site,
    tidyEvent(m.event, m.eventType),
    m.round ? `round ${m.round}` : null,
    m.timeControl,
    m.color && m.color !== 'none' ? `you had ${m.color}` : null,
  ].filter(Boolean);

  return (
    <div className="panel analysed-game">
      {m.white || m.black ? (
        <div className="game-header">
          <span className="gh-side">
            <span className="gh-disc white" />
            <span className={`gh-player${m.color === 'white' ? ' mine' : ''}`}>
              <strong>{m.white || '—'}</strong>
              {m.whiteElo ? <span className="gh-elo">{m.whiteElo}</span> : null}
            </span>
          </span>
          <span className={`gh-result ${res?.kind ?? ''}`}>{m.result && m.result !== '*' ? m.result : '·'}</span>
          <span className="gh-side">
            <span className="gh-disc black" />
            <span className={`gh-player${m.color === 'black' ? ' mine' : ''}`}>
              <strong>{m.black || '—'}</strong>
              {m.blackElo ? <span className="gh-elo">{m.blackElo}</span> : null}
            </span>
          </span>
        </div>
      ) : (
        <h3 style={{ margin: 0 }}>{line.name}</h3>
      )}
      {bits.length > 0 && <div className="game-meta-row">{bits.join(' · ')}</div>}
      {line.subtitle && (
        <div className="cat-chip repertoire" style={{ alignSelf: 'flex-start' }}>{line.subtitle}</div>
      )}
      {m.notes && <div className="comment-box">{m.notes}</div>}
    </div>
  );
}

// Pick which section the game belongs to, then hand it to the game editor
// pre-filled with the moves on the board.
function SaveToGames({ moves, meta, state, dispatch, onClose }) {
  // A best-effort guess from the loaded game's White/Black, always changeable
  // below — falls back to the first section when nothing matches.
  const guess = matchPlayerByName(meta?.white, state.players)
    ?? matchPlayerByName(meta?.black, state.players);
  const [playerId, setPlayerId] = useState(guess?.id ?? state.players[0]?.id ?? '');
  const [editing, setEditing] = useState(false);

  if (state.players.length === 0) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>Save to Games</h3>
          <p className="hint">
            Games live in sections — one for you, one per student. Add a section first.
          </p>
          <div className="modal-actions">
            <button onClick={onClose}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                const name = window.prompt('Section name (e.g. "My games"):', 'My games');
                if (name?.trim()) dispatch({ type: 'addPlayer', name: name.trim() });
              }}
            >
              + Add section
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <GameEditor
        initial={{ moves, meta: {} }}
        state={state}
        onClose={onClose}
        onSave={(game) => {
          dispatch({ type: 'addGame', playerId, game });
          onClose();
        }}
      />
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Save to Games</h3>
        <p className="hint">{moves.length} moves from the board. Whose game is it?</p>
        <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
          {state.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!playerId} onClick={() => setEditing(true)}>
            Add the details
          </button>
        </div>
      </div>
    </div>
  );
}
