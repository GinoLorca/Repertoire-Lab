import React, { useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import { TouchBackend } from 'react-dnd-touch-backend';
import { Chess } from 'chess.js';
import { useStore } from '../store';
import { checkedKingSquare, CHECK_STYLE, LAST_MOVE_STYLE } from '../lib/legalMoves';
import { makePieces, DEFAULT_PIECE_LIGHT, DEFAULT_PIECE_DARK } from '../lib/pieces';
import { boardBadgeStyle } from '../lib/badges';

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
const isTouchCapable = typeof window !== 'undefined' && 'ontouchstart' in window;
const dndProps = isTouchCapable
  ? {
    customDndBackend: TouchBackend,
    customDndBackendOptions: { enableMouseEvents: true, delayTouchStart: 0 },
  }
  : {};

// Shared board: consistent theme, input handling that works with a mouse, a
// trackpad and a touchscreen, and the king in check marked in red wherever a
// board appears — analysis, practice, compare, the line viewer.
export default function Board({ position, customSquareStyles, lastMove, badge, ...rest }) {
  const { state } = useStore();
  const markCheck = state.settings.checkHighlight !== false;
  const markLast = state.settings.lastMoveHighlight !== false;
  const markBadge = state.settings.showBoardBadges !== false;

  const squareLight = state.settings.squareLight ?? DEFAULT_SQUARE_LIGHT;
  const squareDark = state.settings.squareDark ?? DEFAULT_SQUARE_DARK;
  const pieceLight = state.settings.pieceLight ?? DEFAULT_PIECE_LIGHT;
  const pieceDark = state.settings.pieceDark ?? DEFAULT_PIECE_DARK;
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

  return (
    <Chessboard
      {...BOARD_THEME}
      customLightSquareStyle={{ backgroundColor: squareLight }}
      customDarkSquareStyle={{ backgroundColor: squareDark }}
      customPieces={customPieces}
      {...dndProps}
      position={position}
      customSquareStyles={styles}
      {...rest}
    />
  );
}

export { BOARD_THEME };
