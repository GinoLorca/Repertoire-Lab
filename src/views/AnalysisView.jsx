import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import Board from '../components/Board';
import { useStore, uid } from '../store';
import { Engine, formatScore } from '../lib/engine';
import { runGameReview } from '../lib/gameReview';
import { fetchExplorer, explorerTotals, pct } from '../lib/explorer';
import MoveText from '../components/MoveText';
import { useViewportWidth } from '../components/useViewportWidth';
import BoardArrows from '../components/BoardArrows';
import CompareView from './CompareView';
import GameEditor from '../components/GameEditor';
import EvalBar from '../components/EvalBar';
import MaterialBar from '../components/MaterialBar';
import { materialDiff } from '../lib/material';
import { playMoveSound } from '../lib/sound';
import {
  EVENT_TYPES, resultFor, tidyEvent, matchPlayerByName,
} from '../lib/games';
import { buildPositionIndex, bookMovesAt, matchGameToRepertoire, moveLabel } from '../lib/repertoire';
import LegalDots from '../components/LegalDots';
import PromotionPicker from '../components/PromotionPicker';
import BoardEditor from '../components/BoardEditor';
import GameFlagPicker from '../components/GameFlagPicker';
import { lastMoveOf, NOTE_HIGHLIGHT_STYLE } from '../lib/legalMoves';
import { useBackGuard } from '../lib/backGuard';
import { parseStudyUrl, fetchStudyPgn } from '../lib/lichess';
import { pgnTextToEntries } from '../lib/pgnImport';
import { BADGES } from '../lib/badges';
import MoveBadge from '../components/MoveBadge';
import MoveTree from '../components/MoveTree';
import MoveNote from '../components/MoveNote';
import {
  makeTree, lineThrough, nodePath, addMove, promote, promoteOne, removeNode,
  keepMainLineOnly, hasVariations, mainLineFrom, branchRootOf, lastMainLineAncestor, alternativesAt,
} from '../lib/moveTree';
import {
  BookIcon, PencilIcon, AlertIcon, PlayIcon, SkipStartIcon, SkipEndIcon, DownloadIcon, GearIcon,
  FlaskIcon, CommentIcon, TargetIcon, UploadIcon, CheckIcon,
} from '../components/Icons';
import {
  PENS, SHORTCUTS, defaultPen, shortcutKey, shortcutMap, isComboKey, comboMatchesEvent, formatShortcutKey,
  eventKey,
} from '../lib/shortcuts';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const EMPTY_MARKS = { arrows: [], squares: {} };

// A flag on `window` itself, not a module-level variable and not component
// state: it needs to survive anything short of an actual navigation. A plain
// `let` up here looked right but isn't — Vite's dev-mode Fast Refresh
// re-executes a changed module's top-level code to hot-swap it, which resets
// a module-level variable back to its initial value with no reload at all,
// so mid-session edits kept quietly re-arming "resume" while testing. window
// is the one thing that's actually scoped to "this tab hasn't navigated
// since the last real load" — HMR replaces module code without touching it,
// and only a genuine navigation gets a fresh one.
const RESUME_FLAG = '__rlAnalysisDraftResumed';

// iOS silently reloading a backgrounded/discarded tab and a person
// deliberately hitting refresh both land here as a brand-new JS context —
// RESUME_FLAG alone can't tell them apart. The Navigation Timing entry can:
// an explicit reload (pull-to-refresh, the browser's reload button,
// location.reload()) is reported as type 'reload'; the OS quietly re-fetching
// a tab it discarded under memory pressure comes back as an ordinary
// 'navigate', the same as opening the app fresh. Only the former should
// throw the draft away.
function wasExplicitReload() {
  try {
    const [nav] = performance.getEntriesByType('navigation');
    if (nav) return nav.type === 'reload';
    // eslint-disable-next-line deprecation/deprecation
    return performance.navigation?.type === 1;
  } catch {
    return false;
  }
}

// Best move, second, third — three hues rather than three blues, so a glance at
// the board tells you which arrow is which line. Read on light and dark squares.
const ARROW_COLORS = [
  'rgba(56, 176, 120, 0.92)', // green — the engine's first choice
  'rgba(59, 132, 235, 0.85)', // blue
  'rgba(226, 142, 46, 0.85)', // amber
];

export default function AnalysisView({ initialLine, initialLab, coachMode, mode: routeMode, onModeChange }) {
  const { state, dispatch } = useStore();
  // Nothing explicit was asked for — a blank "Analysis" open or a Coaches
  // Corner Studio session — so whatever was still on the board last time
  // wins. This is what survives a backgrounded tab: iOS can and does reload
  // an inactive tab or home-screen app from scratch under memory pressure,
  // which would otherwise wipe every move just played with nothing saved.
  const draft = (!initialLine && !initialLab && !window[RESUME_FLAG] && !wasExplicitReload())
    ? (state.analysisDraft ?? null) : null;
  window[RESUME_FLAG] = true;
  // Seeded from the URL (/analysis/editor opens the editor) and reported back
  // as it changes, so the address keeps up. Still local state: this view
  // switches modes in a dozen places and none of them should have to know
  // about routing.
  const [mode, setMode] = useState(routeMode ?? 'engine'); // 'engine' | 'compare' | 'editor'
  useEffect(() => { onModeChange?.(mode === 'engine' ? null : mode); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  // Back/forward moves the URL without touching this view, so follow it.
  useEffect(() => {
    const wanted = routeMode ?? 'engine';
    if (wanted !== mode) setMode(wanted);
  }, [routeMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const [baseFen, setBaseFen] = useState(draft?.baseFen ?? initialLab?.baseFen ?? START_FEN);
  // The game is a tree: playing something else from an earlier move keeps what
  // came after as a variation. `head` is the move the board is sitting on.
  // initialLine?.tree: a game Studio previously ran "Save changes" on keeps
  // its explored variations this way — see setGameTree in store.jsx. Without
  // it, a game only ever has its flat played-moves trunk to rebuild from.
  const [tree, setTree] = useState(() => (
    draft?.tree ?? initialLab?.tree ?? initialLine?.tree
    ?? makeTree(initialLab?.moves ?? initialLine?.moves ?? [])));
  const [head, setHead] = useState(draft?.head ?? 'root'); // loaded lines open at the start
  const [orientation, setOrientation] = useState(draft?.orientation ?? 'white');
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
  // Lab notebook. `labId` is set once this session has been saved, so Save
  // updates that entry instead of quietly making a second copy of it.
  const [labId, setLabId] = useState(draft?.labId ?? initialLab?.id ?? null);
  const [labTitle, setLabTitle] = useState(draft?.labTitle ?? initialLab?.title ?? '');
  const [labNote, setLabNote] = useState(draft?.labNote ?? initialLab?.note ?? '');
  const [saveLineOpen, setSaveLineOpen] = useState(false);
  // Coach's Corner: a badge and a note on the specific move currently
  // selected, keyed by its node id rather than a ply number — a tree has
  // branches, and a ply number alone can't tell two of them apart.
  const [moveBadges, setMoveBadges] = useState(() => draft?.moveBadges ?? initialLab?.moveBadges ?? {});
  const [moveNotes, setMoveNotes] = useState(() => draft?.moveNotes ?? initialLab?.moveNotes ?? {});
  // A colour on a whole variation, not one move — "this line was the one
  // that should've been played", marked green/blue/yellow for a top-three
  // ranking. Keyed by the branch's own root id (see branchRootOf), so
  // wherever within it the board or a click actually points, the colour
  // always resolves to the same row.
  const [variationHighlights, setVariationHighlights] = useState(
    () => draft?.variationHighlights ?? initialLab?.variationHighlights ?? initialLine?.variationHighlights ?? {},
  );
  const [moveNoteDraft, setMoveNoteDraft] = useState('');
  const [studyUrl, setStudyUrl] = useState('');
  const [studyBusy, setStudyBusy] = useState(false);
  const [studyError, setStudyError] = useState(null);
  const [studyGames, setStudyGames] = useState(null); // entries from a fetched study, to pick a chapter from
  const [pgnText, setPgnText] = useState(''); // pasted PGN/movetext, loaded straight onto the board
  const [pgnOpen, setPgnOpen] = useState(false);
  const [saveVarOpen, setSaveVarOpen] = useState(false);
  const engineRef = useRef(null);
  const viewportWidth = useViewportWidth();

  // ---------- Board annotations (arrows + square highlights) ----------
  // Kept per position, so stepping back and forth keeps each position's marks.
  const [annotations, setAnnotations] = useState(
    () => draft?.annotations ?? initialLab?.annotations ?? initialLine?.annotations ?? {},
  );
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
  // A square glowed because a move reference in a note was clicked — see
  // MoveNote.jsx. `key` forces the CSS animation to restart even when the
  // same square is clicked again before the last glow finished fading.
  const [noteHighlight, setNoteHighlight] = useState(null); // { square, key }
  useEffect(() => {
    if (!noteHighlight) return undefined;
    const t = setTimeout(() => setNoteHighlight(null), 1100);
    return () => clearTimeout(t);
  }, [noteHighlight]);
  const highlightNoteSquare = (square) => setNoteHighlight({ square, key: Date.now() });
  const [pendingPromotion, setPendingPromotion] = useState(null); // {from, to, color} awaiting a piece choice
  const [saving, setSaving] = useState(false); // "save to Games" dialog
  // Game Review: a full engine pass over the loaded game, badging every move
  // the way a coach would by hand — see runReview below.
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewProgress, setReviewProgress] = useState(null); // {done, total}
  const [reviewResult, setReviewResult] = useState(null); // {accuracy: {white, black}}
  const [sidePane, setSidePane] = useState(coachMode ? 'annotate' : 'engine'); // engine | explorer | annotate

  // The saved game this board is showing, if any — initialLine is a snapshot
  // from the moment "Analyze" was pressed, but notes/themes edited here need
  // to read (and write) the live copy, not that snapshot.
  const liveGame = useMemo(() => {
    if (!initialLine?.gameId || !initialLine?.playerId) return null;
    const owner = state.players.find((p) => p.id === initialLine.playerId);
    return owner?.games.find((g) => g.id === initialLine.gameId) ?? null;
  }, [state.players, initialLine?.gameId, initialLine?.playerId]);

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
      // A game Studio has already run "Save changes" on carries its explored
      // variations this way (see setGameTree); its trunk is still the same
      // sequence as initialLine.moves, so the ply-keyed comments/badges below
      // still land correctly even though this tree is richer than a fresh one.
      const t = initialLine.tree ?? makeTree(initialLine.moves);
      setTree(t);
      setHead('root');
      // Whatever a coach badged or wrote on this line comes with it — "Analyze
      // this line" is the ordinary way anyone reaches this board, not a
      // Coaches-Corner-only path, so what's shown here can't be gated behind
      // Studio mode or the annotations would only ever be visible to the
      // person who made them.
      setMoveNotes(plyMapToNodeIds(t, initialLine.comments));
      setMoveBadges(plyMapToNodeIds(t, initialLine.badges));
      setVariationHighlights(initialLine.variationHighlights ?? {});
    }
  }, [initialLine]);

  // Colours the whole variation `nodeId` belongs to, and nothing else —
  // branchRootOf resolves any move inside a branch back to that branch's own
  // root, so the colour lands on the same row whichever move in it was
  // right-clicked. Used by the move list's own menu, where you're already
  // looking at the line you're colouring and being moved somewhere would
  // just be jarring. A node on the main line (branchRootOf → null) has no
  // variation to colour. `color: null` is the menu's Clear; picking the
  // colour already on the line clears it too.
  const assignHighlight = (nodeId, color) => {
    const rootId = branchRootOf(tree, nodeId);
    if (!rootId) return;
    setVariationHighlights((prev) => {
      const next = { ...prev };
      if (!color || next[rootId] === color) delete next[rootId];
      else next[rootId] = color;
      return next;
    });
  };

  // The keyboard's 1 / 2 / 3: "instead of what was played here, show me the
  // top / second / third alternative" — pressed from the game itself, which
  // is where you actually are when reviewing it. It marks that line and puts
  // the board on its first move, so → walks the rest of the line from there
  // and 9 (backToMainLine) returns to the game.
  //
  // Pressing the same number while already standing in the line it points to
  // is the natural undo: clears the colour and steps back out to the game.
  const SLOT_COLORS = ['green', 'blue', 'yellow'];
  const pickAlternative = (slot) => {
    const color = SLOT_COLORS[slot];
    const currentBranch = branchRootOf(tree, head);
    if (currentBranch && variationHighlights[currentBranch] === color) {
      setVariationHighlights((prev) => {
        const next = { ...prev };
        delete next[currentBranch];
        return next;
      });
      setHead(lastMainLineAncestor(tree, head));
      return;
    }
    const target = alternativesAt(tree, head)[slot];
    if (!target) return; // nothing tried at this point, or fewer than slot+1 of them
    setVariationHighlights((prev) => ({ ...prev, [target.id]: color }));
    setHead(target.id);
  };

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

  useEffect(() => {
    setMoveNoteDraft(moveNotes[head] ?? '');
  }, [head]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the store's copy of this session current, for the initializers
  // above to pick back up if the tab gets reloaded from under us. Only for a
  // session that owns itself — one opened from a specific line or a saved
  // Lab entry has its own source of truth and shouldn't overwrite the draft
  // some other blank board is mid-way through.
  useEffect(() => {
    if (initialLine || initialLab) return;
    const empty = moves.length === 0
      && Object.keys(moveNotes).length === 0
      && Object.keys(moveBadges).length === 0
      && Object.keys(annotations).length === 0;
    dispatch({
      type: 'setAnalysisDraft',
      draft: empty ? null : {
        baseFen, tree, head, orientation, moveNotes, moveBadges, variationHighlights, annotations, labId, labTitle,
        labNote,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFen, tree, head, orientation, moveNotes, moveBadges, variationHighlights, annotations, labId, labTitle,
    labNote]);

  const game = useMemo(() => {
    const c = new Chess(baseFen);
    for (let i = 0; i < ply; i += 1) c.move(moves[i]);
    return c;
  }, [baseFen, moves, ply]);
  const fen = game.fen();
  const fenRef = useRef(fen); // read by the engine listener, which is set up once
  fenRef.current = fen;

  // A Board Editor position (or a pasted FEN) rarely starts the game — the
  // move list needs to number and colour from wherever it actually begins,
  // not always assume 1.White, or a mid-game setup reads as a fresh game.
  const baseMeta = useMemo(() => {
    const parts = baseFen.trim().split(/\s+/);
    return { startNumber: Number(parts[5]) || 1, startColor: parts[1] === 'b' ? 'b' : 'w' };
  }, [baseFen]);

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
      // Through eventKey (lib/shortcuts) so a numpad digit reaches the
      // shortcuts below as its printed digit whatever Num Lock is doing —
      // otherwise numpad 1 arrives as 'End' and gets swallowed by the
      // jump-to-end case a few lines down, doing nothing visible at all.
      const key = eventKey(e);
      const settings = (patch) => dispatch({ type: 'setSettings', settings: patch });
      switch (key) {
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
      switch (keyMap[key.toLowerCase()]) {
        case 'flipBoard': setOrientation((o) => (o === 'white' ? 'black' : 'white')); break;
        case 'toggleEngine': setEngineOn((v) => !v); break;
        case 'toggleArrows': settings({ engineArrows: !showEngineArrows }); break;
        case 'toggleLines': settings({ engineLines: !showEngineLines }); break;
        case 'toggleEvalBar': settings({ evalBar: !showEvalBar }); break;
        case 'toggleCheckHighlight': settings({ checkHighlight: state.settings.checkHighlight === false }); break;
        case 'toggleDrawMode': setDrawMode((d) => !d); break;
        case 'switchExplorer': setSidePane((p) => (p === 'engine' ? 'explorer' : 'engine')); break;
        case 'highlightGreen': pickAlternative(0); break;
        case 'highlightBlue': pickAlternative(1); break;
        case 'highlightYellow': pickAlternative(2); break;
        case 'backToMainLine': setHead(lastMainLineAncestor(tree, head)); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves.length, ply, lineNodes, showEngineArrows, showEngineLines, showEvalBar, keyMap, head, tree,
    variationHighlights]);

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

  // Something has to be worth keeping: a note, a title, some moves or a drawing.
  const canSaveLab = !!(labTitle.trim() || labNote.trim() || moves.length > 0 || markedCount > 0);

  // A note still sitting in the draft box, not yet committed with its own
  // Save button, shouldn't be lost just because a different Save was pressed
  // instead — this folds it in wherever moveNotes is read for saving.
  const notesWithDraft = () => {
    if (moveNoteDraft === (moveNotes[head] ?? '')) return moveNotes;
    const next = { ...moveNotes };
    if (moveNoteDraft.trim()) next[head] = moveNoteDraft.trim();
    else delete next[head];
    return next;
  };

  // The line on the board is lineNodes/moves in lockstep — node i made move i
  // — so whatever's been badged or annotated by node id converts straight to
  // the ply-indexed shape a saved variation or a saved game uses. Shared by
  // "Save as a variation" and "Save game": both are committing the same kind
  // of snapshot, just into a different destination.
  const lineAnnotationsAsPly = (uptoPly) => {
    const notes = notesWithDraft();
    const comments = {};
    const badges = {};
    lineNodes.slice(0, uptoPly).forEach((n, i) => {
      if (notes[n.id]) comments[i] = notes[n.id];
      if (moveBadges[n.id]) badges[i] = moveBadges[n.id];
    });
    return { comments, badges };
  };

  // The closest annotated move at or before the current position, tree-aware
  // (lineNodes/moves are already the exact line the board is showing).
  // Only the move actually on the board right now — not the most recent
  // commented one behind it. A note used to linger (dimmed) all the way
  // until the next commented move overrode it, which read as the card being
  // stuck on whatever you'd already stepped past; stepping off a commented
  // move now clears it immediately, same as anything else on the board that
  // reflects the current position.
  const currentNote = useMemo(() => {
    const node = lineNodes[ply - 1];
    if (node && moveNotes[node.id]) {
      return {
        text: moveNotes[node.id], san: node.san, index: ply - 1, badgeId: moveBadges[node.id], float: true,
      };
    }
    return null;
  }, [lineNodes, ply, moveNotes, moveBadges]);

  // Badging or noting a move while analyzing a saved game used to live only
  // in this session's local state — gone the moment you left unless you
  // remembered to Save to Lab, which is a different record from the game
  // itself. This mirrors the same edit onto the game's own badges/comments,
  // the same fields its "step through this game" viewer already reads and
  // writes, so it's there next time you open the game, review pass or not.
  // Only for a move actually played in the game; a branch explored here has
  // nowhere on the game record to live.
  const syncGameMove = (kind, value) => {
    if (!liveGame) return;
    const trunk = mainLineFrom(tree);
    const ply = trunk.findIndex((n) => n.id === head);
    if (ply < 0) return;
    dispatch(kind === 'badge'
      ? { type: 'setGameMoveBadge', playerId: initialLine.playerId, gameId: initialLine.gameId, ply, badge: value }
      : { type: 'setGameMoveComment', playerId: initialLine.playerId, gameId: initialLine.gameId, ply, text: value });
  };

  // The reverse of plyMapToNodeIds below: trunk-only, since (as above) an
  // off-trunk badge/note has nowhere on the flat game record to live.
  const nodeIdsToPlyMap = (t, nodeIdMap) => {
    const trunk = mainLineFrom(t);
    const out = {};
    trunk.forEach((node, i) => {
      if (nodeIdMap[node.id] != null) out[i] = nodeIdMap[node.id];
    });
    return out;
  };

  // "Save changes": the one thing syncGameMove above doesn't already cover
  // live, move by move — the arrows and square highlights drawn on the
  // board, which (unlike a badge or a note) had nowhere on a game record to
  // land until now. Re-sending the trunk's badges/comments here too costs
  // nothing and means one button really does mean "everything in this
  // session is on the game now", not just "the drawing is".
  const [changesSaved, setChangesSaved] = useState(false);
  const saveChangesToGame = () => {
    if (!liveGame) return;
    const { playerId, gameId } = initialLine;
    dispatch({ type: 'setGameAnnotations', playerId, gameId, annotations });
    dispatch({ type: 'setGameBadges', playerId, gameId, badges: nodeIdsToPlyMap(tree, moveBadges) });
    dispatch({ type: 'setGameComments', playerId, gameId, comments: nodeIdsToPlyMap(tree, moveNotes) });
    // Only worth keeping the tree itself (over the flat trunk every other
    // game feature already has) when there's actually a branch or a
    // highlight hanging off it — otherwise it's just a second copy of the
    // same moves, and clearing it here is what lets removing every
    // variation and saving again actually drop it instead of leaving a
    // stale one behind.
    const worthKeeping = hasVariations(tree) || Object.keys(variationHighlights).length > 0;
    dispatch({
      type: 'setGameTree',
      playerId,
      gameId,
      tree: worthKeeping ? tree : undefined,
      variationHighlights: worthKeeping ? variationHighlights : undefined,
    });
    setChangesSaved(true);
  };
  useEffect(() => {
    if (!changesSaved) return undefined;
    const t = setTimeout(() => setChangesSaved(false), 1600);
    return () => clearTimeout(t);
  }, [changesSaved]);

  // Chess.com-style Game Review: a dedicated, throwaway engine so it never
  // fights the live analysis engine over the search queue. Always reviews
  // the tree's main line from the start — wherever the cursor happens to be
  // sitting, or whatever side branch is being poked at, the actual game
  // stays anchored on the trunk (see lib/moveTree's promote/promoteOne).
  const runReview = async () => {
    if (reviewBusy) return;
    const trunkMoves = mainLineFrom(tree).map((n) => n.san);
    if (trunkMoves.length === 0) return;
    setReviewBusy(true);
    setReviewProgress({ done: 0, total: trunkMoves.length });
    setReviewResult(null);
    const reviewEngine = new Engine();
    try {
      const result = await runGameReview(reviewEngine, { baseFen, moves: trunkMoves }, {
        depth: 15,
        onProgress: (done, total) => setReviewProgress({ done, total }),
      });
      setMoveBadges((m) => ({ ...m, ...plyMapToNodeIds(tree, result.badges) }));
      if (liveGame) {
        dispatch({
          type: 'setGameBadges', playerId: initialLine.playerId, gameId: initialLine.gameId, badges: result.badges,
        });
      }
      setReviewResult(result);
    } finally {
      reviewEngine.quit();
      setReviewBusy(false);
    }
  };

  const saveToLab = () => {
    // Drop positions whose marks were cleared, so an entry doesn't carry a map
    // of empty ones around forever.
    const marksToKeep = Object.fromEntries(Object.entries(annotations).filter(([, m]) => (
      m.arrows.length > 0 || Object.keys(m.squares).length > 0)));
    const fallbackTitle = moves.length > 0
      ? `${moves.slice(0, 6).join(' ')}${moves.length > 6 ? '…' : ''}`
      : 'Untitled position';
    const id = labId ?? uid();
    dispatch({
      type: 'saveLabEntry',
      entry: {
        id,
        title: labTitle.trim() || fallbackTitle,
        note: labNote,
        baseFen,
        moves,
        tree,
        annotations: marksToKeep,
        moveBadges,
        moveNotes: notesWithDraft(),
        variationHighlights,
        coach: !!coachMode,
        // Where this started, when it started somewhere: a repertoire line or a
        // saved game. Kept so the entry can say what it was about.
        source: initialLine
          ? {
            name: initialLine.name ?? null,
            gameId: initialLine.gameId ?? null,
            playerId: initialLine.playerId ?? null,
          }
          : (initialLab?.source ?? null),
      },
    });
    // Held on to, so pressing Save again updates this entry rather than
    // scattering near-identical copies through the Lab.
    setLabId(id);
  };

  const position = useMemo(() => {
    try { return new Chess(fen); } catch { return null; }
  }, [fen]);

  // Captured material, chess.com style — from the position itself, so it's
  // right for any FEN, not just a game played out from the start.
  const material = useMemo(
    () => (position ? materialDiff(position) : { capturedByWhite: [], capturedByBlack: [], diff: 0 }),
    [position],
  );

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
    // A note's move reference was clicked — glow that square on top of
    // whatever else is drawn, since it's the most recent, deliberate thing
    // asked of the board.
    if (noteHighlight) {
      styles[noteHighlight.square] = { ...styles[noteHighlight.square], ...NOTE_HIGHLIGHT_STYLE };
    }
    return styles;
  }, [marks.squares, drawFrom, drawColor, picked, position, showLegal, noteHighlight]);

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

  // A queen isn't always the right answer — this is the loaded position, not
  // one from the current view's closure, so it stays correct even if the
  // picker's onPick fires after a re-render.
  const commitMove = (from, to, promotion) => {
    const clone = new Chess(fen);
    let mv = null;
    try { mv = clone.move({ from, to, promotion: promotion ?? 'q' }); } catch { mv = null; }
    if (!mv) return false;
    record(mv.san);
    setPicked(null);
    setPendingPromotion(null);
    return true;
  };

  const onPieceDrop = (from, to) => {
    if (drawMode) return false; // in draw mode the board is a canvas, not a game
    let needsChoice = false;
    try {
      const probe = new Chess(fen);
      needsChoice = probe.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
    } catch { needsChoice = false; }
    if (needsChoice) {
      setPendingPromotion({ from, to, color: new Chess(fen).turn() });
      return false; // the board waits; the picker decides which piece lands
    }
    return commitMove(from, to);
  };

  const onSquareClick = (square) => {
    if (drawMode) return; // press-and-drag owns drawing now, see onDrawPointer* below
    // Click-to-move, so a trackpad or a finger can play without dragging.
    if (picked) {
      // Tapping the piece you just picked puts it back down. Without this it
      // falls through to the move attempt below, which fails (from === to)
      // and then re-picks the same square — leaving the only way out a click
      // on some empty square elsewhere.
      if (picked === square) { setPicked(null); return; }
      const played = onPieceDrop(picked, square);
      setPicked(played ? null : (position?.get(square) ? square : null));
      return;
    }
    const piece = position?.get(square);
    if (piece && piece.color === position.turn()) setPicked(square);
  };

  // Loading anything new replaces the tree and opens at move 1.
  // A freshly built trunk (no branches yet) has its nodes in the same order as
  // the moves that made it, so a ply-indexed map — the shape a saved
  // variation's `comments`/`badges` and a PGN's move annotations both carry —
  // lines up directly against it, node by node.
  const plyMapToNodeIds = (tree, plyMap) => {
    if (!plyMap) return {};
    const trunk = mainLineFrom(tree);
    const out = {};
    for (const [ply, value] of Object.entries(plyMap)) {
      const node = trunk[Number(ply)];
      if (node && value) out[node.id] = value;
    }
    return out;
  };

  const loadMoves = (sans, opts) => {
    const t = makeTree(sans);
    setTree(t);
    setHead('root');
    // Loading a different line makes this a different subject, so it detaches
    // from whichever Lab entry was open. Without this, opening a saved note and
    // then loading a repertoire line would leave Save pointed at the old entry
    // and quietly overwrite it with the new line's moves.
    setLabId(null);
    setLabTitle(opts?.title ?? '');
    setLabNote('');
    setAnnotations({});
    setMoveNotes(plyMapToNodeIds(t, opts?.comments));
    setMoveBadges(plyMapToNodeIds(t, opts?.badges));
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

  // One game loads straight onto the board; several (a study export, a PGN
  // with more than one game pasted in) go to the picker below instead. Badges
  // and comments ride along either way — a coach's NAG-annotated PGN or study
  // export shouldn't have to lose its "??"s just for coming in this way.
  const loadEntries = (entries) => {
    if (entries.length === 1) {
      setBaseFen(START_FEN);
      loadMoves(entries[0].moves, {
        title: entries[0].name, comments: entries[0].comments, badges: entries[0].badges,
      });
    } else {
      setStudyGames(entries);
    }
  };

  // Pull a Lichess study in as PGN and let the coach pick which chapter to
  // put on the board — a study is one game per chapter, so this is the same
  // shape the course importer already understands.
  const fetchStudy = async () => {
    const parsed = parseStudyUrl(studyUrl);
    if (!parsed) return;
    setStudyBusy(true);
    setStudyError(null);
    setStudyGames(null);
    try {
      const pgn = await fetchStudyPgn(parsed);
      const entries = pgnTextToEntries(pgn);
      if (entries.length === 0) throw new Error('That study came back with no readable moves.');
      loadEntries(entries);
      setStudyUrl('');
    } catch (err) {
      setStudyError(err.message);
    } finally {
      setStudyBusy(false);
    }
  };

  // A PGN (or plain movetext) pasted straight in — no fetch, no chapter to
  // build first, just moves onto the board right now. mainLineOnly: this is
  // one game, not a course — any variations in its export are sidelines on
  // the game actually played, not alternate games to choose between.
  const loadPgnText = () => {
    const entries = pgnTextToEntries(pgnText, { mainLineOnly: true });
    setStudyError(null);
    if (entries.length === 0) { setStudyError('No legal moves found in that text.'); return; }
    loadEntries(entries);
    setPgnText('');
  };

  const loadVariation = (value) => {
    if (!value) return;
    const [oid, cid, vid] = value.split('|');
    const opening = state.openings.find((o) => o.id === oid);
    const chapter = opening?.chapters.find((c) => c.id === cid);
    const variation = chapter?.variations.find((v) => v.id === vid);
    if (variation) {
      setBaseFen(START_FEN);
      loadMoves(variation.moves, {
        title: variation.name,
        comments: variation.comments,
        badges: variation.badges,
      });
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
  // The editor gets a quarter more board than Engine mode. It can afford it:
  // setting a position up by hand is the one job here that's all board, and
  // the palette sits BESIDE it (.board-editor is a flex row) rather than under
  // it, so the height left over isn't Engine mode's — reserving Engine's
  // 290px of chrome below the board was clamping the extra quarter away
  // before it could show. Once the palette does wrap underneath, at the
  // narrower widths `tight` marks, Engine's budget is the right one again.
  const editorHeightCap = tight ? heightCap : Math.max(320, winH - 210);
  const editorBoardWidth = Math.floor(
    Math.max(280, Math.min(boardWidth * 1.25, editorHeightCap, viewportWidth - 26)) / 8,
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
            <button onClick={() => setMode('editor')}>Board Editor</button>
          </div>
        </div>
        <CompareView onAnalyze={(v) => { setMode('engine'); loadLine(v); }} />
      </div>
    );
  }

  if (mode === 'editor') {
    return (
      <div className="page wide">
        <div className="page-head">
          <h1>Analysis</h1>
          <div className="mode-tabs">
            <button onClick={() => setMode('engine')}>Engine</button>
            <button onClick={() => setMode('compare')}>Compare lines</button>
            <button className="active">Board Editor</button>
          </div>
        </div>
        <BoardEditor
          // A quarter larger than Engine mode's board — see editorBoardWidth.
          // That width is derived from Engine's own measured column rather
          // than from BOARD_MAX, which is what keeps the two in proportion on
          // any given screen, Mac or iPad, instead of letting the editor grow
          // unopposed on a wide one.
          boardWidth={editorBoardWidth}
          onSendToAnalysis={({ baseFen: f, moves: m }) => {
            setMode('engine');
            setBaseFen(f);
            loadMoves(m ?? []);
          }}
        />
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
          <button onClick={() => setMode('editor')}>Board Editor</button>
        </div>
        <button
          title="Save this game to your Games tab, or a student's profile in Coaches"
          disabled={moves.length === 0}
          onClick={() => setSaving(true)}
        >
          <DownloadIcon size={15} /> Save game
        </button>
        <button
          title="Have Stockfish grade every move — Brilliant down to Blunder, badged right on the board"
          disabled={moves.length === 0 || reviewBusy}
          onClick={runReview}
        >
          <TargetIcon size={15} />
          {reviewBusy ? `Reviewing… ${reviewProgress?.done ?? 0}/${reviewProgress?.total ?? 0}` : 'Game Review'}
        </button>
        <select
          className="line-picker"
          defaultValue=""
          onChange={(e) => { loadVariation(e.target.value); e.target.value = ''; }}
        >
          <option value="" disabled>Load a repertoire line…</option>
          {/* Grouped by whose repertoire it is — in Coach's Corner several
              students can have an opening with the same name, and a plain
              flat list would leave no way to tell them apart. */}
          {Object.entries(
            state.openings.reduce((groups, o) => {
              const owner = coachMode
                ? (state.players.find((p) => p.id === o.ownerId)?.name ?? 'My repertoire')
                : 'Repertoire';
              (groups[owner] ??= []).push(o);
              return groups;
            }, {}),
          ).map(([owner, openings]) => (
            <optgroup key={owner} label={owner}>
              {openings.map((o) => o.chapters.map((c) => c.variations.map((v) => (
                <option key={v.id} value={`${o.id}|${c.id}|${v.id}`}>
                  {o.name} / {c.name} / {v.name}
                </option>
              ))))}
            </optgroup>
          ))}
        </select>
        <button
          className={`small${pgnOpen ? ' primary' : ''}`}
          title="Load a PGN — paste it in, or pull a Lichess study straight onto the board"
          onClick={() => setPgnOpen((o) => !o)}
        >
          <UploadIcon size={14} /> Paste PGN
        </button>
        {pgnOpen && (
          <div className="study-import">
            <input
              type="text"
              className="study-url-input"
              placeholder="…or a Lichess study link"
              value={studyUrl}
              onChange={(e) => { setStudyUrl(e.target.value); setStudyError(null); setStudyGames(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchStudy(); }}
            />
            <button
              className="small"
              disabled={!parseStudyUrl(studyUrl) || studyBusy}
              onClick={fetchStudy}
            >
              {studyBusy ? 'Fetching…' : 'Fetch'}
            </button>
          </div>
        )}
        {pgnOpen && (
          <div className="pgn-paste-row">
            <textarea
              rows={3}
              className="pgn-paste-textarea"
              placeholder="1.e4 e5 2.Nf3 Nc6 … or a full PGN, headers and all"
              value={pgnText}
              onChange={(e) => { setPgnText(e.target.value); setStudyError(null); }}
            />
            <button className="small primary" disabled={!pgnText.trim()} onClick={loadPgnText}>
              Load
            </button>
          </div>
        )}
        {studyError && <span className="muted-note study-error">{studyError}</span>}
        {studyGames && (
          <div className="study-games">
            <span className="muted-note">
              {studyGames.length} game{studyGames.length === 1 ? '' : 's'} — pick one to load onto the board:
            </span>
            <div className="study-games-list">
              {studyGames.map((g, i) => (
                <button
                  key={i}
                  className="small ghost"
                  onClick={() => {
                    setBaseFen(START_FEN);
                    loadMoves(g.moves, { title: g.name, comments: g.comments, badges: g.badges });
                    setStudyGames(null);
                    setStudyUrl('');
                    setPgnText('');
                  }}
                >
                  {g.name || `Chapter ${i + 1}`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {reviewResult && (
        <div className="review-summary">
          <TargetIcon size={14} />
          <strong>Game Review</strong>
          {reviewResult.accuracy.white != null && (
            <span className="rs-side"><span className="rs-dot white" /> White {reviewResult.accuracy.white.toFixed(1)}%</span>
          )}
          {reviewResult.accuracy.black != null && (
            <span className="rs-side"><span className="rs-dot black" /> Black {reviewResult.accuracy.black.toFixed(1)}%</span>
          )}
          <span className="muted-note">— every move badged below and in the move list</span>
        </div>
      )}

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
              running={engineOn && engineStatus === 'running'}
            />
          )}
          <div className="board-column" style={{ width: boardWidth }}>
          <MaterialBar
            pieces={orientation === 'white' ? material.capturedByBlack : material.capturedByWhite}
            capturedColor={orientation === 'white' ? 'white' : 'black'}
            advantage={orientation === 'white' ? Math.max(0, -material.diff) : Math.max(0, material.diff)}
          />
          <div
            className="board-frame"
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
            onPromotionCheck={() => false}
            arePiecesDraggable={!drawMode}
            areArrowsAllowed={false}
            // This view runs its own pen — colours, saved marks, the Draw
            // toggle for touch — so it doesn't want Board's plain one too.
            ownArrows={false}
            customSquareStyles={squareStyles}
            lastMove={lastMove}
            badge={moveBadges[head]}
            boardOrientation={orientation}
            boardWidth={boardWidth}
          />
          {pendingPromotion && (
            <PromotionPicker
              square={pendingPromotion.to}
              color={pendingPromotion.color}
              boardWidth={boardWidth}
              orientation={orientation}
              onPick={(piece) => commitMove(pendingPromotion.from, pendingPromotion.to, piece)}
              onCancel={() => setPendingPromotion(null)}
            />
          )}
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
          <MaterialBar
            pieces={orientation === 'white' ? material.capturedByWhite : material.capturedByBlack}
            capturedColor={orientation === 'white' ? 'black' : 'white'}
            advantage={orientation === 'white' ? Math.max(0, material.diff) : Math.max(0, -material.diff)}
          />
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

          {liveGame && (
            <div className="panel game-notes-panel" style={{ maxWidth: boardWidth }}>
              <div className="game-notes-head">
                <strong>Notes</strong>
              </div>
              <textarea
                key={liveGame.id}
                className="game-notes-input"
                rows={3}
                defaultValue={liveGame.meta?.notes ?? ''}
                placeholder="Notes for this game — what to remember, what to revisit…"
                onBlur={(e) => {
                  if (e.target.value === (liveGame.meta?.notes ?? '')) return;
                  dispatch({
                    type: 'setGameNotes',
                    playerId: initialLine.playerId,
                    gameId: initialLine.gameId,
                    notes: e.target.value,
                  });
                }}
              />
              <GameFlagPicker
                flags={liveGame.meta?.flags}
                onChange={(flags) => dispatch({
                  type: 'setGameFlags', playerId: initialLine.playerId, gameId: initialLine.gameId, flags,
                })}
              />
            </div>
          )}

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

          {/* The Lab notebook. Always here, whatever the board is showing —
              working on a repertoire line is exactly when a thought is worth
              writing down, so this isn't limited to a blank board. */}
          <div className="panel lab-panel" style={{ maxWidth: boardWidth }}>
            <div className="lab-head">
              <FlaskIcon size={16} />
              <strong>Lab notes</strong>
              {labId && <span className="lab-saved-pill">saved</span>}
              <span style={{ flex: 1 }} />
              {labId && (
                <button
                  className="small ghost"
                  title="Start a fresh note — this keeps the saved one as it is"
                  onClick={() => { setLabId(null); setLabTitle(''); setLabNote(''); }}
                >
                  New
                </button>
              )}
            </div>
            <input
              type="text"
              className="lab-title"
              placeholder="Title — e.g. “Nf3 sideline, needs a plan for …”"
              value={labTitle}
              onChange={(e) => setLabTitle(e.target.value)}
            />
            <textarea
              className="game-notes-input"
              rows={4}
              placeholder="Your ideas about this position — plans, what to check, what went wrong…"
              value={labNote}
              onChange={(e) => setLabNote(e.target.value)}
            />
            <div className="lab-actions">
              <button className="small primary" onClick={saveToLab} disabled={!canSaveLab}>
                <FlaskIcon size={14} /> {labId ? 'Update in Lab' : 'Save to Lab'}
              </button>
              <button
                className="small"
                title="Add the moves on the board to a chapter as a new variation"
                onClick={() => setSaveLineOpen(true)}
                disabled={moves.length === 0}
              >
                <BookIcon size={14} /> Save line to a chapter…
              </button>
              <span style={{ flex: 1 }} />
              <span className="muted-note">
                {moves.length} move{moves.length === 1 ? '' : 's'}
                {markedCount > 0 && ` · ${markedCount} marked position${markedCount === 1 ? '' : 's'}`}
              </span>
            </div>
            <p className="hint">
              Saving keeps the notes, every move on the board including variations, and the arrows
              and highlights you've drawn on each position. Find them again under Collections → Lab.
            </p>
          </div>
        </div>

        <div className="analysis-engine">
          {/* Whatever's been badged or written on the move that's on the board
              — a coach's from Coaches Corner, or your own — pinned to the top
              of this column so it's visible whichever of Engine/Explorer/
              Annotate is open below, not just tucked under one tab. Nothing
              renders here at all when there's nothing to say. */}
          {currentNote && (
            <div className="side-note">
              <MoveNote key={currentNote.index} {...currentNote} onMoveClick={highlightNoteSquare} />
            </div>
          )}

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
              {coachMode && (
                <button
                  className={sidePane === 'annotate' ? 'active' : ''}
                  onClick={() => setSidePane('annotate')}
                >
                  <FlaskIcon size={13} /> Annotate
                  {(moveBadges[head] || moveNotes[head]) && <span className="tab-dot" />}
                </button>
              )}
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

          {sidePane === 'annotate' && coachMode && (
            <div className="annotate-pane">
              {head === 'root' ? (
                <p className="hint">
                  Play or load a line, then click any move — here or in the move list below — to
                  badge it and write what a student should take from it.
                </p>
              ) : (
                <>
                  <h3>
                    Move {moveLabel(ply - 1)}{moves[ply - 1]}
                    {moveBadges[head] && <MoveBadge id={moveBadges[head]} size={17} />}
                  </h3>
                  <div className="badge-row">
                    {BADGES.map((b) => {
                      const on = moveBadges[head] === b.id;
                      return (
                        <button
                          key={b.id}
                          className={`badge-pick${on ? ' on' : ''}`}
                          title={b.label}
                          style={on ? { background: b.color, borderColor: b.color } : undefined}
                          onClick={() => {
                            setMoveBadges((m) => {
                              const next = { ...m };
                              if (on) delete next[head];
                              else next[head] = b.id;
                              return next;
                            });
                            syncGameMove('badge', on ? null : b.id);
                          }}
                        >
                          <span className="bp-glyph" style={{ color: on ? '#fff' : b.color }}>{b.symbol}</span>
                          <span className="bp-label">{b.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <label className="annotate-note-label">
                    <CommentIcon size={13} /> What should a student take from this move?
                  </label>
                  <textarea
                    rows={5}
                    className="annotate-textarea"
                    placeholder="e.g. This is the critical try — White has to know ...Bxf3 leads to a forced draw."
                    value={moveNoteDraft}
                    onChange={(e) => setMoveNoteDraft(e.target.value)}
                  />
                  {/* An explicit button rather than saving on blur — matching
                      the chapter comment editor elsewhere in the app, and more
                      reliable than blur: nothing is silently lost if the note
                      is still focused when Save session / Save as a variation
                      below is pressed. */}
                  {moveNoteDraft !== (moveNotes[head] ?? '') && (
                    <div className="annotate-note-actions">
                      <button className="small" onClick={() => setMoveNoteDraft(moveNotes[head] ?? '')}>
                        Discard
                      </button>
                      <button
                        className="small primary"
                        onClick={() => {
                          const text = moveNoteDraft.trim();
                          setMoveNotes((m) => {
                            const next = { ...m };
                            if (text) next[head] = text;
                            else delete next[head];
                            return next;
                          });
                          syncGameMove('comment', text);
                        }}
                      >
                        Save note
                      </button>
                    </div>
                  )}
                </>
              )}
              <div className="annotate-foot">
                {liveGame && (
                  <button className="small primary" onClick={saveChangesToGame}>
                    <CheckIcon size={14} /> {changesSaved ? 'Saved ✓' : 'Save changes'}
                  </button>
                )}
                <button className={`small${liveGame ? '' : ' primary'}`} onClick={saveToLab}>
                  <FlaskIcon size={14} /> {labId ? 'Update in Lab' : 'Save session to Lab'}
                </button>
                <button
                  className="small"
                  disabled={moves.length === 0}
                  onClick={() => setSaveLineOpen(true)}
                >
                  <BookIcon size={14} /> Save as a variation…
                </button>
              </div>
              <p className="hint">
                A badge and note here belong to that exact move on this board's line
                {liveGame ? ', and are saved straight onto this game as you go' : ''}.
                {liveGame && ' Save changes also carries over any arrows or square highlights drawn on the board — the one thing that isn\'t already saved the moment you draw it.'}
                {' '}Saving to the Lab keeps every badge and note across the whole tree; saving as a
                variation carries the current line's notes and badges into a chapter, editable there
                the same way. Standing on a move in the game, press 1, 2, or 3 (rebindable in
                Settings → Keyboard, numpad works too) to jump into the top, second, or third
                alternative tried at that point — marking it green, blue, or yellow. → walks the rest
                of that line, 9 jumps back to the game from however deep you are, and the same number
                again clears the colour and steps back out.
              </p>
            </div>
          )}
          </div>
        </div>

        <div className="analysis-moves-col">
          {(moves.length > 0 || baseFen !== START_FEN) && (
            <div className="panel analysis-movelist-panel">
              <div className="movelist-head">
                <span>Moves</span>
                <span className="muted-note">
                  {(() => {
                    if (ply === 0) return 'start';
                    // Matches MoveTree's own numFor exactly — virtualPly is
                    // the real ply just played, shifted the same way.
                    const virtualPly = ply + (baseMeta.startColor === 'b' ? 1 : 0);
                    const num = Math.floor((virtualPly - 1) / 2) + baseMeta.startNumber;
                    return `${num}${virtualPly % 2 === 1 ? '.' : '…'}${moves[ply - 1]}`;
                  })()}
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
                  badges={moveBadges}
                  highlights={variationHighlights}
                  onHighlight={assignHighlight}
                  startNumber={baseMeta.startNumber}
                  startColor={baseMeta.startColor}
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

      {saveLineOpen && (
        <SaveLineToChapter
          moves={moves}
          suggestedName={labTitle.trim() || (initialLine?.name ?? '')}
          openings={state.openings}
          onClose={() => setSaveLineOpen(false)}
          onSave={({ openingId, chapterId, name }) => {
            const { comments, badges } = lineAnnotationsAsPly(moves.length);
            dispatch({
              type: 'addVariations',
              openingId,
              chapterId,
              variations: [{ name, moves, comments, badges }],
            });
            setSaveLineOpen(false);
          }}
        />
      )}

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
          {...lineAnnotationsAsPly(ply)}
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
function SaveToGames({
  moves, comments, badges, meta, state, dispatch, onClose,
}) {
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
          <h3>Save game</h3>
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
        initial={{ moves, comments, badges, meta: {} }}
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
        <h3>Save game</h3>
        <p className="hint">{moves.length} moves from the board. Whose game is it?</p>
        <select value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
          {state.players.some((p) => (p.kind ?? 'self') === 'self') && (
            <optgroup label="Games">
              {state.players.filter((p) => (p.kind ?? 'self') === 'self').map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          )}
          {state.players.some((p) => p.kind === 'student') && (
            <optgroup label="Coaches">
              {state.players.filter((p) => p.kind === 'student').map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </optgroup>
          )}
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

// Put the moves on the board into a chapter as a new variation. Analysis often
// turns up a line worth keeping, and retyping it into the Library by hand is
// the sort of friction that means it never gets kept.
function SaveLineToChapter({ moves, suggestedName, openings, onClose, onSave }) {
  const [openingId, setOpeningId] = useState(openings[0]?.id ?? '');
  const opening = openings.find((o) => o.id === openingId);
  const [chapterId, setChapterId] = useState(opening?.chapters[0]?.id ?? '');
  const [name, setName] = useState(suggestedName);
  useBackGuard(true, onClose);

  // Changing opening invalidates the chapter chosen under the previous one.
  const pickOpening = (id) => {
    setOpeningId(id);
    const next = openings.find((o) => o.id === id);
    setChapterId(next?.chapters[0]?.id ?? '');
  };

  const ready = !!openingId && !!chapterId && moves.length > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <h3>Save this line to a chapter</h3>
        {openings.length === 0 ? (
          <p className="hint">
            No openings yet — add one in the Library first, and this line can go straight into it.
          </p>
        ) : (
          <>
            <p className="hint">
              {moves.length} move{moves.length === 1 ? '' : 's'}: {moves.slice(0, 12).join(' ')}
              {moves.length > 12 ? '…' : ''}
            </p>
            <label className="field">
              <span>Opening</span>
              <select value={openingId} onChange={(e) => pickOpening(e.target.value)}>
                {openings.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Chapter</span>
              <select
                value={chapterId}
                onChange={(e) => setChapterId(e.target.value)}
                disabled={!opening || opening.chapters.length === 0}
              >
                {(opening?.chapters ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            {opening && opening.chapters.length === 0 && (
              <p className="hint">
                “{opening.name}” has no chapters yet — add one in the Library first.
              </p>
            )}
            <label className="field">
              <span>Variation name</span>
              <input
                type="text"
                value={name}
                placeholder={moves.slice(0, 6).join(' ')}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!ready}
            onClick={() => onSave({
              openingId,
              chapterId,
              name: name.trim() || moves.slice(0, 6).join(' '),
            })}
          >
            Save variation
          </button>
        </div>
      </div>
    </div>
  );
}
