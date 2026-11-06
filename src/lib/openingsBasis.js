// A player's Openings tab (Chess Arcade's Game History Openings view, on the
// player page): every game of theirs sorted by a repertoire — the openings
// picked for it, White and Black, from your own library and any student's.
// Chess Arcade on its own reads a repertoire from Repertoire Lab's cloud
// after a sign-in; here Repertoire Lab hands it these openings straight
// (scripts/sync-arcade.mjs, repertoire()).
//
//   · basisFor: the openings a player's tab is based on — what was picked for
//     them (kept on their card, so it syncs), or the default: their own
//     openings and yours of the same name (your whole library when they have
//     none of their own; on your own card, your library).
//   · arcadeRepertoire: those openings in Chess Arcade's compact form.
//   · openingsGames: every game of theirs with moves, with the summary Game
//     History reads (who had which side, the result, the speed, the moves).
import { arcadeId, recordsFor, insightSummary } from './gameReviewBridge';
import { START_FEN, fen4 } from './startPos';

const norm = (s) => String(s ?? '').trim().toLowerCase();
const mineOf = (o) => (o.ownerId ?? null) === null;

export function defaultBasis(openings, player) {
  const all = openings ?? [];
  const mine = all.filter(mineOf);
  if (!player || player.kind !== 'student') return mine.map((o) => o.id);
  const theirs = all.filter((o) => o.ownerId === player.id);
  if (!theirs.length) return mine.map((o) => o.id);
  const names = new Set(theirs.map((o) => norm(o.name)));
  return [...theirs, ...mine.filter((o) => names.has(norm(o.name)))].map((o) => o.id);
}

// The ids in use, in order — the player's own openings first, then yours,
// then other students' — only ones that still exist; and whether they were
// picked (false: the default).
export function basisFor(openings, player) {
  const all = openings ?? [];
  const kept = Array.isArray(player?.openingsBasis?.ids) ? player.openingsBasis.ids : null;
  const ids = kept ? kept.filter((id) => all.some((o) => o.id === id)) : defaultBasis(all, player);
  const rank = (o) => (o.ownerId === player?.id ? 0 : mineOf(o) ? 1 : 2);
  const order = new Map(all.map((o, i) => [o.id, i]));
  const chosen = ids.map((id) => all.find((o) => o.id === id))
    .sort((a, b) => rank(a) - rank(b) || order.get(a.id) - order.get(b.id));
  return { ids: chosen.map((o) => o.id), picked: Boolean(kept) };
}

// Whose an opening is, to tell two of the same name apart: '' for yours.
export function ownerLabel(opening, players) {
  if (mineOf(opening)) return '';
  const p = (players ?? []).find((x) => x.id === opening.ownerId);
  return p ? `${p.name}’s` : 'a student’s';
}

// Chess Arcade's compact repertoire: { o:[{ i, n, c, k, ch:[{ i, n, k, s, ss, l }] }] },
// a line being [id, name, moves[], startFen|null]. An opening from a
// student's library is named for them, so it reads apart from yours.
export function arcadeRepertoire(openings, ids, players = []) {
  const out = [];
  for (const id of ids ?? []) {
    const o = (openings ?? []).find((x) => x.id === id);
    if (!o) continue;
    const who = ownerLabel(o, players);
    const name = String(o.name ?? '').trim() || 'Untitled';
    const op = {
      i: o.id,
      n: who ? `${name} (${who})` : name,
      c: o.color === 'black' ? 'b' : 'w',
      k: (o.courses ?? []).map((c) => [c.id, c.name]),
      ch: (o.chapters ?? []).map((c) => ({
        i: c.id,
        n: c.name,
        k: c.courseId ?? '',
        s: c.section ?? '',
        ss: c.subsection ?? '',
        l: (c.variations ?? []).map((v) => [v.id, v.name, [...(v.moves ?? [])], v.startFen ?? null]),
      })),
    };
    if (o.freeChapterOrder) op.f = 1;
    out.push(op);
  }
  return { o: out };
}

// Every game of the player's with moves — marked in Game Review or not.
export function openingsGames(player) {
  const games = [];
  const byArcadeId = new Map();
  for (const game of player?.games ?? []) {
    if (!(game.moves?.length > 0)) continue;
    // a game set up from a position isn't an opening of anyone's
    const from = game.startFen || game.meta?.fen;
    if (from && fen4(from) !== fen4(START_FEN)) continue;
    const id = arcadeId(game.id);
    byArcadeId.set(id, game.id);
    games.push({ id, an: recordsFor(game, player)?.an ?? '', summary: insightSummary(game, player) });
  }
  return { games, byArcadeId };
}

// "Jobava London System, Caro-Kann (Myla’s)" — for the line above the tab.
export function basisSummary(openings, ids, players = []) {
  const pick = (color) => (ids ?? []).map((id) => (openings ?? []).find((o) => o.id === id))
    .filter((o) => o && (o.color === 'black' ? 'black' : 'white') === color)
    .map((o) => { const who = ownerLabel(o, players); const name = String(o.name ?? '').trim(); return who ? `${name} (${who})` : name; });
  return { white: pick('white'), black: pick('black') };
}
