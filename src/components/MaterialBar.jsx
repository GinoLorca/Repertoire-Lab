import React from 'react';

// Same solid-glyph-tinted-by-CSS trick as MiniBoard, at icon size.
const GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };

// One side's captured-material readout: the opponent's pieces taken so far
// (shown in the captured piece's own colour, not this side's) and, only when
// this side is ahead on points, the lead — chess.com's material bar.
export default function MaterialBar({ pieces, capturedColor, advantage, style }) {
  // Always rendered, even empty — reserving its height so the board doesn't
  // jump down the moment the first piece is taken.
  return (
    <div className="material-bar" style={style}>
      {pieces.map((p, i) => (
        <span key={i} className={`material-piece ${capturedColor}`}>{GLYPH[p]}</span>
      ))}
      {advantage > 0 && <span className="material-adv">+{advantage}</span>}
    </div>
  );
}
