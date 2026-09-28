// A coach's review of a linked student's own game — see lib/analysisDoc for
// the document, and lib/cloud/gameLink for the games the two accounts share.
//
// A student's own game is a record only they write: a link needs no
// approval, so "linked" can't be what lets someone rewrite it (gameLink's
// applyCoachGames refuses exactly that). A review is therefore a separate
// layer ON the student's game, never touching their moves, notes or badges:
//
//   coach   game.review = { v, body, editedAt, savedAt }   on the coach's card
//   wire    deliveries { kind:'game', v:2, gameId, rev, review: body }
//   student game.reviews[coachUid] = { rev, h, at, by, body, updatedAt }
//           game.reviewSeen[coachUid] = { rev, updatedAt }
//
// v:2 on the existing kind: today's and older builds accept only v === 1
// (share.js eligibleGameDelivery) and hide kind 'game' from linked coaches in
// the bell, so they neither show nor consume a review — it waits until the
// student's app updates. No Firestore rules change: deliveries allow any
// sender to write their own documents.
//
// A game a coach TYPED IN for the student is shared as ever — its notes travel
// in its own fields (v:1) — and applyCoachGames marks it `coachNews` when the
// analysis on it changes, so the student hears about both kinds alike.
//
// Pure, like gameLink — tests/reviews.test.mjs.
import { hashOf } from './shape';
import {
  gameSummary, validGameId, cleanName, bytesOf, SECTION_BYTES,
} from './gameLink';
import {
  parseDoc, serializeDoc, docBytes, MAX_REVIEW_BYTES,
} from '../analysisDoc';

export const REVIEW_V = 2;

// A body's fingerprint: what "the same review" means, on both sides.
export const reviewHash = (body) => `${hashOf(body)}.${body.length}`;

// Whether this is a review this student takes: from a coach they're linked to
// right now, and from no one else — there's no "accept a stranger's review"
// the way there is for a game.
export function eligibleReviewDelivery(d, activeCoachUids) {
  return d?.kind === 'game' && d.v === REVIEW_V && !d.dismissedAt && activeCoachUids.has(d.fromUid);
}

// Coach side: whether a game's review has something new to send. Only a game
// the student's account already has (link.seen), still there, with moves —
// and only once the coach has saved it since the last send.
export function needsReviewSend(g, { linkActive }) {
  const link = g?.link;
  const review = g?.review;
  if (!link || link.gone || link.resend || !link.seen || !linkActive) return false;
  if (!(g.moves?.length > 0) || typeof review?.body !== 'string') return false;
  if (!((review.savedAt ?? 0) > (link.reviewSent?.savedAt ?? 0))) return false;
  return reviewHash(review.body) !== link.reviewSent?.ph;
}

const isSelf = (p) => (p.kind ?? 'self') === 'self';

function locateOwn(players, gameId) {
  for (let i = 0; i < players.length; i += 1) {
    if (!isSelf(players[i])) continue;
    const j = (players[i].games ?? []).findIndex((g) => g.id === gameId);
    if (j >= 0) return { pi: i, gi: j };
  }
  return null;
}

// Student side: the reviews that arrived, onto the student's games.
//
//   deliveries — already eligible (eligibleReviewDelivery), each
//                { id, fromUid, fromName, gameId, rev, review }
//   names      — { [coachUid]: name } from the student's own link records,
//                preferred over the name the sender wrote into the delivery
//
// Every delivery is consumed, whatever happens to it. The game's updatedAt
// is left alone: the student's own edits must still win their own clashes.
export function applyCoachReviews(state, deliveries, { now, names = {} } = {}) {
  let players = state.players ?? [];
  const consumed = [];
  const outcomes = [];
  const ordered = [...deliveries].sort((a, b) => (a.gameId === b.gameId
    ? a.rev - b.rev
    : String(a.gameId).localeCompare(String(b.gameId))));

  for (const d of ordered) {
    consumed.push(d.id);
    const C = d.fromUid;
    // The name from the student's own link record first; either way short.
    const by = cleanName(names[C]) || cleanName(d.fromName);
    const result = (outcome, extra = {}) => outcomes.push({
      deliveryId: d.id, gameId: d.gameId, fromUid: C, fromName: by, outcome, ...extra,
    });
    if (!validGameId(d.gameId) || !Number.isFinite(d.rev) || typeof d.review !== 'string'
      || docBytes(d.review) > MAX_REVIEW_BYTES) { result('invalid'); continue; }
    const doc = parseDoc(d.review);
    if (!doc) { result('invalid'); continue; }
    const at = locateOwn(players, d.gameId);
    if (!at) { result('gone'); continue; }
    const section = players[at.pi];
    const g = section.games[at.gi];
    const mine = g.reviews?.[C];
    if ((mine?.rev ?? 0) >= d.rev) { result('stale'); continue; }

    // Rebuilt, never the sender's own object: what's stored is only what
    // parseDoc let through (a key Firestore refuses would stop every sync).
    const body = serializeDoc(doc);
    const h = reviewHash(body);
    let entry;
    let outcome;
    let seenNext = null;
    if (mine && !mine.removed && mine.h === h) {
      // The same review again (a resend, the coach's other device): newer,
      // but nothing new to read — not a reason to light the bell. Read
      // already? Then this copy counts as read too.
      entry = { ...mine, rev: d.rev, updatedAt: d.rev };
      outcome = 'unchanged';
      if ((g.reviewSeen?.[C]?.rev ?? 0) >= (mine.rev ?? 0)) {
        seenNext = { ...(g.reviewSeen ?? {}), [C]: { rev: d.rev, updatedAt: d.rev } };
      }
    } else {
      entry = {
        rev: d.rev, h, at: now, by, body, updatedAt: d.rev,
      };
      outcome = mine && !mine.removed ? 'review-updated' : 'reviewed';
    }
    const next = {
      ...g, reviews: { ...(g.reviews ?? {}), [C]: entry }, ...(seenNext ? { reviewSeen: seenNext } : {}),
    };
    const nextSection = { ...section, games: section.games.map((x, j) => (j === at.gi ? next : x)) };
    // A section is one Firestore document (1 MiB). A review that would take
    // it past that is refused — kept, it would fail every sync after it —
    // and a small note of the refusal goes on the game instead, for the
    // student's toast and the coach's card.
    if (bytesOf(nextSection) > SECTION_BYTES) {
      const refusedGame = { ...g, reviewRefused: { ...(g.reviewRefused ?? {}), [C]: { rev: d.rev, at: now } } };
      players = players.map((pl, i) => (i === at.pi
        ? { ...section, games: section.games.map((x, j) => (j === at.gi ? refusedGame : x)) }
        : pl));
      result('too-big', { name: gameSummary(g) });
      continue;
    }
    players = players.map((pl, i) => (i === at.pi ? nextSection : pl));
    result(outcome, { name: gameSummary(next) });
  }
  return { state: { ...state, players }, consumed, outcomes };
}

// The reviews the student hasn't read yet — the bell, and the dot on a game.
// Both kinds: a review of their own game, and analysis changed on a game a
// coach typed in for them (coachNews).
export function unseenReviews(players) {
  const out = [];
  for (const section of players ?? []) {
    if (!isSelf(section)) continue;
    for (const g of section.games ?? []) {
      const seen = g.reviewSeen ?? {};
      for (const [C, r] of Object.entries(g.reviews ?? {})) {
        if (r?.removed || typeof r?.body !== 'string') continue;
        if ((r.rev ?? 0) > (seen[C]?.rev ?? 0)) {
          out.push({
            sectionId: section.id, gameId: g.id, coachUid: C, by: r.by ?? '', rev: r.rev, at: r.at ?? r.rev, kind: 'review', name: gameSummary(g),
          });
        }
      }
      for (const [C, n] of Object.entries(g.coachNews ?? {})) {
        if ((n?.rev ?? 0) > (seen[C]?.rev ?? 0)) {
          out.push({
            sectionId: section.id, gameId: g.id, coachUid: C, by: n.by ?? '', rev: n.rev, at: n.at ?? n.rev, kind: 'own', name: gameSummary(g),
          });
        }
      }
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

// Every coach's review on one game, for the reader: newest first.
export function reviewsOf(game) {
  const out = [];
  for (const [C, r] of Object.entries(game?.reviews ?? {})) {
    if (!r?.removed && typeof r?.body === 'string') out.push({ coachUid: C, by: r.by ?? '', rev: r.rev, kind: 'review' });
  }
  for (const [C, n] of Object.entries(game?.coachNews ?? {})) {
    if (!out.some((x) => x.coachUid === C)) out.push({ coachUid: C, by: n.by ?? '', rev: n.rev, kind: 'own' });
  }
  return out.sort((a, b) => b.rev - a.rev);
}

// The coach's side, before a review is kept on a student's card: the card is
// one Firestore document too, and a review can only grow into the room left.
export const cardHasRoom = (card, extraBytes) => bytesOf(card) + extraBytes <= SECTION_BYTES;
