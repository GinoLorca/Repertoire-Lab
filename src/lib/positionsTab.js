// The player page's Positions tab (components/PlayerInsights): Chess Arcade's
// Positions — pawn structures, and the games that reach a position — over that
// player's games. The tab is there with a copy of Chess Arcade that has it
// (ARCADE_POSITIONS, written by scripts/sync-arcade.mjs); with one that
// doesn't, there's no tab, no address for it and nothing asks for it.
import { ARCADE_POSITIONS } from './arcadeBuild';

// The player page's tabs from Chess Arcade, in the page's order.
export const ARCADE_TABS = ['clamp', 'tactics', 'openings', ...(ARCADE_POSITIONS ? ['positions'] : [])];
export const TAB_NAMES = {
  clamp: 'CLAMP', tactics: 'tactics', openings: 'openings', positions: 'positions',
};

// "Find games with this position / this pawn structure", in Game Review: the
// position waits here for that player's Positions to open (once).
const asked = new Map();
const PLACEMENT = /^[pnbrqkPNBRQK1-8]{1,8}(\/[pnbrqkPNBRQK1-8]{1,8}){7}$/;

// What the review sent ({ fen, flip, sub }), kept for that player. False when
// it isn't a position.
export function askFind(playerId, d) {
  const fen = String(d?.fen ?? '').trim();
  if (!playerId || fen.length > 120 || !PLACEMENT.test(fen.split(/\s+/)[0])) return false;
  asked.set(playerId, { fen, flip: Boolean(d.flip), sub: d.sub === 'structures' ? 'structures' : 'find' });
  return true;
}

export function takeFind(playerId) {
  const f = asked.get(playerId) ?? null;
  asked.delete(playerId);
  return f;
}

// A game opened from Positions: how it was then (Chess Arcade's own `place`:
// the sub-tab, a structure's page, what's open on it, a search, how far down)
// and how tall — for the way back from Game Review, once.
const places = new Map();

export function keepPlace(playerId, place, height) {
  if (!playerId || !place || typeof place !== 'object') return;
  places.set(playerId, { place, height: Number.isFinite(height) ? height : 900 });
}

export function takePlace(playerId) {
  const p = places.get(playerId) ?? null;
  places.delete(playerId);
  return p;
}
