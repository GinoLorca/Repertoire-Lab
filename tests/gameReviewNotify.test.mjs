// Game Review reaching the student: "Your game has been analyzed", then
// "Analysis updated" — on a game a coach typed in for them (a game patch)
// and on their own game (a coach's review) — src/lib/cloud/gameLink.js,
// src/lib/cloud/reviews.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCoachGames, buildPatch, hashesOf } from '../src/lib/cloud/gameLink.js';
import { applyCoachReviews, unseenReviews, reviewsOf, isGameReviewBody } from '../src/lib/cloud/reviews.js';
import { withGameReview } from '../src/lib/gameReviewBridge.js';
import { docFromGame, serializeDoc } from '../src/lib/analysisDoc.js';

const S = 'studentuid';
const C = 'coachuid';
const NOW = 1_800_000_000_000;
const MOVES = ['e4', 'c6', 'd4', 'd5'];
const AN = JSON.stringify({ v: 1, l: [], c: [[2, 'The Caro']], m: [] });

const linked = (g) => ({ ...g, link: { uid: S, base: {}, seen: false, sent: null } });
const delivery = (coachGame, rev) => ({
  id: `lg_${coachGame.id}_${rev}`, fromUid: C, fromName: 'Gino', gameId: coachGame.id, rev, resend: false,
  patch: JSON.stringify(buildPatch(coachGame).patch),
});
const game = (extra = {}) => ({
  id: 'abc123', name: 'Parker vs Sam', moves: MOVES, comments: {}, badges: {}, date: 100,
  meta: { white: 'Parker', black: 'Sam', result: '1-0' }, ...extra,
});

test('a coach-typed game with Game Review on it arrives analyzed; plain corrections don’t', () => {
  const cg = linked(game({ gameReview: { note: 'Look at move 2', an: AN, at: 5 } }));
  const first = applyCoachGames({ players: [], openings: [] }, [delivery(cg, NOW)], { studentUid: S, ledger: { games: {} }, now: NOW });
  assert.equal(first.outcomes[0].outcome, 'inserted');
  assert.equal(first.outcomes[0].analyzed, true);
  const g = first.state.players[0].games[0];
  assert.equal(g.gameReview.note, 'Look at move 2');
  assert.equal(g.coachNews[C].gr, true);
  const [item] = unseenReviews(first.state.players);
  assert.equal(item.analyzed, true);
  assert.equal(item.again, false, 'the first time: "Your game has been analyzed"');

  // Read, then analyzed again: "Analysis updated".
  const seen = {
    ...first.state,
    players: first.state.players.map((p) => ({ ...p, games: p.games.map((x) => ({ ...x, reviewSeen: { [C]: { rev: NOW } } })) })),
  };
  const later = { ...cg, gameReview: { note: 'Look at move 2 — and move 3', an: AN, at: 9 }, link: { ...cg.link, base: hashesOf(g) } };
  const second = applyCoachGames(seen, [delivery(later, NOW + 10)], { studentUid: S, ledger: { games: {} }, now: NOW + 10 });
  assert.equal(second.outcomes[0].outcome, 'applied');
  assert.equal(second.outcomes[0].analyzed, true);
  const [again] = unseenReviews(second.state.players);
  assert.equal(again.analyzed, true);
  assert.equal(again.again, true);

  // A correction to the result only: not "analyzed".
  const g2 = second.state.players[0].games[0];
  const fix = { ...later, meta: { ...later.meta, result: '0-1' }, link: { ...cg.link, base: hashesOf(g2) } };
  const third = applyCoachGames(second.state, [delivery(fix, NOW + 20)], { studentUid: S, ledger: { games: {} }, now: NOW + 20 });
  assert.equal(third.outcomes[0].outcome, 'applied');
  assert.equal(third.outcomes[0].analyzed, undefined);
});

test('a review of the student’s own game from Game Review is analyzed; one from Studio isn’t', () => {
  const own = { id: 'game0001', moves: MOVES, comments: {}, meta: { white: 'Parker', black: 'Sam' } };
  const state = { players: [{ id: 'mine', kind: 'self', name: 'My games', games: [own] }] };
  const gr = withGameReview(null, own, { note: 'Nice Caro', an: AN, at: 3 });
  const studio = serializeDoc({ ...docFromGame({ moves: MOVES }), tree: { ...docFromGame({ moves: MOVES }).tree, note: 'Summary' } });
  assert.ok(isGameReviewBody(gr));
  assert.ok(!isGameReviewBody(studio));
  const d = (rev, body) => ({ id: `lr_${C}_game0001_${rev}`, kind: 'game', v: 2, fromUid: C, fromName: 'Gino', gameId: 'game0001', rev, review: body });

  const out = applyCoachReviews(state, [d(10, gr)], { now: 11, names: { [C]: 'Gino' } });
  assert.equal(out.outcomes[0].outcome, 'reviewed');
  assert.equal(out.outcomes[0].analyzed, true);
  const [item] = unseenReviews(out.state.players);
  assert.equal(item.analyzed, true);
  assert.equal(item.again, false);
  assert.equal(reviewsOf(out.state.players[0].games[0])[0].analyzed, true);

  const plain = applyCoachReviews(state, [d(10, studio)], { now: 11 });
  assert.equal(plain.outcomes[0].analyzed, undefined);
  assert.equal(unseenReviews(plain.state.players)[0].analyzed, false);
});
