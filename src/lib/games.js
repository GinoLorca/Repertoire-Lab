import { Chess } from 'chess.js';
import { fen4 } from './repertoire';

export const OFFBEAT = 'offbeat';

export const EVENT_TYPES = [
  { value: 'otb', label: 'Over the board' },
  { value: 'chess.com', label: 'Chess.com' },
  { value: 'lichess', label: 'Lichess' },
  { value: 'other', label: 'Other' },
];

export const RESULTS = ['1-0', '0-1', '½-½', '*'];

// Chess.com writes Event "Live Chess" for ordinary games and Lichess writes
// things like "Rated Blitz game" — neither says anything, so online games read
// as plain "Online Chess" wherever they're shown.
const GENERIC_EVENT = /^(live chess|rated\s+\w+\s+game|casual\s+\w+\s+game|online chess)$/i;

export function tidyEvent(name, type) {
  if (type !== 'chess.com' && type !== 'lichess') return name;
  if (!name || GENERIC_EVENT.test(name.trim())) return 'Online Chess';
  return name;
}

// Deepest point at which a game stands in a repertoire position — checked at
// every move, so a game that wanders in later (a transposition, or an opponent
// steering back) is still recognised.
export function classifyGame(moves = [], index) {
  if (!index) return { matched: false };
  const chess = new Chess();
  let best = null;
  let contiguous = 0; // plies from move 1 that stayed in book
  let stillContiguous = true;

  const consider = (hits, gamePly) => {
    for (const hit of hits) {
      const score = hit.ply * 1000 + hit.variation.moves.length;
      if (!best || score > best.score) best = { ...hit, score, gamePly };
    }
  };

  consider(index.get(fen4(chess.fen())) ?? [], 0);

  for (let i = 0; i < moves.length; i += 1) {
    try { chess.move(moves[i]); } catch { break; }
    const hits = index.get(fen4(chess.fen())) ?? [];
    if (hits.length > 0) {
      consider(hits, i + 1);
      if (stillContiguous) contiguous = i + 1;
    } else if (stillContiguous) {
      stillContiguous = false;
    }
  }

  if (!best || best.ply === 0) return { matched: false, contiguous: 0 };
  return {
    matched: true,
    opening: best.opening,
    chapter: best.chapter,
    variation: best.variation,
    bookPly: best.ply, // how far into the repertoire line the game reached
    gamePly: best.gamePly, // the move of the game where that happened
    contiguous,
    // The game left the repertoire (or never followed it) and came back.
    transposed: best.gamePly > contiguous || contiguous === 0,
  };
}

export const repCategoryId = (openingId, chapterId) => `rep:${openingId}:${chapterId}`;
export const customCategoryId = (id) => `custom:${id}`;

// Where a game files: an explicit choice wins, otherwise whatever the
// repertoire recognises, otherwise the off-beat shelf.
export function categoryOf(game, index, state) {
  const manual = game.meta?.categoryId;
  if (manual) {
    if (manual.startsWith('custom:')) {
      const custom = (state.categories ?? []).find((c) => customCategoryId(c.id) === manual);
      return {
        id: manual,
        label: custom?.name ?? 'Custom category',
        kind: 'custom',
        auto: false,
      };
    }
    if (manual === OFFBEAT) {
      return { id: OFFBEAT, label: 'Off-beat / unclassified', kind: 'offbeat', auto: false };
    }
    const [, openingId, chapterId] = manual.split(':');
    const opening = state.openings.find((o) => o.id === openingId);
    const chapter = opening?.chapters.find((c) => c.id === chapterId);
    if (opening && chapter) {
      return {
        id: manual,
        label: `${opening.name} — ${chapter.name}`,
        kind: 'repertoire',
        opening,
        chapter,
        auto: false,
      };
    }
  }

  const hit = classifyGame(game.moves, index);
  if (hit.matched) {
    return {
      id: repCategoryId(hit.opening.id, hit.chapter.id),
      label: `${hit.opening.name} — ${hit.chapter.name}`,
      kind: 'repertoire',
      opening: hit.opening,
      chapter: hit.chapter,
      variation: hit.variation,
      match: hit,
      auto: true,
    };
  }
  return { id: OFFBEAT, label: 'Off-beat / unclassified', kind: 'offbeat', auto: true };
}

// Every category a game could be filed under, for the pickers.
export function categoryOptions(state) {
  const options = [];
  for (const opening of state.openings) {
    for (const chapter of opening.chapters) {
      options.push({
        id: repCategoryId(opening.id, chapter.id),
        label: `${opening.name} — ${chapter.name}`,
        group: opening.name,
      });
    }
  }
  for (const custom of state.categories ?? []) {
    options.push({ id: customCategoryId(custom.id), label: custom.name, group: 'My categories' });
  }
  options.push({ id: OFFBEAT, label: 'Off-beat / unclassified', group: 'My categories' });
  return options;
}

// W/D/L from the player's point of view, using the colour recorded per game.
// Best-effort guess at which roster entry a name belongs to — a PGN's White/
// Black, say. Matches the player's own name first, then the online handles on
// their profile (a chess.com/lichess username is a stronger signal than a
// display name, which can be anything). Never authoritative — callers use
// this to pre-select a destination, always left changeable by hand.
export function matchPlayerByName(name, players) {
  const needle = (name ?? '').trim().toLowerCase();
  if (!needle) return null;
  const byOwnName = players.find((p) => p.name.trim().toLowerCase() === needle);
  if (byOwnName) return byOwnName;
  return players.find((p) => {
    const profile = p.profile ?? {};
    return [profile.chesscom, profile.lichess].some(
      (handle) => handle && handle.trim().toLowerCase() === needle,
    );
  }) ?? null;
}

export function playerRecord(games) {
  const tally = { wins: 0, draws: 0, losses: 0, other: 0 };
  for (const game of games) {
    const { result, color } = game.meta ?? {};
    if (!result || result === '*' || !color || color === 'none') { tally.other += 1; continue; }
    if (result === '½-½') { tally.draws += 1; continue; }
    const whiteWon = result === '1-0';
    const playerIsWhite = color === 'white';
    if (whiteWon === playerIsWhite) tally.wins += 1;
    else tally.losses += 1;
  }
  return tally;
}

export function resultFor(game) {
  const { result, color } = game.meta ?? {};
  if (!result || result === '*') return { label: 'unfinished', kind: 'none' };
  if (result === '½-½') return { label: 'draw', kind: 'draw' };
  if (!color || color === 'none') return { label: result, kind: 'none' };
  const won = (result === '1-0') === (color === 'white');
  return { label: won ? 'win' : 'loss', kind: won ? 'win' : 'loss' };
}
