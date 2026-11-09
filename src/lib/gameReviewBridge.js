// Repertoire Lab ↔ Chess Arcade's Game Review (public/arcade, scripts/sync-arcade.mjs).
//
// The Game Review tab is Chess Arcade's own review screen in a frame. This
// file is everything the two sides need to agree on, kept pure so
// tests/gameReviewBridge.test.mjs covers it:
//
//   · A game as Chess Arcade opens it (a Lichess-shaped game: SAN moves in one
//     string, players, a winner) from a Repertoire Lab game, or a pasted one.
//   · The id it goes by over there. Chess Arcade keeps a game's note and its
//     analysis under that id, and only takes ids of its own shape: eight word
//     characters. One with an underscore, so it is never taken for a Lichess
//     game (Share would offer a lichess.org link to it).
//   · What Repertoire Lab keeps on the game: game.gameReview = { note, an },
//     the two texts Chess Arcade saves for it — the Notes card, and the
//     analysis on the board (comments, side lines, arrows and squares,
//     badges, CLAMP letters and their squares, tactics, highlights) as the one
//     JSON record Chess Arcade writes. Kept exactly as written, never taken
//     apart, so nothing Chess Arcade adds later is lost on the way through.
import { START_FEN } from './startPos';
import {
  cleanGameReview, parseDoc, docFromGame, serializeDoc,
} from './analysisDoc';

// Chess Arcade's own limit on one note (GN_MAX): a longer text it would cut.
export const MAX_TEXT = 10000;

// FNV-1a, 32 bits: the same game always gets the same id over there.
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const SIX = 36 ** 6;
const six = (n) => (n % SIX).toString(36).padStart(6, '0');

// A saved game's id in Chess Arcade: 'r_' and six base-36 characters.
export const arcadeId = (gameId) => `r_${six(fnv(String(gameId)))}`;
// A game that isn't saved yet (pasted, from a file): one of its own, for now.
export const tempArcadeId = (rand = Math.random) => `t_${six(Math.floor(rand() * SIX))}`;
export const isArcadeId = (id) => /^[rt]_[0-9a-z]{6}$/.test(String(id ?? ''));

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const slug = (name) => clip(name, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const rating = (v) => (/^\d{2,4}$/.test(String(v ?? '').trim()) ? Number(v) : undefined);

function player(name, elo, fallback) {
  const n = clip(name, 60) || fallback;
  const out = { user: { name: n, id: slug(n) || fallback.toLowerCase() } };
  const r = rating(elo);
  if (r) out.rating = r;
  return out;
}

// '1-0', '0-1', '½-½' (or 1/2-1/2), anything else unknown.
function ending(result) {
  const r = String(result ?? '').trim();
  if (r === '1-0') return { winner: 'white' };
  if (r === '0-1') return { winner: 'black' };
  if (r === '½-½' || r === '1/2-1/2') return {};
  return { status: 'started' }; // shown as "*"
}

const dateMs = (d) => {
  if (typeof d === 'number' && Number.isFinite(d)) return d;
  const t = d ? Date.parse(String(d).replace(/\./g, '-')) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

// A game as Chess Arcade's review opens it.
//
//   src  — a Repertoire Lab game ({ name, moves, date, meta }) or anything of
//          that shape: a pasted PGN's game is put into it first.
//   id   — its Chess Arcade id (arcadeId / tempArcadeId).
//   side — whose game it is, when that's known: Chess Arcade grades that
//          side's moves as yours, puts it at the bottom and lets CLAMP letters
//          go on its moves. meta.color, otherwise.
export function arcadeGame(src, id, { side } = {}) {
  const m = src?.meta ?? {};
  const moves = (Array.isArray(src?.moves) ? src.moves : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim());
  const me = side ?? m.color;
  const fen = typeof src?.startFen === 'string' && src.startFen.trim() && src.startFen.trim() !== START_FEN
    ? src.startFen.trim() : '';
  const game = {
    id,
    moves: moves.join(' '),
    players: { white: player(m.white, m.whiteElo, 'White'), black: player(m.black, m.blackElo, 'Black') },
    variant: fen ? 'fromPosition' : 'standard',
    rated: false,
    ...ending(m.result),
  };
  if (fen) game.initialFen = fen;
  if (me === 'white' || me === 'black') game._me = me;
  const at = dateMs(src?.date) ?? dateMs(m.date);
  if (at) game.createdAt = at;
  return game;
}

// What's kept on a game: its texts and when they were written ({ note, an,
// lr?, at } — lr: a Larry Review pasted in), or null when there's nothing.
export const cleanRecords = (rec) => cleanGameReview(rec);

export const sameRecords = (a, b) => (a?.note ?? '') === (b?.note ?? '') && (a?.an ?? '') === (b?.an ?? '')
  && (a?.lr ?? '') === (b?.lr ?? '');

// Whether a game has anything from Game Review on it, for the game lists.
export const hasGameReview = (game) => Boolean(cleanRecords(game?.gameReview));

// A pasted or uploaded game (lib/pgnArchive's indexGames item and its entry)
// in a game's shape, for arcadeGame and for saving it.
export function fromArchive(item, entry) {
  return {
    name: item?.name || entry?.name || 'Game',
    moves: entry?.moves ?? [],
    startFen: entry?.startFen ?? null,
    date: item?.date || null,
    meta: {
      white: item?.white || entry?.players?.white || '',
      whiteElo: item?.whiteElo || '',
      black: item?.black || entry?.players?.black || '',
      blackElo: item?.blackElo || '',
      result: item?.result || '',
      event: item?.event || '',
      round: item?.round || '',
      date: item?.date || '',
    },
  };
}

// ---------- Whose copy ----------
//
// Most games have one copy of their Game Review: game.gameReview, on the
// game. A game on a linked student's card that the coach typed in shares it
// with the student's account field by field (lib/cloud/gameLink's
// SHARED_MAPS), like the rest of the game's analysis.
//
// A student's OWN game is a record only they write — so a coach's Game
// Review of it is the coach's review layer (lib/cloud/reviews): the review
// document on the coach's card (game.review.body) carries it as gameReview,
// and arrives in the student's account as one of game.reviews. Whichever copy
// was written last is the one that opens, on either side; each side only ever
// writes its own.

// The coach's side of a student's own game: their review layer is theirs to write.
export const writesReviewLayer = (game, player) => player?.kind === 'student' && game?.link?.origin === 'student';

const layerOf = (body) => (typeof body === 'string' ? cleanRecords(parseDoc(body)?.gameReview) : null);

export function recordsFor(game, player) {
  const copies = [cleanRecords(game?.gameReview)];
  if (writesReviewLayer(game, player)) copies.push(layerOf(game?.review?.body));
  for (const r of Object.values(game?.reviews ?? {})) {
    if (r && !r.removed) copies.push(layerOf(r.body));
  }
  let best = null;
  for (const c of copies) if (c && (!best || (c.at ?? 0) > (best.at ?? 0))) best = c;
  return best;
}

// The coach's review document with this Game Review in it (or taken out): the
// review written in Studio, if there is one, kept as it is around it.
export function withGameReview(body, game, records) {
  const doc = parseDoc(body) ?? docFromGame({ moves: game?.moves ?? [] });
  const rec = cleanRecords(records);
  if (rec) doc.gameReview = rec; else delete doc.gameReview;
  return serializeDoc(doc);
}

// ---------- A player's CLAMP and Tactics (components/PlayerInsights) ----------
//
// Chess Arcade's two Game History tabs over one player's games: each game
// with something marked in Game Review — CLAMP letters (k) or tactics (t) in
// its analysis record — and the summary those tabs read a game by (Chess
// Arcade's gnCleanG): whose side, the result, the speed, when, the moves.

// Whose game it is: the side on record, else the side whose name is the
// player's, else White.
function sideFor(game, player) {
  const c = game?.meta?.color;
  if (c === 'white' || c === 'black') return c;
  const names = [player?.name, player?.profile?.chesscom, player?.profile?.lichess]
    .filter(Boolean).map((n) => String(n).trim().toLowerCase());
  const w = String(game?.meta?.white ?? '').trim().toLowerCase();
  const b = String(game?.meta?.black ?? '').trim().toLowerCase();
  if (b && names.includes(b) && !names.includes(w)) return 'black';
  return 'white';
}

function resultFor(result, me) {
  const r = String(result ?? '').trim();
  if (r === '1-0') return me === 'white' ? 'win' : 'loss';
  if (r === '0-1') return me === 'black' ? 'win' : 'loss';
  return 'draw';
}

// "600+5" (seconds, a PGN's TimeControl) or "G/60;d5" / "G/90+30" (US Chess,
// minutes) → Chess Arcade's speed and its "base-increment" key. Anything else:
// classical, the usual over the board.
export function speedOf(timeControl) {
  const t = String(timeControl ?? '').trim();
  let base = null;
  let inc = 0;
  let m = /^(\d{1,5})(?:\+(\d{1,3}))?$/.exec(t);
  if (m) { base = Number(m[1]); inc = Number(m[2] ?? 0); }
  m = !m && /^G\s*\/\s*(\d{1,3})(?:\s*[;+]\s*(?:d|inc)?\s*(\d{1,3}))?/i.exec(t);
  if (m) { base = Number(m[1]) * 60; inc = Number(m[2] ?? 0); }
  if (base == null) return { speed: 'classical', tc: '' };
  const est = base + 40 * inc;
  const speed = est < 180 ? 'bullet' : est < 480 ? 'blitz' : est < 1500 ? 'rapid' : 'classical';
  return { speed, tc: `${base}-${inc}` };
}

const ratingOrNull = (v) => (/^\d{2,4}$/.test(String(v ?? '').trim()) ? Number(v) : null);

export function insightSummary(game, player) {
  const me = sideFor(game, player);
  const m = game?.meta ?? {};
  const moves = (game?.moves ?? []).filter((s) => typeof s === 'string' && s.trim());
  const opp = me === 'white' ? m.black : m.white;
  const { speed, tc } = speedOf(m.timeControl);
  const at = typeof game?.date === 'number' ? game.date : Date.parse(String(m.date ?? '').replace(/\./g, '-'));
  return {
    me,
    res: resultFor(m.result, me),
    speed,
    rated: false,
    tc,
    status: '',
    at: Number.isFinite(at) ? at : 0,
    eco: '',
    opening: '',
    opp: String(opp ?? '').trim().slice(0, 40) || 'Opponent',
    oppId: String(opp ?? '').trim().toLowerCase().replace(/[^\w-]+/g, '-').slice(0, 30),
    oppTitle: '',
    oppRating: ratingOrNull(me === 'white' ? m.blackElo : m.whiteElo),
    myRating: ratingOrNull(me === 'white' ? m.whiteElo : m.blackElo),
    plies: moves.length,
    variant: 'standard',
    fen: '',
    san: moves.join(' '),
  };
}

// Whether a game's analysis record has CLAMP letters or tactics on it.
export function marksIn(an) {
  if (typeof an !== 'string' || !an.trim()) return { clamp: false, tactics: false };
  try {
    const A = JSON.parse(an);
    return {
      clamp: Array.isArray(A?.k) && A.k.length > 0,
      tactics: Array.isArray(A?.t) && A.t.length > 0,
    };
  } catch {
    return { clamp: false, tactics: false };
  }
}

// The player's marked games, as Chess Arcade's two tabs take them. Their ids
// are Chess Arcade's (arcadeId), so `byArcadeId` leads back to the game.
export function insightGames(player) {
  const games = [];
  const byArcadeId = new Map();
  for (const game of player?.games ?? []) {
    if (!(game.moves?.length > 0)) continue;
    const rec = recordsFor(game, player);
    const marks = marksIn(rec?.an);
    if (!marks.clamp && !marks.tactics) continue;
    const id = arcadeId(game.id);
    byArcadeId.set(id, game.id);
    games.push({ id, an: rec.an, summary: insightSummary(game, player), ...marks });
  }
  return { games, byArcadeId };
}
