// A coach's review of a linked student's own game: what the student's app
// takes, how it lands on their game, and what lights their bell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibleReviewDelivery, applyCoachReviews, unseenReviews, needsReviewSend, reviewHash, reviewsOf,
} from '../src/lib/cloud/reviews.js';
import { docFromGame, serializeDoc, parseDoc } from '../src/lib/analysisDoc.js';
import { notesOnNodes } from '../src/lib/moveTree.js';

const C = 'coachUid1';
const moves = ['e4', 'e5', 'Nf3', 'Nc6'];
const review = (comments) => serializeDoc(docFromGame({ moves, comments }));
const theirGame = { id: 'game0001', moves, comments: { 1: 'my note' }, updatedAt: 5, meta: { white: 'Parker', black: 'Sam' } };
const state = () => ({
  players: [
    { id: 'mine', kind: 'self', name: 'My games', games: [theirGame] },
    { id: 'kid', kind: 'student', name: 'A student of mine', games: [{ id: 'game0002', moves }] },
  ],
});
const delivery = (rev, body, extra = {}) => ({
  id: `lr_${C}_game0001_${rev}`, kind: 'game', v: 2, fromUid: C, fromName: 'Sender says', gameId: 'game0001', rev, review: body, ...extra,
});

test('only a linked coach’s v2 is taken; v1 stays with the game patches; strangers get nothing', () => {
  const coaches = new Set([C]);
  assert.ok(eligibleReviewDelivery(delivery(1, 'x'), coaches));
  assert.ok(!eligibleReviewDelivery({ ...delivery(1, 'x'), v: 1 }, coaches));
  assert.ok(!eligibleReviewDelivery({ ...delivery(1, 'x'), fromUid: 'stranger' }, coaches));
  assert.ok(!eligibleReviewDelivery({ ...delivery(1, 'x'), dismissedAt: 1 }, coaches));
});

test('a review lands beside the student’s own game, never in it', () => {
  const out = applyCoachReviews(state(), [delivery(10, review({ 2: 'Develops.' }))], { now: 99, names: { [C]: 'Gino' } });
  const g = out.state.players[0].games[0];
  assert.deepEqual(g.comments, { 1: 'my note' }); // theirs untouched
  assert.equal(g.updatedAt, 5); // their clashes still theirs to win
  assert.equal(g.reviews[C].by, 'Gino'); // the link's name, not the sender's
  assert.equal(g.reviews[C].rev, 10);
  const doc = parseDoc(g.reviews[C].body);
  assert.ok(Object.values(notesOnNodes(doc.tree).notes).includes('Develops.'));
  assert.deepEqual(out.consumed, [`lr_${C}_game0001_10`]);
  assert.equal(out.outcomes[0].outcome, 'reviewed');
  assert.equal(out.outcomes[0].fromUid, C);
});

test('older, repeated, broken and misdirected reviews', () => {
  const bodyA = review({ 2: 'A' });
  const first = applyCoachReviews(state(), [delivery(10, bodyA)], { now: 1 });
  // An older one arriving late changes nothing.
  const late = applyCoachReviews(first.state, [delivery(9, review({ 2: 'old' }))], { now: 2 });
  assert.equal(late.outcomes[0].outcome, 'stale');
  assert.equal(parseDoc(late.state.players[0].games[0].reviews[C].body) !== null, true);
  // The same review again: newer rev, same content — no bell.
  const again = applyCoachReviews(first.state, [delivery(11, bodyA)], { now: 3 });
  assert.equal(again.outcomes[0].outcome, 'unchanged');
  assert.equal(unseenReviews(again.state.players).length, 1);
  // An update.
  const upd = applyCoachReviews(first.state, [delivery(12, review({ 2: 'B' }))], { now: 4 });
  assert.equal(upd.outcomes[0].outcome, 'review-updated');
  // Broken, missing, and a game on one of the student's OWN coaching cards.
  const bad = applyCoachReviews(state(), [
    delivery(1, '{nope'),
    { ...delivery(2, review({})), gameId: 'nosuchgame' },
    { ...delivery(3, review({})), gameId: 'game0002' },
    { ...delivery(4, review({})), gameId: '../../x' },
  ], { now: 5 });
  const by = Object.fromEntries(bad.outcomes.map((o) => [o.gameId, o.outcome]));
  assert.deepEqual(by, {
    game0001: 'invalid', nosuchgame: 'gone', game0002: 'gone', '../../x': 'invalid',
  });
  assert.equal(bad.consumed.length, 4);
});

test('whatever the sender put in it, what’s stored is rebuilt and safe to push', () => {
  const evil = JSON.stringify({
    moves, tree: { children: [{ id: '__x__', san: 'e4', note: 'hi', children: [] }] },
    annotations: { '': { arrows: [] }, __a__: { squares: { __b__: 'x' } } },
    variationHighlights: { __proto__: 'green' },
    extra: { deep: { '': 1 } },
  });
  const out = applyCoachReviews(state(), [delivery(7, evil)], { now: 1 });
  const stored = out.state.players[0].games[0].reviews[C];
  const keys = [];
  const walk = (v) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); } };
  walk(stored);
  assert.ok(keys.every((k) => k !== '' && !/^__.*__$/.test(k)));
  assert.equal(JSON.parse(stored.body).extra, undefined);
});

test('the bell: unseen reviews and coach news, until read', () => {
  const s = applyCoachReviews(state(), [delivery(10, review({ 2: 'A' }))], { now: 50 }).state;
  let list = unseenReviews(s.players);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'review');
  const seen = { ...s, players: s.players.map((p, i) => (i ? p : { ...p, games: [{ ...p.games[0], reviewSeen: { [C]: { rev: 10 } } }] })) };
  assert.equal(unseenReviews(seen.players).length, 0);
  // A game a coach typed in, with news on it.
  const news = { players: [{ id: 'mine', kind: 'self', games: [{ id: 'g9', moves, coachNews: { [C]: { rev: 3, by: 'Gino' } } }] }] };
  list = unseenReviews(news.players);
  assert.equal(list[0].kind, 'own');
  assert.equal(reviewsOf(news.players[0].games[0])[0].by, 'Gino');
  // Removed reviews don't count.
  const removed = { players: [{ id: 'mine', kind: 'self', games: [{ id: 'g8', moves, reviews: { [C]: { rev: 9, removed: true } } }] }] };
  assert.equal(unseenReviews(removed.players).length, 0);
});

test('the coach sends a saved review of a game the student has, once', () => {
  const body = review({ 0: 'x' });
  const g = {
    id: 'g1', moves, review: { body, savedAt: 20 }, link: { uid: 'S', origin: 'student', seen: true },
  };
  assert.ok(needsReviewSend(g, { linkActive: true }));
  assert.ok(!needsReviewSend(g, { linkActive: false }));
  assert.ok(!needsReviewSend({ ...g, link: { ...g.link, seen: false } }, { linkActive: true }));
  assert.ok(!needsReviewSend({ ...g, link: { ...g.link, gone: true } }, { linkActive: true }));
  assert.ok(!needsReviewSend({ ...g, review: { body, savedAt: 0 } }, { linkActive: true })); // kept, not saved
  const sent = { ...g, link: { ...g.link, reviewSent: { savedAt: 20, ph: reviewHash(body) } } };
  assert.ok(!needsReviewSend(sent, { linkActive: true }));
  // Saved again with nothing changed: still nothing to send.
  assert.ok(!needsReviewSend({ ...sent, review: { body, savedAt: 30 } }, { linkActive: true }));
});

test('analysis a coach adds to a game they typed in is news for the student; a new date isn’t', async () => {
  const { applyCoachGames } = await import('../src/lib/cloud/gameLink.js');
  const s0 = { players: [{ id: 'mine', kind: 'self', games: [] }] };
  const d = (rev, set, from = {}) => ({
    id: `lg_${C}_game0009_${rev}`, fromUid: C, fromName: 'Gino', gameId: 'game0009', rev, patch: JSON.stringify({ from, set }),
  });
  const EMPTYH = '∅';
  const ins = applyCoachGames(s0, [d(10, { moves, 'comments:0': 'Best by test.' }, { moves: EMPTYH, 'comments:0': EMPTYH })], { studentUid: 'S', ledger: {}, now: 1 });
  const g = ins.state.players[0].games[0];
  assert.deepEqual(g.coachNews[C].rev, 10);
  assert.equal(unseenReviews(ins.state.players)[0].kind, 'own');
  // A later patch that only fixes the round: no new news.
  const h = g.coach[C].h;
  const round = applyCoachGames(ins.state, [d(11, { 'meta:round': '3' }, { 'meta:round': EMPTYH })], { studentUid: 'S', ledger: {}, now: 2 });
  assert.equal(round.state.players[0].games[0].coachNews[C].rev, 10);
  // A new note: news again.
  const note = applyCoachGames(round.state, [d(12, { 'comments:2': 'And here.' }, { 'comments:2': EMPTYH })], { studentUid: 'S', ledger: {}, now: 3 });
  assert.equal(note.state.players[0].games[0].coachNews[C].rev, 12);
  assert.ok(h);
});

test('the coach’s copy learns what the student holds of the review — and gets a lost one back', async () => {
  const { mergeLinkedGames, hashesOf } = await import('../src/lib/cloud/gameLink.js');
  const body = review({ 1: 'Theirs to read.' });
  const s = {
    id: 'game0001', moves, updatedAt: 3,
    reviews: { [C]: { rev: 40, h: reviewHash(body), body, by: 'Gino' } },
    reviewSeen: { [C]: { rev: 40 } },
  };
  const c = { id: 'game0001', moves, comments: {}, badges: {}, meta: {}, link: { uid: 'S', origin: 'student', base: hashesOf(s), seen: true, sent: null } };
  const card = { id: 'card1', kind: 'student', profile: { linkedUid: 'S' }, linkPrimed: true, games: [c] };
  const out = mergeLinkedGames(card, { studentUid: 'S', coachUid: C, games: [s], complete: true, ledger: {}, now: 50 });
  const g = out.card.games[0];
  assert.equal(g.review.body, body); // back from the student's copy
  assert.deepEqual(g.link.theirReview, { rev: 40, seen: 40 });
  assert.equal(g.link.reviewSent.ph, reviewHash(body)); // so it isn't sent again
  assert.ok(!needsReviewSend(g, { linkActive: true }));
});

test('a review read and then sent again unchanged stays read', () => {
  const body = review({ 1: 'Once.' });
  const first = applyCoachReviews(state(), [delivery(10, body)], { now: 1 }).state;
  const read = {
    ...first,
    players: first.players.map((p, i) => (i ? p : { ...p, games: [{ ...p.games[0], reviewSeen: { [C]: { rev: 10 } } }] })),
  };
  const again = applyCoachReviews(read, [delivery(20, body)], { now: 2 });
  assert.equal(again.outcomes[0].outcome, 'unchanged');
  assert.equal(unseenReviews(again.state.players).length, 0);
  assert.equal(again.state.players[0].games[0].reviewSeen[C].rev, 20);
});

test('a sender can’t fill the student’s section: names are capped, size is counted in bytes', () => {
  const out = applyCoachReviews(state(), [{ ...delivery(10, review({ 1: 'x' })), fromName: '♘'.repeat(300000) }], { now: 1 });
  assert.equal(out.outcomes[0].outcome, 'reviewed');
  assert.ok(out.state.players[0].games[0].reviews[C].by.length <= 80);
  // A section already near the limit in bytes (not in characters) refuses it,
  // and says so on the game instead.
  const big = state();
  big.players[0].games[0] = { ...big.players[0].games[0], meta: { ...theirGame.meta, notes: '♘'.repeat(310000) } };
  const refused = applyCoachReviews(big, [delivery(11, review({ 1: 'y' }))], { now: 2 });
  assert.equal(refused.outcomes[0].outcome, 'too-big');
  assert.equal(refused.state.players[0].games[0].reviews, undefined);
  assert.equal(refused.state.players[0].games[0].reviewRefused[C].rev, 11);
});
