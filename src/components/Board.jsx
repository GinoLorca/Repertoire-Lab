import React, { useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import { TouchBackend } from 'react-dnd-touch-backend';
import { Chess } from 'chess.js';
import { useStore } from '../store';
import { checkedKingSquare, CHECK_STYLE, LAST_MOVE_STYLE } from '../lib/legalMoves';

const BOARD_THEME = {
  customDarkSquareStyle: { backgroundColor: '#4a6a8f' },
  customLightSquareStyle: { backgroundColor: '#c6d3e1' },
};

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
export default function Board({ position, customSquareStyles, lastMove, ...rest }) {
  const { state } = useStore();
  const markCheck = state.settings.checkHighlight !== false;
  const markLast = state.settings.lastMoveHighlight !== false;

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

    if (markCheck && typeof position === 'string') {
      let square = null;
      try { square = checkedKingSquare(new Chess(position)); } catch { square = null; }
      // Anything the caller put on that square stays on top of the glow.
      if (square) out = { ...out, [square]: { ...CHECK_STYLE, ...(out?.[square] ?? {}) } };
    }
    return out;
  }, [markCheck, markLast, lastMove?.from, lastMove?.to, position, customSquareStyles]);

  return (
    <Chessboard
      {...BOARD_THEME}
      {...dndProps}
      position={position}
      customSquareStyles={styles}
      {...rest}
    />
  );
}

export { BOARD_THEME };
