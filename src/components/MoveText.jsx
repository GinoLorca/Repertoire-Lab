import React from 'react';

// Render a SAN move list with move numbers, optionally clickable/highlightable.
// Moves that carry a comment get a dotted underline and a hover tooltip.
export default function MoveText({ moves, comments, currentIndex = -1, onClickMove }) {
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
          </span>{' '}
        </span>
      ))}
    </>
  );
}
