import React from 'react';
import { squareCell } from '../lib/legalMoves';
import { quietPip, suitOf, pieceCode } from '../lib/suitMarks';
import { usePressed } from '../lib/usePressed';
import { shownPick } from '../lib/pressed';

// Where a picked piece can go, drawn as an overlay *above* the arrows.
//
// These used to be square backgrounds, which put them underneath any arrow on
// the board: the dot showed through the shaft as a second, offset circle. On
// top, a dot is always one crisp dot.
//
// Court Cards hands in its pick (`suitPick`, lib/suitMarks.js) and gets the
// moving piece's suit instead: a pip on each quiet move, here; a capture's
// corner pips are on the square itself, under the piece (Board). Without it,
// every other theme, the dots and rings are exactly as they always were.
//
// `boardId`: the board these are on. With it, a piece's moves are shown the
// instant it's pressed (lib/pressed), not when the view has heard of the
// pick: this part redraws by itself for a press, where the view's whole
// screen would be felt. `suited`: Court Cards is the theme (a press has no
// `suitPick` from the view yet; the suit is read off the piece), and
// `pieceSet` the set the board draws (the Card Crown set prints its own suits).
export default function LegalDots({
  game, square: picked, boardWidth, orientation, suitPick: viewPick = null, boardId = null, suited = false, pieceSet = null,
}) {
  const pressed = usePressed(boardId);
  const square = shownPick(pressed, picked);
  // The view's pick is of the square it has picked: a press on another piece
  // (or before any pick) names its own.
  const suitPick = pressed && pressed !== viewPick?.square
    ? (suited && pieceCode(game, pressed) ? { code: pieceCode(game, pressed), square: pressed, set: pieceSet } : null)
    : viewPick;
  if (!game || !square || !boardWidth) return null;
  let moves = [];
  try { moves = game.moves({ square, verbose: true }); } catch { return null; }
  if (moves.length === 0) return null;
  // A promotion offers four SAN variants (=Q/=R/=B/=N) landing on the same
  // square — one dot per destination, not one per variant.
  moves = [...new Map(moves.map((mv) => [mv.to, mv])).values()];

  const size = boardWidth / 8;
  const suit = suitOf(suitPick?.code, suitPick?.set);
  if (suit) {
    const quiet = moves.filter((mv) => !mv.captured);
    if (quiet.length === 0) return null;
    return (
      <svg
        className="legal-dots suited"
        width={boardWidth}
        height={boardWidth}
        viewBox={`0 0 ${boardWidth} ${boardWidth}`}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11 }}
      >
        <g className={`ld-pips ${suitPick.code[0]}`}>
          {quiet.map((mv) => {
            const c = squareCell(mv.to, orientation);
            const pip = quietPip(suit, size, (c.x + 0.5) * size, (c.y + 0.5) * size);
            return (
              <g key={mv.to} transform={pip.transform}>
                <path className="ld-halo" d={pip.d} strokeWidth={pip.halo} />
                <path className={pip.star ? 'ld-ink star' : 'ld-ink'} d={pip.d} />
              </g>
            );
          })}
        </g>
      </svg>
    );
  }
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
            strokeWidth={size * 0.11}
            style={{ stroke: 'var(--legal-ring, rgba(20, 23, 29, 0.32))' }}
          />
        ) : (
          <circle
            key={mv.to}
            cx={cx}
            cy={cy}
            r={size * 0.16}
            strokeWidth={size * 0.05}
            style={{ fill: 'var(--legal-dot, rgba(20, 23, 29, 0.34))', stroke: 'var(--legal-dot-edge, none)' }}
          />
        );
      })}
    </svg>
  );
}
