import { Chess } from 'chess.js';

// Position key: piece placement + side to move + castling + en passant.
export const fen4 = (fen) => fen.split(' ').slice(0, 4).join(' ');

// Index every position reached in every repertoire line.
// Map: fen4 -> [{ opening, chapter, variation, ply }]
// ply = number of moves played to reach the position (variation.moves[ply] is
// the repertoire's next move from there, when it exists).
export function buildPositionIndex(openings) {
  const map = new Map();
  const add = (key, entry) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  };
  for (const opening of openings) {
    for (const chapter of opening.chapters) {
      for (const variation of chapter.variations) {
        const chess = new Chess();
        add(fen4(chess.fen()), { opening, chapter, variation, ply: 0 });
        for (let i = 0; i < variation.moves.length; i += 1) {
          try { chess.move(variation.moves[i]); } catch { break; }
          add(fen4(chess.fen()), { opening, chapter, variation, ply: i + 1 });
        }
      }
    }
  }
  return map;
}

// The repertoire's continuation(s) from one position: distinct next moves,
// each with an example line it belongs to.
export function bookMovesAt(index, fen) {
  const hits = index.get(fen4(fen)) ?? [];
  const byMove = new Map();
  for (const h of hits) {
    const next = h.variation.moves[h.ply];
    if (!next) continue;
    if (!byMove.has(next)) {
      byMove.set(next, { san: next, opening: h.opening, chapter: h.chapter, variation: h.variation });
    }
  }
  return [...byMove.values()];
}

// Walk a game against the repertoire: how deep does it stay "in book",
// which line does it match best, and where/how did it deviate?
export function matchGameToRepertoire(moves, index) {
  const chess = new Chess();
  let depth = 0; // number of game moves that stayed within the repertoire
  let lastHits = index.get(fen4(chess.fen())) ?? [];
  let deviation = null;

  for (let i = 0; i < moves.length; i += 1) {
    const expected = bookMovesAt(index, chess.fen());
    try { chess.move(moves[i]); } catch { break; }
    const hits = index.get(fen4(chess.fen())) ?? [];
    if (hits.length > 0) {
      depth = i + 1;
      lastHits = hits;
    } else {
      if (expected.length > 0) {
        deviation = { atPly: i, played: moves[i], expected: expected.map((e) => e.san) };
      }
      break;
    }
  }

  if (depth === 0) return { matched: false };

  // Best matching line: deepest hit, preferring lines that continue further.
  const best = [...lastHits].sort((a, b) => (b.variation.moves.length - a.variation.moves.length))[0];
  return {
    matched: true,
    depth,
    opening: best.opening,
    chapter: best.chapter,
    variation: best.variation,
    exhausted: depth >= moves.length, // whole game stayed in book
    deviation,
  };
}

// Positions a line passes through, as position keys (index 0 = start).
function fenTrail(moves) {
  const chess = new Chess();
  const trail = [fen4(chess.fen())];
  for (const san of moves) {
    try { chess.move(san); } catch { break; }
    trail.push(fen4(chess.fen()));
  }
  return trail;
}

// Rank every variation by how far it walks in step with the given moves.
// Compares positions rather than move text, so a different move order that
// reaches the same position still counts as a match.
export function rankVariationsByMoves(moves, openings) {
  const inputTrail = fenTrail(moves);
  const results = [];

  for (const opening of openings) {
    for (const chapter of opening.chapters) {
      for (const variation of chapter.variations) {
        const trail = fenTrail(variation.moves);
        let common = 0;
        while (
          common + 1 < inputTrail.length
          && common + 1 < trail.length
          && inputTrail[common + 1] === trail[common + 1]
        ) common += 1;

        if (common === 0) continue;
        results.push({
          opening,
          chapter,
          variation,
          depth: common,                                   // moves shared
          exact: common === moves.length && common === variation.moves.length,
          coversInput: common === moves.length,            // repertoire continues past your line
          divergesAt: common < moves.length ? common : null,
          played: common < moves.length ? moves[common] : null,
          book: variation.moves[common] ?? null,
        });
      }
    }
  }

  return results.sort((a, b) => b.depth - a.depth || a.variation.moves.length - b.variation.moves.length);
}

export function moveLabel(ply) {
  // ply = 0-based index of a move in the game
  return `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '…'}`;
}
