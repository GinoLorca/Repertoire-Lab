import React from 'react';

// Solid glyphs for both sides, coloured rather than outlined — they read well
// at thumbnail size and cost nothing to render.
const GLYPH = {
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚',
};

function squaresFromFen(fen) {
  const placement = (fen ?? '').split(' ')[0] ?? '';
  const rows = placement.split('/');
  const grid = [];
  for (const row of rows) {
    const cells = [];
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i += 1) cells.push(null);
      } else {
        cells.push({ glyph: GLYPH[ch.toLowerCase()] ?? '', white: ch === ch.toUpperCase() });
      }
    }
    grid.push(cells);
  }
  return grid;
}

// A small static board — the position a game finished in, chess.com style.
export default function MiniBoard({ fen, size = 104, orientation = 'white', title }) {
  const grid = squaresFromFen(fen);
  const rows = orientation === 'black' ? [...grid].reverse() : grid;
  const cells = [];
  rows.forEach((row, y) => {
    const line = orientation === 'black' ? [...row].reverse() : row;
    line.forEach((piece, x) => {
      const dark = (x + y) % 2 === 1;
      cells.push(
        <span key={`${x}-${y}`} className={`mb-sq${dark ? ' dark' : ''}`}>
          {piece && (
            <span className={`mb-piece${piece.white ? ' white' : ' black'}`}>{piece.glyph}</span>
          )}
        </span>,
      );
    });
  });

  return (
    <div
      className="mini-board"
      title={title}
      style={{ width: size, height: size, fontSize: size / 9.5 }}
    >
      {cells}
    </div>
  );
}
