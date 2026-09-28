// Where Studio starts on a saved game — see AnalysisView. Pure, so
// tests/studioSeed.test.mjs covers it.
import { START } from './marks';
import {
  anchorToGame, gameLineOf, notesOnNodes, withNotesOnNodes, bareTree,
} from './moveTree';
import {
  docFromGame, gameFieldsFromDoc, parseDoc, serializeDoc,
} from './analysisDoc';
import { coachWritten } from './cloud/gameLink';

// Where a board on a saved game starts, worked out once when it opens — from
// the game as the store holds it right now, not from the snapshot App took
// when "Send to…" was pressed: Back, or the Analysis tab, can bring that back
// long after newer work was saved, and a Save from it would write the old
// notes over the new.
//
// A linked student's OWN game is a record the coach can't write (see
// lib/cloud/gameLink); the coach's work on it goes into their review
// (game.review, lib/analysisDoc), which travels to the student separately.
// Anything else — the coach's own games, games they typed in for a student,
// an unlinked card — is edited in its own analysis fields, as always.
export function seedFor(players, line, { review = true } = {}) {
  const card = players.find((p) => p.id === line.playerId);
  const game = card?.games?.find((g) => g.id === line.gameId);
  if (!game) return null;
  const moves = game.moves ?? [];
  const reviewMode = review && card.kind === 'student' && game.link?.origin === 'student'
    && Boolean(card.profile?.linkedUid) && game.link.uid === card.profile.linkedUid;
  let doc;
  if (reviewMode) {
    // A review made before, or the first one: from whatever the coach wrote on
    // their copy of the game back when that went nowhere.
    const own = (p) => coachWritten(game, p);
    const pick = (k) => Object.fromEntries(Object.entries(game[k] ?? {}).filter(([key]) => own(`${k}:${key}`)));
    const earlier = {
      moves,
      comments: pick('comments'),
      badges: pick('badges'),
      annotations: pick('annotations'),
      ...(own('tree') ? { tree: game.tree, variationHighlights: game.variationHighlights } : {}),
    };
    const saved = parseDoc(game.review?.body);
    // Written against these moves, or against earlier ones the student has
    // since corrected — then the old line stays on as a variation.
    doc = saved ? { ...saved, moves, tree: anchorToGame(saved.tree, moves) } : docFromGame(earlier);
  } else {
    doc = docFromGame(game);
  }
  const { notes, badges } = notesOnNodes(doc.tree);
  const gameLine = gameLineOf(doc.tree, moves.length);
  // The student's own note on each move of their game, shown beside the
  // coach's (read-only) — not ones the coach left on the copy earlier.
  const theirNotes = {};
  if (reviewMode) {
    gameLine.forEach((n, i) => {
      const c = game.comments?.[i];
      if (typeof c === 'string' && c && !coachWritten(game, `comments:${i}`)) theirNotes[n.id] = c;
    });
    const intro = game.comments?.[START];
    if (typeof intro === 'string' && intro && !coachWritten(game, `comments:${START}`)) theirNotes.root = intro;
  }
  return {
    reviewMode,
    playerId: card.id,
    gameId: game.id,
    studentName: card.name,
    studentCard: card.kind === 'student',
    linked: Boolean(game.link && card.profile?.linkedUid),
    moves,
    tree: bareTree(doc.tree),
    notes,
    badges,
    annotations: doc.annotations,
    highlights: doc.variationHighlights,
    fields: reviewMode ? null : gameFieldsFromDoc(doc),
    body: reviewMode ? serializeDoc({ ...doc, tree: withNotesOnNodes(bareTree(doc.tree), notes, badges) }) : null,
    theirNotes,
  };
}

