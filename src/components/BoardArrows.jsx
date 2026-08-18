import React from 'react';

// Square name -> board coordinates in "cells from the top-left", honouring
// which way the board is facing.
function cell(square, orientation) {
  const file = square.charCodeAt(0) - 97;        // a..h -> 0..7
  const rank = Number(square[1]) - 1;            // 1..8 -> 0..7
  return orientation === 'white'
    ? { x: file, y: 7 - rank }
    : { x: 7 - file, y: rank };
}

const isKnightHop = (dx, dy) => {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return (ax === 1 && ay === 2) || (ax === 2 && ay === 1);
};

// Arrow overlay drawn on top of the board. Knight moves bend at a right angle
// the way chess.com draws them, instead of cutting across diagonally.
export default function BoardArrows({ arrows, boardWidth, orientation }) {
  if (!arrows?.length || !boardWidth) return null;
  const size = boardWidth / 8;
  const centre = (c) => ({ x: (c.x + 0.5) * size, y: (c.y + 0.5) * size });

  const shaft = size * 0.26;   // thickness of the line
  const headLen = size * 0.44; // length of the arrowhead
  const headHalf = size * 0.34; // half-width of the arrowhead

  return (
    <svg
      width={boardWidth}
      height={boardWidth}
      viewBox={`0 0 ${boardWidth} ${boardWidth}`}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10 }}
    >
      {arrows.map(([from, to, color], i) => {
        const a = cell(from, orientation);
        const b = cell(to, orientation);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (dx === 0 && dy === 0) return null;

        const start = centre(a);
        const end = centre(b);
        const stroke = color || '#e8b339';

        // The corner for an L-shaped knight arrow: travel the long leg first,
        // then turn — matching how the move actually reads on the board.
        let corner = null;
        if (isKnightHop(dx, dy)) {
          corner = Math.abs(dy) > Math.abs(dx)
            ? centre({ x: a.x, y: b.y })   // two squares vertically, then across
            : centre({ x: b.x, y: a.y });  // two squares across, then vertically
        }

        // Direction of the final leg, so the head sits square on the target.
        const legFrom = corner ?? start;
        const vx = end.x - legFrom.x;
        const vy = end.y - legFrom.y;
        const len = Math.hypot(vx, vy) || 1;
        const ux = vx / len;
        const uy = vy / len;

        // Stop the shaft where the head begins, and inset the tail slightly so
        // the arrow doesn't smother the piece it starts from.
        const tipX = end.x - ux * (size * 0.08);
        const tipY = end.y - uy * (size * 0.08);
        const baseX = tipX - ux * headLen;
        const baseY = tipY - uy * headLen;
        const px = -uy;
        const py = ux;

        const points = corner
          ? `${start.x},${start.y} ${corner.x},${corner.y} ${baseX},${baseY}`
          : `${start.x},${start.y} ${baseX},${baseY}`;

        return (
          <g key={`${from}-${to}-${i}`} opacity="0.85">
            <polyline
              points={points}
              fill="none"
              stroke={stroke}
              strokeWidth={shaft}
              strokeLinecap="butt"
              strokeLinejoin="miter"
            />
            <polygon
              points={`${tipX},${tipY} ${baseX + px * headHalf},${baseY + py * headHalf} ${baseX - px * headHalf},${baseY - py * headHalf}`}
              fill={stroke}
            />
          </g>
        );
      })}
    </svg>
  );
}
