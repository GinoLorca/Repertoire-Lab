import React, { useEffect, useMemo, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { TouchBackend } from 'react-dnd-touch-backend';
import { Chess } from 'chess.js';
import { useStore } from '../store';
import { checkedKingSquare, CHECK_STYLE, LAST_MOVE_STYLE } from '../lib/legalMoves';
import { makePieces, DEFAULT_PIECE_LIGHT, DEFAULT_PIECE_DARK } from '../lib/pieces';
import { boardBadgeStyle } from '../lib/badges';
import { boardColors } from '../lib/theme';
import BoardArrows from './BoardArrows';

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

// The pen for arrows drawn straight onto a board with a right-drag. Matches
// BoardArrows' own default and the amber pen in Analysis.
const RIGHT_DRAG_PEN = '#e8b339';

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
  position, customSquareStyles, lastMove, badge, ownArrows = true, ...rest
}) {
  const { state } = useStore();
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
    return out;
  }, [markCheck, markLast, markBadge, lastMove?.from, lastMove?.to, badge, position, customSquareStyles]);

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
    />
  );

  // Nothing to draw on: a board with no width of its own (the piece editor,
  // the theme preview in Settings) can't host a correctly sized overlay, and
  // wouldn't want arrows anyway.
  if (!ownArrows || typeof rest.boardWidth !== 'number') return board;

  return (
    <DrawableBoard
      boardWidth={rest.boardWidth}
      orientation={rest.boardOrientation === 'black' ? 'black' : 'white'}
      position={position}
    >
      {board}
    </DrawableBoard>
  );
}

// Right-drag to draw an arrow, right-drag the same pair again to take it away,
// left-click anywhere to clear the lot — the gesture everyone already knows
// from lichess and chess.com. Kept here rather than in each view so Practice,
// Learn and the line viewer get it too; Analysis opts out, having its own pen
// with colours and saved marks.
function DrawableBoard({ boardWidth, orientation, position, children }) {
  const [arrows, setArrows] = useState([]);
  const [pending, setPending] = useState(null); // { from, to } while dragging

  // A new position means the arrows were about the old one.
  useEffect(() => { setArrows([]); setPending(null); }, [position]);

  const onPointerDown = (e) => {
    if (e.button === 2) {
      const from = squareAtPoint(e.clientX, e.clientY);
      if (from) { e.preventDefault(); setPending({ from, to: from }); }
    } else if (e.button === 0 && arrows.length) {
      setArrows([]);
    }
  };

  const onPointerMove = (e) => {
    if (!pending) return;
    const to = squareAtPoint(e.clientX, e.clientY);
    if (to && to !== pending.to) setPending((p) => ({ ...p, to }));
  };

  const onPointerUp = (e) => {
    if (!pending) return;
    const to = squareAtPoint(e.clientX, e.clientY) ?? pending.to;
    const { from } = pending;
    setPending(null);
    if (!to || to === from) return;
    setArrows((list) => (list.some(([f, t]) => f === from && t === to)
      ? list.filter(([f, t]) => !(f === from && t === to))
      : [...list, [from, to, RIGHT_DRAG_PEN]]));
  };

  const live = pending && pending.to !== pending.from
    ? [[pending.from, pending.to, RIGHT_DRAG_PEN]]
    : [];

  return (
    <div
      className="board-draw-host"
      style={{ position: 'relative', width: boardWidth, height: boardWidth }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setPending(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      <BoardArrows arrows={[...arrows, ...live]} boardWidth={boardWidth} orientation={orientation} />
    </div>
  );
}

export { BOARD_THEME };
