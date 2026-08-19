import React from 'react';
import { CommentIcon } from './Icons';
import MoveBadge from './MoveBadge';
import { useStore } from '../store';

// "4." for White's move, "4…" for Black's, from a 0-based move index.
const label = (i) => `${Math.floor(i / 2) + 1}${i % 2 === 0 ? '.' : '…'}`;

// The author's note on a move, shown as its own block with the move it belongs
// to. A course's comments are the teaching — they shouldn't be a tooltip.
//
// `index` is the move the note belongs to (0-based). `stale` dims a note that
// belongs to an earlier move, so you can still read it while you play on.
// `badgeId` puts that move's glyph right next to its label — the same
// judgement the board itself is showing on the square, repeated here in
// words.
export default function MoveNote({ text, san, index, stale, highlight, badgeId }) {
  const { state } = useStore();
  const showBadges = state.settings.showMoveListBadges !== false;
  if (!text) return null;
  return (
    <div className={`move-note${stale ? ' stale' : ''}${highlight ? ' called-out' : ''}`}>
      <span className="mn-move">
        <CommentIcon size={13} />
        {index != null && <strong>{label(index)}{san}</strong>}
        {showBadges && badgeId && <MoveBadge id={badgeId} size={14} />}
      </span>
      <p>{text}</p>
    </div>
  );
}

// The note to show for a position: the current move's, or the most recent one
// before it so the last thing the author said stays on screen.
export function noteFor(comments, moves, ply) {
  if (!comments || ply <= 0) return null;
  for (let i = ply - 1; i >= 0; i -= 1) {
    if (comments[i]) {
      return { text: comments[i], san: moves[i], index: i, stale: i !== ply - 1 };
    }
  }
  return null;
}
