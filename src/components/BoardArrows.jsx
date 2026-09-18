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

  // Proportions lifted from chess.com's own arrow polygons, in square-units:
  // a slim shaft, a modest head, the tip landing dead on the target square's
  // centre and the tail starting well clear of the piece it comes from.
  const shaft = size * 0.22;    // thickness of the line
  const headLen = size * 0.36;  // length of the arrowhead
  const headHalf = size * 0.26; // half-width of the arrowhead
  const tailInset = size * 0.36; // how far up the first leg the shaft begins

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

        // Walk the tail up the *first* leg — the one leaving the origin — so
        // the arrow clears the piece it starts from without shifting the bend.
        const legTo = corner ?? end;
        const tx = legTo.x - start.x;
        const ty = legTo.y - start.y;
        const tlen = Math.hypot(tx, ty) || 1;
        const tailX = start.x + (tx / tlen) * tailInset;
        const tailY = start.y + (ty / tlen) * tailInset;

        // The tip sits on the target's centre; the shaft stops where the head
        // begins.
        const baseX = end.x - ux * headLen;
        const baseY = end.y - uy * headLen;
        const px = -uy;
        const py = ux;

        const points = corner
          ? `${tailX},${tailY} ${corner.x},${corner.y} ${baseX},${baseY}`
          : `${tailX},${tailY} ${baseX},${baseY}`;

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
              points={`${end.x},${end.y} ${baseX + px * headHalf},${baseY + py * headHalf} ${baseX - px * headHalf},${baseY - py * headHalf}`}
              fill={stroke}
            />
          </g>
        );
      })}
    </svg>
  );
}
