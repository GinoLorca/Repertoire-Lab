import React from 'react';
import { squareCell } from '../lib/legalMoves';

// Where a picked piece can go, drawn as an overlay *above* the arrows.
//
// These used to be square backgrounds, which put them underneath any arrow on
// the board: the dot showed through the shaft as a second, offset circle. On
// top, a dot is always one crisp dot.
export default function LegalDots({ game, square, boardWidth, orientation }) {
  if (!game || !square || !boardWidth) return null;
  let moves = [];
  try { moves = game.moves({ square, verbose: true }); } catch { return null; }
  if (moves.length === 0) return null;
  // A promotion offers four SAN variants (=Q/=R/=B/=N) landing on the same
  // square — one dot per destination, not one per variant.
  moves = [...new Map(moves.map((mv) => [mv.to, mv])).values()];

  const size = boardWidth / 8;
  return (
    <svg
      width={boardWidth}
      height={boardWidth}
      viewBox={`0 0 ${boardWidth} ${boardWidth}`}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11 }}
    >
      {moves.map((mv) => {
        const c = squareCell(mv.to, orientation);
        const cx = (c.x + 0.5) * size;
        const cy = (c.y + 0.5) * size;
        // A ring around something you can take, a dot on an empty square.
        return mv.captured ? (
          <circle
            key={mv.to}
            cx={cx}
            cy={cy}
            r={size * 0.42}
            fill="none"
            stroke="rgba(20, 23, 29, 0.32)"
            strokeWidth={size * 0.11}
          />
        ) : (
          <circle key={mv.to} cx={cx} cy={cy} r={size * 0.16} fill="rgba(20, 23, 29, 0.34)" />
        );
      })}
    </svg>
  );
}
