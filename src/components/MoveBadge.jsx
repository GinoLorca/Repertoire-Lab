import React from 'react';
import { BADGE_BY_ID } from '../lib/badges';

// The glyph that rides on a move. Small enough to sit inside a move list
// without breaking its rhythm, readable enough to spot while scanning one.
export default function MoveBadge({ id, size = 15, title }) {
  const badge = BADGE_BY_ID[id];
  if (!badge) return null;
  return (
    <span
      className="move-badge"
      title={title ?? badge.label}
      style={{ background: badge.color, width: size, height: size, fontSize: size * 0.62 }}
    >
      {badge.symbol}
    </span>
  );
}
