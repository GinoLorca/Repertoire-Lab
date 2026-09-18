import React, { useEffect } from 'react';
import { useStore } from '../store';
import { squareCell } from '../lib/legalMoves';
import { makePieces, DEFAULT_PIECE_LIGHT, DEFAULT_PIECE_DARK } from '../lib/pieces';
import { boardColors } from '../lib/theme';
import { DEFAULT_SQUARE_LIGHT, DEFAULT_SQUARE_DARK } from './Board';

const pieceCache = new Map();
function pieceSet(light, dark) {
  const key = `${light}|${dark}`;
  if (!pieceCache.has(key)) pieceCache.set(key, makePieces(light, dark));
  return pieceCache.get(key);
}

// Queen first — nearest the pawn's own square, since that's what almost
// every promotion actually wants — then the underpromotion options.
const OPTIONS = [
  { code: 'Q', title: 'Queen' },
  { code: 'N', title: 'Knight' },
  { code: 'R', title: 'Rook' },
  { code: 'B', title: 'Bishop' },
];

// A small popover of piece choices, anchored to the square a pawn just
// reached. Drawn toward the centre of the board — down from the 8th rank,
// up from the 1st — so it stays on the board no matter which way it's
// facing, with a full-board scrim behind it so a tap anywhere else cancels
// the promotion and leaves the pawn where it was.
export default function PromotionPicker({
  square, color, boardWidth, orientation, onPick, onCancel,
}) {
  const { state } = useStore();

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  if (!square || !boardWidth) return null;

  // Same source as the board underneath it — see boardColors in lib/theme.
  const chosen = boardColors(state.settings);
  const squareLight = chosen.squareLight ?? DEFAULT_SQUARE_LIGHT;
  const squareDark = chosen.squareDark ?? DEFAULT_SQUARE_DARK;
  const pieceLight = chosen.pieceLight ?? DEFAULT_PIECE_LIGHT;
  const pieceDark = chosen.pieceDark ?? DEFAULT_PIECE_DARK;
  const pieces = pieceSet(pieceLight, pieceDark);

  const size = boardWidth / 8;
  const cell = squareCell(square, orientation);
  const growingDown = cell.y === 0;
  const ordered = growingDown ? OPTIONS : [...OPTIONS].reverse();

  return (
    <>
      <div className="promotion-scrim" onClick={onCancel} />
      <div
        className="promotion-picker"
        style={{
          left: cell.x * size,
          top: (growingDown ? cell.y : cell.y - 3) * size,
          width: size,
        }}
      >
        {ordered.map(({ code, title }, i) => (
          <button
            key={code}
            type="button"
            className="promotion-option"
            style={{ width: size, height: size, background: i % 2 === 0 ? squareLight : squareDark }}
            title={title}
            onClick={() => onPick(code.toLowerCase())}
          >
            {pieces[`${color}${code}`]?.({ squareWidth: size * 0.86 })}
          </button>
        ))}
      </div>
    </>
  );
}
