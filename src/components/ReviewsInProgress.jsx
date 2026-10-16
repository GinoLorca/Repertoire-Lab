import React from 'react';
import { useStore } from '../store';
import { listReviews, reviewCounts } from '../lib/reviewsInProgress';
import { seedFor } from '../lib/studioSeed';
import { FlaskIcon, CheckIcon } from './Icons';

// Coaches Corner's "Reviews in progress": every game being reviewed in Studio
// and not yet marked done — a student's, or your own — with how far along it
// is, Continue (back into Studio at the move you stopped on) and Done. A game
// joins the list the first time something is written on it in Studio (see
// AnalysisView); nothing shows here until one has.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "14…Kd8": the move the board was left on, from the moves that lead there.
const stoppedAt = (path) => {
  if (!path?.length) return null;
  const n = path.length;
  return `${Math.ceil(n / 2)}${n % 2 ? '.' : '…'}${path[n - 1]}`;
};

const when = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');

export default function ReviewsInProgress({ onContinue }) {
  const { state, dispatch } = useStore();
  const rows = listReviews(state.settings.reviewsInProgress, state.players);
  if (rows.length === 0) return null;
  return (
    <section className="reviews-progress">
      <div className="reviews-progress-head">
        <FlaskIcon size={17} />
        <h3>Reviews in progress</h3>
        <span className="muted-note">{rows.length}</span>
      </div>
      <ul>
        {rows.map(({ entry, player, game }) => {
          // As Studio would open it, so the counts are what you'd see there.
          const seed = seedFor(state.players, { playerId: player.id, gameId: game.id }, { review: true });
          const c = seed ? reviewCounts(seed) : null;
          const done = c ? [
            c.notes && plural(c.notes, 'note'),
            c.badges && plural(c.badges, 'badge'),
            c.variations && plural(c.variations, 'variation'),
            c.marked && plural(c.marked, 'marked position'),
          ].filter(Boolean) : [];
          const m = game.meta ?? {};
          const where = [m.event, m.round && `round ${m.round}`].filter(Boolean).join(' · ');
          const at = stoppedAt(entry.path);
          return (
            <li key={`${player.id}:${game.id}`} className="reviews-progress-row">
              <div className="rp-main">
                <span className="rp-who">{player.kind === 'student' ? player.name : 'Your game'}</span>
                <span className="rp-game">{game.name}</span>
                <span className="muted-note rp-meta">
                  {[where, `last worked on ${when(entry.updatedAt)}`].filter(Boolean).join(' · ')}
                </span>
                <span className="muted-note rp-meta">
                  {done.length ? done.join(' · ') : 'Just started'}
                  {at && ` · stopped at ${at}`}
                </span>
              </div>
              <div className="rp-actions">
                <button
                  className="small primary"
                  title="Back into Studio on this game, at the move you stopped on"
                  onClick={() => onContinue({ player, game, entry })}
                >
                  <FlaskIcon size={13} /> Continue
                </button>
                <button
                  className="small ghost"
                  title="Take it off this list — everything you wrote stays on the game"
                  onClick={() => dispatch({ type: 'reviewDone', playerId: player.id, gameId: game.id })}
                >
                  <CheckIcon size={13} /> Done
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
