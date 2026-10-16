// Game reviews a coach has started in Studio and not yet marked done — the
// "Reviews in progress" list in Coaches Corner.
//
// Kept in settings.reviewsInProgress (it syncs, so the iPad and the Mac show
// the same list) as { "playerId:gameId": { playerId, gameId, startedAt,
// updatedAt, path } }. `path` is where the board was left: the moves from
// the start to that move, by name — a variation's moves included — which
// survives a tree whose move ids are made afresh each time it opens.
//
// The list only says what's in progress and where you stopped. The review
// itself is on the game (or in the coach's review of a student's own game),
// saved as it's written, so marking it done takes nothing away.
import { nodePath, walkNodes } from './moveTree';

export const reviewKey = (playerId, gameId) => `${playerId}:${gameId}`;

// Started: added the first time something is written on the game in Studio.
// Already there: the same map back, so nothing is saved or synced for it.
export function startReview(map, playerId, gameId, now = Date.now()) {
  const all = map ?? {};
  const key = reviewKey(playerId, gameId);
  if (all[key]) return all;
  return { ...all, [key]: { playerId, gameId, startedAt: now, updatedAt: now, path: [] } };
}

// Left the board: where it was, and when. Only for a review in the list — a
// game that was only looked at doesn't join it by being closed.
export function touchReview(map, playerId, gameId, path, now = Date.now()) {
  const all = map ?? {};
  const key = reviewKey(playerId, gameId);
  if (!all[key]) return all;
  return { ...all, [key]: { ...all[key], updatedAt: now, path: Array.isArray(path) ? path : [] } };
}

export function endReview(map, playerId, gameId) {
  const all = map ?? {};
  const key = reviewKey(playerId, gameId);
  if (!all[key]) return all;
  const next = { ...all };
  delete next[key];
  return next;
}

// The list as it's shown: each entry with its player and game, latest worked
// on first. A game or player that's gone drops out on its own.
export function listReviews(map, players) {
  const out = [];
  for (const entry of Object.values(map ?? {})) {
    const player = (players ?? []).find((p) => p.id === entry.playerId);
    const game = player?.games?.find((g) => g.id === entry.gameId);
    if (player && game) out.push({ entry, player, game });
  }
  return out.sort((a, b) => (b.entry.updatedAt ?? 0) - (a.entry.updatedAt ?? 0));
}

// Where the board sits, as the moves that lead there.
export const pathTo = (tree, id) => nodePath(tree, id).map((n) => n.san);

// And back: the move those lead to, as far as the tree still has them —
// the start, if not even the first is there any more.
export function nodeAtPath(tree, path) {
  let node = tree;
  for (const san of path ?? []) {
    const next = node?.children?.find((c) => c.san === san);
    if (!next) break;
    node = next;
  }
  return node?.id ?? 'root';
}

// How far along a review is, for its row in the list.
export function reviewCounts({ tree, notes, badges, annotations }) {
  let variations = 0;
  if (tree) walkNodes(tree, (n) => { if (n.children.length > 1) variations += n.children.length - 1; });
  return {
    notes: Object.keys(notes ?? {}).length,
    badges: Object.keys(badges ?? {}).length,
    marked: Object.keys(annotations ?? {}).length,
    variations,
  };
}
