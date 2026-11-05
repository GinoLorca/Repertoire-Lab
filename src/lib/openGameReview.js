// Open a game in Game Review from anywhere — the bell, the toast, a game's
// button — the way lib/openPlayer and the review reader are asked for: the
// request waits on window, and App (which owns the screens) picks it up.
//
//   openGameReview({ playerId, gameId })  — playerId is the game's section
export const OPEN_GAME_REVIEW = 'repertoire-open-game-review';

export function openGameReview(request) {
  if (!request?.playerId || !request?.gameId) return;
  window.__repertoireOpenGameReview = { playerId: request.playerId, gameId: request.gameId };
  window.dispatchEvent(new Event(OPEN_GAME_REVIEW));
}

export function takeGameReviewRequest() {
  const r = window.__repertoireOpenGameReview ?? null;
  window.__repertoireOpenGameReview = null;
  return r;
}
