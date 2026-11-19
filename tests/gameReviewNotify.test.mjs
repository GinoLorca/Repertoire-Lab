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

test('the engine\'s review (rv) and everything else in Game Review reach the student both ways, and show on their analysis board', async () => {
  const { recordsFor } = await import('../src/lib/gameReviewBridge.js');
  const { reviewOnBoard, movesSig } = await import('../src/lib/reviewOnBoard.js');
  const { makeTree } = await import('../src/lib/moveTree.js');
  const RV = JSON.stringify({ at: 7, n: 4, h: movesSig(MOVES), d: 15, e: '20,30,25,40,35', b: 'kkkm', a: [88.1, 70] });
  const AN2 = JSON.stringify({ v: 1, l: [[2, 'b1c3']], c: [[2, 'The Caro']], m: [[3, 'Gd5e4', '']], k: [[3, 'C', 'check first']] });
  const records = { note: 'Look at move 2', an: AN2, lr: '# Larry', rv: RV, at: 9 };
  const onBoard = (g, player) => reviewOnBoard({ tree: makeTree(MOVES), moves: MOVES, records: recordsFor(g, player), side: 'white' });

  // A game the coach typed in for them: a patch.
  const cg = linked(game({ gameReview: records }));
  const typed = applyCoachGames({ players: [], openings: [] }, [delivery(cg, NOW)], { studentUid: S, ledger: { games: {} }, now: NOW });
  const tg = typed.state.players[0].games[0];
  assert.equal(tg.gameReview.rv, RV);
  assert.equal(tg.gameReview.lr, '# Larry');
  const r1 = onBoard(tg, typed.state.players[0]);
  assert.equal(Object.values(r1.engineBadges).filter((b) => b === 'mistake').length, 1);
  assert.deepEqual(r1.accuracy, { white: 88.1, black: 70 });
  assert.equal(Object.keys(r1.clamp).length, 1);

  // Their own game: the coach's review layer, updated three times while it's written.
  const own = { id: 'game0001', moves: MOVES, comments: {}, meta: { white: 'Parker', black: 'Sam', color: 'white' } };
  let state = { players: [{ id: 'mine', kind: 'self', name: 'My games', games: [own] }] };
  const d = (rev, body) => ({ id: `lr_${C}_game0001_${rev}`, kind: 'game', v: 2, fromUid: C, fromName: 'Gino', gameId: 'game0001', rev, review: body });
  for (const [i, rev] of [10, 13, 16].entries()) {
    const body = withGameReview(null, own, { ...records, note: `Look at move 2 (${i})` });
    state = applyCoachReviews(state, [d(rev, body)], { now: rev + 1, names: { [C]: 'Gino' } }).state;
  }
  const mine = state.players[0];
  assert.equal(unseenReviews(state.players).length, 1, 'one entry in the bell however many updates came');
  const r2 = onBoard(mine.games[0], mine);
  assert.equal(r2.note, 'Look at move 2 (2)', 'the newest');
  assert.equal(Object.keys(r2.engineBadges).length, 4);
  assert.ok(r2.tree.children[0].children[0].children.some((c) => c.san === 'Nc3'), 'the side line');
});
