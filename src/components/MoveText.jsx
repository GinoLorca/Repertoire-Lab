import React from 'react';
import MoveBadge from './MoveBadge';
import { useStore } from '../store';
import { parseMarks } from '../lib/studyText';
import { isWhiteMove, moveNumberOf } from '../lib/startPos';

// Render a SAN move list with move numbers, optionally clickable/highlightable.
// Moves that carry a comment get a dotted underline and a hover tooltip; a move
// the coach has badged carries its glyph, unless Settings has turned that off.
// `startFen`: a line set up from a position is numbered from there — Black's
// first move at move 12 reads "12… Nf6 13.Bd3".
export default function MoveText({
  moves, comments, badges, currentIndex = -1, onClickMove, startFen,
}) {
  const { state } = useStore();
  const showBadges = state.settings.showMoveListBadges !== false;
  return (
    <>
      {moves.map((san, i) => {
        // What a reader would read: [%cal]-style arrow codes aren't that.
        const note = comments?.[i] ? parseMarks(comments[i]).text : '';
        return (
        <span key={i}>
          {isWhiteMove(i, startFen)
            ? <span className="mvnum">{moveNumberOf(i, startFen)}.</span>
            : i === 0 && <span className="mvnum">{moveNumberOf(i, startFen)}…</span>}
          <span
            className={`mv${i === currentIndex ? ' current' : ''}${note ? ' has-comment' : ''}`}
            title={note || undefined}
            onClick={onClickMove ? () => onClickMove(i) : undefined}
          >
            {san}
            {showBadges && badges?.[i] && <MoveBadge id={badges[i]} size={13} />}
          </span>{' '}
        </span>
        );
      })}
    </>
  );
}
