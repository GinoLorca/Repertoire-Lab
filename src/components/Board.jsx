import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { TouchBackend } from 'react-dnd-touch-backend';
import { Chess } from 'chess.js';
import { useStore } from '../store';
import { checkedKingSquare, CHECK_STYLE, LAST_MOVE_STYLE } from '../lib/legalMoves';
import { makePieces, DEFAULT_PIECE_LIGHT, DEFAULT_PIECE_DARK } from '../lib/pieces';
import { boardBadgeStyle } from '../lib/badges';
import { boardColors } from '../lib/theme';
import BoardArrows, { cell } from './BoardArrows';
import { TelestratorLayer } from './Telestrator';
import {
  PENS, comboMatchesEvent, defaultPen, isComboKey, shortcutKey,
} from '../lib/shortcuts';
import { skinId } from '../lib/skins';
import {
  profileOf, drawArrow, drawSquare, applyColors, colorOfNext, squareMarkStyle,
} from '../lib/arrowProfiles';

export const DEFAULT_SQUARE_LIGHT = '#c6d3e1';
export const DEFAULT_SQUARE_DARK = '#4a6a8f';

const BOARD_THEME = {
  customDarkSquareStyle: { backgroundColor: DEFAULT_SQUARE_DARK },
  customLightSquareStyle: { backgroundColor: DEFAULT_SQUARE_LIGHT },
};

// Rebuilding the piece set on every render would remount all 32 of them and
// kill the move animation, so each colour pair is built once and reused.
const pieceCache = new Map();
function pieceSet(light, dark) {
  const key = `${light}|${dark}`;
  if (!pieceCache.has(key)) pieceCache.set(key, makePieces(light, dark));
  return pieceCache.get(key);
}

// react-chessboard picks its drag backend with `"ontouchstart" in window`.
// An iPad reports touch support, so it gets the touch backend — which ignores
// mouse and trackpad input, leaving a Magic Keyboard cursor unable to drag.
// Using the touch backend WITH enableMouseEvents makes both work at once.
export const isTouchCapable = typeof window !== 'undefined' && 'ontouchstart' in window;
const dndProps = isTouchCapable
  ? {
    customDndBackend: TouchBackend,
    customDndBackendOptions: { enableMouseEvents: true, delayTouchStart: 0 },
  }
  : {};

// The pen keys held right now (lib/shortcuts — the analysis board's keys,
// Settings → Shortcuts), watched once for every board on the page: hold one
// while right-dragging and the arrow, or the highlight, is in that colour.
const heldKeys = new Set();
let watchingKeys = false;
function watchPenKeys() {
  if (watchingKeys || typeof window === 'undefined') return;
  watchingKeys = true;
  const typing = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);
  // An autofill's keydown can come with no key at all.
  const name = (e) => String(e.key ?? '').toLowerCase();
  window.addEventListener('keydown', (e) => { if (!typing(e)) heldKeys.add(name(e)); });
  window.addEventListener('keyup', (e) => heldKeys.delete(name(e)));
  // A key let go in another app would otherwise stay "held".
  window.addEventListener('blur', () => heldKeys.clear());
}

// The colour of the pen whose key is held as `e` happens — a letter held
// down, or a modifier chord read off the event itself — or null for none.
function heldPen(settings, e) {
  for (const pen of PENS) {
    const key = shortcutKey(settings, pen.shortcutId);
    if (!key) continue;
    if (isComboKey(key) ? (e && comboMatchesEvent(key, e)) : heldKeys.has(key)) return pen.value;
  }
  return null;
}

// A highlighted square, the way the analysis board draws one (stronger, with
// a halo, while an arrow colour profile is on). A longhand colour, not the
// `background` shorthand, so a badge's glyph on the same square survives.
const highlightStyle = (base, color, profile) => {
  const { background: _shorthand, ...rest } = base ?? {};
  return { ...rest, ...squareMarkStyle(color, profile) };
};
const NO_DRAWING = { arrows: [], squares: {} };
// The position a board shows, as a FEN — for Strategic arrow colours.
const fenOf = (position) => (position === 'start'
  ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  : typeof position === 'string' ? position : null);

// Uptown Express: the board's ranks and files as subway line signs — a
// white number or letter on a disc of its line's colour, as Chess Arcade
// draws them. There they sit in a strip outside the board; here they take
// the corners the board's own coordinates use (numbers top-left down the
// left edge, letters bottom-right along the bottom), so they're drawn as a
// layer over the board instead of through react-chessboard's notation,
// which has one style for both.
const LINE_COLOR = {
  1: '#ee352e', 2: '#ee352e', 3: '#ee352e',
  4: '#00933c', 5: '#00933c', 6: '#00933c',
  7: '#b933ad', 8: '#b933ad',
  a: '#0039a6', c: '#0039a6', e: '#0039a6',
  b: '#ff6319', d: '#ff6319', f: '#ff6319',
  g: '#6cbe45', h: '#6cbe45',
};

function LineSigns({ boardWidth, orientation }) {
  const sq = boardWidth / 8;
  // About a quarter of a square — Chess Arcade's proportion — kept legible
  // on a small board and not oversized on a big one.
  const size = Math.round(Math.min(20, Math.max(9, sq * 0.24)));
  const inset = Math.max(1.5, sq * 0.045);
  const black = orientation === 'black';
  const ranks = black ? '12345678' : '87654321'; // top to bottom
  const files = black ? 'hgfedcba' : 'abcdefgh'; // left to right
  const sign = (label, left, top) => (
    <span
      key={label}
      className="line-sign"
      style={{
        left, top, width: size, height: size, fontSize: Math.round(size * 0.62), background: LINE_COLOR[label],
      }}
    >
      {label.toUpperCase()}
    </span>
  );
  return (
    <div className="line-signs" aria-hidden="true">
      {[...ranks].map((r, i) => sign(r, inset, i * sq + inset))}
      {[...files].map((f, i) => sign(f, (i + 1) * sq - inset - size, boardWidth - inset - size))}
    </div>
  );
}

const squareAtPoint = (x, y) => document.elementFromPoint(x, y)
  ?.closest?.('[data-square]')?.getAttribute('data-square') ?? null;

// The rank numbers and file letters, stroked so they hold up on any theme.
// react-chessboard already draws each one in the OPPOSITE square's colour —
// light lettering on a dark square, dark on a light one — so `currentColor`
// is exactly the dark-or-light-depending-on-the-background stroke wanted
// here, without a per-theme value anywhere. It matters most on the boards
// that carry a texture: a 7px glyph sitting on Game Boy's dot grid or
// Hustler's marble veining had nothing separating it from the pattern.
// The stroke thickens the glyph; the shadow lifts it off the square.
const NOTATION_STYLE = {
  WebkitTextStroke: '0.35px currentColor',
  textShadow: '0 0 1.5px currentColor',
  fontWeight: 700,
};

// Shared board: consistent theme, input handling that works with a mouse, a
// trackpad and a touchscreen, and the king in check marked in red wherever a
// board appears — analysis, practice, compare, the line viewer.
//
// `ownArrows` (on unless a view says otherwise) gives every board right-drag
// arrows drawn by BoardArrows — which bends a knight's at a right angle the
// way chess.com does. react-chessboard has an arrow layer of its own, on by
// default, but it draws every arrow as a straight line between two centres:
// that was the orange arrow cutting diagonally across a knight move, and no
// change to our renderer could reach it. It's off from here on, so arrows come
// from one place.
export default function Board({
  position, customSquareStyles, lastMove, badge, ownArrows = true, marks = null, telestrator = true, ...rest
}) {
  const { state } = useStore();
  // What's right-clicked onto this board (see DrawableBoard): its arrows and
  // squares, in the arrow colour profile's colours (lib/arrowProfiles.js).
  // Kept here so the squares go into the squares' own styles, under the
  // pieces, like everything else drawn on a square.
  const [drawing, setDrawing] = useState(NO_DRAWING);
  const profile = profileOf(state.settings);
  // A switch of profile recolours what's drawn.
  const profileSeen = useRef(profile);
  useEffect(() => {
    if (profileSeen.current === profile) return;
    profileSeen.current = profile;
    setDrawing((d) => applyColors(d, fenOf(position), profile));
  }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps
  const markCheck = state.settings.checkHighlight !== false;
  const markLast = state.settings.lastMoveHighlight !== false;
  const markBadge = state.settings.showBoardBadges !== false;

  // A Chess Arcade skin brings its own board and pieces; Custom falls through
  // to the colours picked in Settings, and then to the built-in pair.
  const chosen = boardColors(state.settings);
  const squareLight = chosen.squareLight ?? DEFAULT_SQUARE_LIGHT;
  const squareDark = chosen.squareDark ?? DEFAULT_SQUARE_DARK;
  const pieceLight = chosen.pieceLight ?? DEFAULT_PIECE_LIGHT;
  const pieceDark = chosen.pieceDark ?? DEFAULT_PIECE_DARK;
  // Only hand react-chessboard a custom set when it differs from its own, so an
  // untouched board keeps the package's pieces exactly as they were.
  const customPieces = (pieceLight === DEFAULT_PIECE_LIGHT && pieceDark === DEFAULT_PIECE_DARK)
    ? undefined
    : pieceSet(pieceLight, pieceDark);

  const styles = useMemo(() => {
    let out = customSquareStyles;

    // Where the move came from and where it went, the way chess.com marks it.
    // Underneath everything else, so a hint or a selection still reads on top.
    if (markLast && lastMove?.from && lastMove?.to) {
      out = {
        [lastMove.from]: { ...LAST_MOVE_STYLE },
        [lastMove.to]: { ...LAST_MOVE_STYLE },
        ...out,
      };
    }

    // A coach's badge on the move that was just played — the same "landed on
    // this square" spot the last-move wash uses, so the two combine rather
    // than compete: the badge's own colour replaces the plain yellow tint,
    // and its glyph sits over the corner. Precedence is against the CALLER's
    // own style for that square specifically (a live "wrong move" flash, a
    // picked-square highlight) — not against `out`, which by this point
    // already has the plain last-move wash folded in and would make the
    // badge look like it's losing to a decoration it's meant to replace.
    if (markBadge && badge && lastMove?.to) {
      const badgeStyle = boardBadgeStyle(badge);
      const callerStyle = customSquareStyles?.[lastMove.to];
      if (badgeStyle) out = { ...out, [lastMove.to]: { ...badgeStyle, ...(callerStyle ?? {}) } };
    }

    if (markCheck && typeof position === 'string') {
      let square = null;
      try { square = checkedKingSquare(new Chess(position)); } catch { square = null; }
      // Anything the caller put on that square stays on top of the glow.
      if (square) out = { ...out, [square]: { ...CHECK_STYLE, ...(out?.[square] ?? {}) } };
    }

    // Drawn just now, so on top.
    for (const [sq, color] of Object.entries(drawing.squares)) {
      out = { ...out, [sq]: highlightStyle(out?.[sq], color, profile) };
    }
    return out;
  }, [markCheck, markLast, markBadge, lastMove?.from, lastMove?.to, badge, position, customSquareStyles, drawing.squares, profile]);

  const sized = typeof rest.boardWidth === 'number';
  const orientation = rest.boardOrientation === 'black' ? 'black' : 'white';
  // Uptown Express's coordinates are line signs (LineSigns above), on any
  // board with a size to draw them at; the board's own step aside for them.
  const lineSigns = sized && rest.showBoardNotation !== false && skinId(state.settings) === 'uptown';
  const signs = lineSigns ? <LineSigns boardWidth={rest.boardWidth} orientation={orientation} /> : null;

  const board = (
    <Chessboard
      {...BOARD_THEME}
      customLightSquareStyle={{ backgroundColor: squareLight }}
      customDarkSquareStyle={{ backgroundColor: squareDark }}
      customPieces={customPieces}
      customNotationStyle={NOTATION_STYLE}
      areArrowsAllowed={false}
      {...dndProps}
      position={position}
      customSquareStyles={styles}
      {...rest}
      {...(lineSigns ? { showBoardNotation: false } : {})}
    />
  );

  // Nothing to draw on: a board with no width of its own (the piece editor,
  // the theme preview in Settings) can't host a correctly sized overlay, and
  // wouldn't want arrows anyway.
  const drawn = (!ownArrows || !sized) ? board : (
    <DrawableBoard
      boardWidth={rest.boardWidth}
      orientation={orientation}
      position={position}
      marks={marks}
      settings={state.settings}
      profile={profile}
      drawing={drawing}
      setDrawing={setDrawing}
    >
      {board}
      {signs}
    </DrawableBoard>
  );
  // A board without the arrow layer carries the signs itself.
  const ownSigns = !ownArrows && signs;
  if (!sized || !telestrator) {
    return ownSigns
      ? <div className="line-sign-host" style={{ position: 'relative', width: rest.boardWidth, height: rest.boardWidth }}>{drawn}{signs}</div>
      : drawn;
  }

  // The telestrator's ink (components/Telestrator.jsx) sits over every sized
  // board; it's invisible and lets everything through until it's switched on.
  return (
    <div className="tele-host" style={{ position: 'relative', width: rest.boardWidth, height: rest.boardWidth }}>
      {drawn}
      {ownSigns}
      <TelestratorLayer
        boardWidth={rest.boardWidth}
        orientation={orientation}
        positionKey={typeof position === 'string' ? position : JSON.stringify(position ?? '')}
      />
    </div>
  );
}

// Right-drag to draw an arrow, right-drag the same pair again to take it away;
// right-click one square to highlight it; left-click the board to clear the
// lot — the gestures everyone already knows from lichess and chess.com. In
// the pen you've set as the default (Settings), or whichever pen's key is
// held: the analysis board's keys, so a red arrow and a green one, or squares
// in two colours, sit side by side. Kept here rather than in each view so
// Practice, Learn and the line viewer get it too; Analysis opts out, having
// its own pen with saved marks.
//
// `marks` turns it into a place to draw ones that are kept — a line's arrows,
// saved on its moves: { arrows (the saved ones, drawn), pen (colour of the
// one being drawn), onArrow(from, to, held), onSquare(sq, held), tapToDraw }
// — `held` the colour of a pen key held, or null. Then a right-drag gives
// onArrow, a right-click on one square onSquare, and with `tapToDraw` (a
// touch screen has no right button) a tap on one square and then another is
// an arrow, the same square twice a highlight.
function DrawableBoard({
  boardWidth, orientation, position, marks, settings, profile, drawing, setDrawing, children,
}) {
  const [pending, setPending] = useState(null); // { from, to, color } while dragging
  const [tapFrom, setTapFrom] = useState(null); // tap-to-draw: the first square
  // A finger down in tap-to-draw: { id, sq, x, y }. It counts as a tap when it
  // lifts where it landed — a scroll or a pinch that starts on the board
  // draws nothing.
  const tapRef = useRef(null);
  const editing = Boolean(marks?.onArrow);
  useEffect(watchPenKeys, []);
  const restPen = editing ? (marks.pen ?? defaultPen(settings).value) : defaultPen(settings).value;
  const optsFor = (e) => ({
    held: heldPen(settings, e), pen: restPen, profile, fen: fenOf(position),
  });
  // The colour the arrow following the pointer will be drawn in.
  const colorNow = (e, from, to) => {
    const o = optsFor(e);
    if (editing || from === to) return o.held ?? restPen;
    return colorOfNext(drawing, from, to, o) ?? o.held ?? restPen;
  };
  const hasDrawing = drawing.arrows.length > 0 || Object.keys(drawing.squares).length > 0;

  // A new position means the drawing was about the old one.
  useEffect(() => {
    setDrawing((d) => (d.arrows.length || Object.keys(d.squares).length ? NO_DRAWING : d));
    setPending(null);
    setTapFrom(null);
  }, [position]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!marks?.tapToDraw) setTapFrom(null); }, [marks?.tapToDraw]);

  const onPointerDown = (e) => {
    if (e.button === 2) {
      const from = squareAtPoint(e.clientX, e.clientY);
      if (from) { e.preventDefault(); setPending({ from, to: from, color: colorNow(e, from, from) }); }
    } else if (e.button === 0 && editing && marks.tapToDraw) {
      // A second finger makes it a pinch, not a tap.
      if (!e.isPrimary) { tapRef.current = null; return; }
      const sq = squareAtPoint(e.clientX, e.clientY);
      if (!sq) return;
      e.preventDefault();
      tapRef.current = { id: e.pointerId, sq, x: e.clientX, y: e.clientY };
    } else if (e.button === 0 && hasDrawing) {
      setDrawing(NO_DRAWING);
    }
  };

  const onPointerMove = (e) => {
    const t = tapRef.current;
    if (t && t.id === e.pointerId && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) tapRef.current = null;
    if (!pending) return;
    const to = squareAtPoint(e.clientX, e.clientY) ?? pending.to;
    const color = colorNow(e, pending.from, to);
    if (to !== pending.to || color !== pending.color) setPending((p) => ({ ...p, to, color }));
  };

  const onPointerUp = (e) => {
    const t = tapRef.current;
    tapRef.current = null;
    if (t && t.id === e.pointerId && editing && marks.tapToDraw
      && squareAtPoint(e.clientX, e.clientY) === t.sq) {
      if (!tapFrom) { setTapFrom(t.sq); return; }
      setTapFrom(null);
      if (t.sq === tapFrom) marks.onSquare(t.sq, heldPen(settings, e));
      else marks.onArrow(tapFrom, t.sq, heldPen(settings, e));
      return;
    }
    if (!pending) return;
    const to = squareAtPoint(e.clientX, e.clientY) ?? pending.to;
    const { from } = pending;
    setPending(null);
    if (editing) {
      if (to && to !== from) marks.onArrow(from, to, heldPen(settings, e));
      else if (from) marks.onSquare(from, heldPen(settings, e));
      return;
    }
    if (!from || !to) return;
    // The same mark again takes it off; in another colour, recolours it —
    // the others stay.
    const o = optsFor(e);
    setDrawing((d) => (to === from ? drawSquare(d, from, o) : drawArrow(d, from, to, o)));
  };

  const live = pending && pending.to !== pending.from
    ? [[pending.from, pending.to, pending.color]]
    : [];
  const pen = restPen;
  const size = boardWidth / 8;
  const tapCell = tapFrom ? cell(tapFrom, orientation) : null;

  return (
    <div
      className="board-draw-host"
      style={{ position: 'relative', width: boardWidth, height: boardWidth }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { setPending(null); tapRef.current = null; }}
      onPointerCancel={() => { setPending(null); tapRef.current = null; }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      <BoardArrows
        arrows={[...(marks?.arrows ?? []), ...drawing.arrows, ...live]}
        boardWidth={boardWidth}
        orientation={orientation}
        halo={profile !== 'default'}
      />
      {tapCell && (
        <div
          className="draw-tap-from"
          style={{
            left: tapCell.x * size, top: tapCell.y * size, width: size, height: size, borderColor: pen,
          }}
        />
      )}
    </div>
  );
}

export { BOARD_THEME };
