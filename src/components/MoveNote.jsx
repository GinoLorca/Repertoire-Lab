import React, { useMemo } from 'react';
import { CommentIcon } from './Icons';
import MoveBadge from './MoveBadge';
import { useStore } from '../store';

// "4." for White's move, "4…" for Black's, from a 0-based move index.
const label = (i) => `${Math.floor(i / 2) + 1}${i % 2 === 0 ? '.' : '…'}`;

// A numbered move — "4.e3", "9...Bf5", "5.exd4" — the clearest kind of move
// reference, tied to an exact ply. Castling has no [a-h][1-8] of its own, so
// it's spelled out rather than matched through the piece/square shape.
const MOVE_RE = /\d+\.{1,3}\s*(?:O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)/g;
// A piece actually moving, written without a move number — "Qh4", "Bxc3",
// bare castling, or the informal "Bf4-e3" arrow shorthand a course write-up
// uses for "this bishop goes here next". The leading piece letter is what
// tells this apart from a bare square: a pawn move has no letter of its own,
// so an unnumbered one ("just push e3") reads the same as someone merely
// naming a square and falls through to SQUARE_RE below instead.
const PIECE_MOVE_RE = /\b(?:O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?(?:-[a-h][1-8])?)\b/g;
// A pawn capture, written bare — "cxd4", "gxh5" — has no piece letter of its
// own (pawns never get one in SAN), but the file-letter-then-x shape is
// unambiguous: nobody writes "cxd4" to mean anything other than a pawn
// capturing on d4, unlike a bare "e3" which really could just be someone
// naming the square. That "x" is what earns it the same link treatment as
// PIECE_MOVE_RE above rather than falling through to SQUARE_RE below.
const PAWN_CAPTURE_RE = /\b[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?\b/g;
// A bare square on its own — "on c3", "check on a5" — gets weight (bold) but
// isn't a specific move, so it isn't a link. Word-bounded so it doesn't also
// catch the destination square already claimed by a move match above ("Bf5"'s
// "f5" only counts once, as part of the move, not a second time on its own).
const SQUARE_RE = /\b[a-h][1-8]\b/g;

// Which square a move reference actually points at, for the click handler —
// the last [a-h][1-8] in the SAN is always the destination, whatever piece
// moved there or however it got disambiguated. Castling has no such pair, so
// it's resolved from which side the king castles and — since "." is White's
// move and "..." is Black's in standard notation — whose move this is.
function destSquareFor(moveText) {
  const isWhite = !moveText.includes('...');
  const san = moveText.replace(/^\d+\.+\s*/, '');
  if (san === 'O-O') return isWhite ? 'g1' : 'g8';
  if (san === 'O-O-O') return isWhite ? 'c1' : 'c8';
  const squares = san.match(/[a-h][1-8]/g);
  return squares ? squares[squares.length - 1] : null;
}

// All four patterns' matches, merged into one ordered, non-overlapping list,
// numbered moves first — most specific, so a later pattern's match that falls
// inside one is dropped rather than double-counted (a bare "e3" inside a
// PIECE_MOVE_RE match like "Bf4-e3" isn't a second, separate square).
function findRefs(text) {
  const refs = [];
  const within = (start, end) => refs.some((r) => start >= r.start && end <= r.end);
  let m;
  MOVE_RE.lastIndex = 0;
  while ((m = MOVE_RE.exec(text))) {
    refs.push({
      start: m.index, end: m.index + m[0].length, type: 'move', value: m[0],
    });
  }
  PIECE_MOVE_RE.lastIndex = 0;
  while ((m = PIECE_MOVE_RE.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (within(start, end)) continue;
    refs.push({
      start, end, type: 'move', value: m[0],
    });
  }
  PAWN_CAPTURE_RE.lastIndex = 0;
  while ((m = PAWN_CAPTURE_RE.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (within(start, end)) continue;
    refs.push({
      start, end, type: 'move', value: m[0],
    });
  }
  SQUARE_RE.lastIndex = 0;
  while ((m = SQUARE_RE.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (within(start, end)) continue;
    refs.push({
      start, end, type: 'square', value: m[0],
    });
  }
  refs.sort((a, b) => a.start - b.start);
  return refs;
}

// The note's body, with every move reference in it turned into a blue link
// (click it and the board glows the square, see legalMoves.js's
// NOTE_HIGHLIGHT_STYLE) and every bare square mention bolded so it still
// stands out without pretending to be clickable.
function AnnotatedText({ text, onMoveClick }) {
  const refs = useMemo(() => findRefs(text), [text]);
  if (refs.length === 0) return text;
  const nodes = [];
  let cursor = 0;
  refs.forEach((r, i) => {
    if (r.start > cursor) nodes.push(text.slice(cursor, r.start));
    if (r.type === 'move') {
      const dest = destSquareFor(r.value);
      nodes.push(
        <button
          key={i}
          type="button"
          className="mn-move-ref"
          disabled={!dest}
          onClick={() => dest && onMoveClick?.(dest)}
        >
          {r.value}
        </button>,
      );
    } else {
      nodes.push(<strong key={i} className="mn-square-ref">{r.value}</strong>);
    }
    cursor = r.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

// The author's note on a move, shown as its own block with the move it belongs
// to. A course's comments are the teaching — they shouldn't be a tooltip.
//
// `index` is the move the note belongs to (0-based). `stale` dims a note that
// belongs to an earlier move, so you can still read it while you play on.
// `float`: a light, continuous floating animation instead of sitting still —
// used where the note only ever shows the exact current move's own text (see
// AnalysisView's currentNote), so its appearance already means "this is new",
// unlike `stale`'s carried-over note. The caller keys its <MoveNote> by the
// note's own index so stepping straight from one commented move to another
// remounts the card and restarts the arrival half of the animation, instead
// of the same card just sitting there with different text swapped under it.
// `badgeId` puts that move's glyph right next to its label — the same
// judgement the board itself is showing on the square, repeated here in
// words. `onMoveClick(square)` fires when a move reference inside the text
// is clicked — the caller decides what "point at this square" means for its
// own board.
export default function MoveNote({
  text, san, index, stale, highlight, float, badgeId, onMoveClick,
}) {
  const { state } = useStore();
  const showBadges = state.settings.showMoveListBadges !== false;
  if (!text) return null;
  return (
    <div className={`move-note${stale ? ' stale' : ''}${highlight ? ' called-out' : ''}${float ? ' floating' : ''}`}>
      <span className="mn-move">
        <CommentIcon size={13} />
        {index != null && <strong>{label(index)}{san}</strong>}
        {showBadges && badgeId && <MoveBadge id={badgeId} size={14} />}
      </span>
      <div className="mn-body">
        <p><AnnotatedText text={text} onMoveClick={onMoveClick} /></p>
      </div>
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
