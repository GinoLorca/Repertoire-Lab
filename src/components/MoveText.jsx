import React from 'react';
import MoveBadge from './MoveBadge';
import { useStore } from '../store';

// Render a SAN move list with move numbers, optionally clickable/highlightable.
// Moves that carry a comment get a dotted underline and a hover tooltip; a move
// the coach has badged carries its glyph, unless Settings has turned that off.
export default function MoveText({ moves, comments, badges, currentIndex = -1, onClickMove }) {
  const { state } = useStore();
  const showBadges = state.settings.showMoveListBadges !== false;
  return (
    <>
      {moves.map((san, i) => (
        <span key={i}>
          {i % 2 === 0 && <span className="mvnum">{i / 2 + 1}.</span>}
          <span
            className={`mv${i === currentIndex ? ' current' : ''}${comments?.[i] ? ' has-comment' : ''}`}
            title={comments?.[i] || undefined}
            onClick={onClickMove ? () => onClickMove(i) : undefined}
          >
            {san}
            {showBadges && badges?.[i] && <MoveBadge id={badges[i]} size={13} />}
          </span>{' '}
        </span>
      ))}
    </>
  );
}
