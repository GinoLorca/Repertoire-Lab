import {
  START_FEN, startFenOf, moveNumberLabel,
} from './startPos';
import {
  fen4, positionsOf, positionsOnce, lineItem,
} from './positions';

// Position key: piece placement + side to move + castling + en passant.
export { fen4 };

// Index every position reached in every repertoire line.
// Map: fen4 -> [{ opening, chapter, variation, ply }]
// ply = number of moves played to reach the position (variation.moves[ply] is
// the repertoire's next move from there, when it exists) — counted from where
// the line starts, so a line set up from a position is joined at that
// position, ply 0.
// Each line's positions come from lib/positions, which plays a line out once
// and remembers it: building this is then only filing them.
export function buildPositionIndex(openings) {
  const map = new Map();
  for (const opening of openings) {
    for (const chapter of opening.chapters) {
      for (const variation of chapter.variations) {
        const { keys } = positionsOf(variation.moves, startFenOf(variation));
        for (let ply = 0; ply < keys.length; ply += 1) {
          const entry = { opening, chapter, variation, ply };
          const at = map.get(keys[ply]);
          if (at) at.push(entry); else map.set(keys[ply], [entry]);
        }
      }
    }
  }
  return map;
}

// ---------- The index a board or a card checks against, shared ----------
//
// "Their lines, then your whole library" used to be built from scratch by
// whoever asked: once per student card on every redraw of Coaches Corner,
// again each time a student's page or a board opened. Now each owner's lines
// are indexed once — yours a single time for everyone — and kept until one
// of their openings changes; a student's book is their own small index laid
// over yours, hits in the order one index of both would give them (theirs
// first).

const NO_INDEX = new Map(); // nothing to check against; never written to
const NO_LIST = [];

// Reads like the Map buildPositionIndex([...theirs, ...mine]) would be —
// get, has, size, and walking it — without copying either half.
class LayeredIndex {
  constructor(first, second) {
    this.first = first;
    this.second = second;
    this.joined = new Map(); // positions both halves have, once asked for
    this.count = -1;
  }

  get(key) {
    const a = this.first.get(key);
    const b = this.second.get(key);
    if (!a) return b;
    if (!b) return a;
    let both = this.joined.get(key);
    if (!both) {
      both = a.concat(b);
      this.joined.set(key, both);
    }
    return both;
  }

  has(key) { return this.first.has(key) || this.second.has(key); }

  get size() {
    if (this.count < 0) {
      let n = this.second.size;
      for (const key of this.first.keys()) if (!this.second.has(key)) n += 1;
      this.count = n;
    }
    return this.count;
  }

  // In the order one index of both would hold them: the first half's
  // positions, then the second's that the first doesn't have.
  * entries() {
    for (const key of this.first.keys()) yield [key, this.get(key)];
    for (const [key, hits] of this.second) if (!this.first.has(key)) yield [key, hits];
  }

  [Symbol.iterator]() { return this.entries(); }

  * keys() { for (const [key] of this.entries()) yield key; }

  * values() { for (const [, hits] of this.entries()) yield hits; }

  forEach(fn, thisArg) { for (const [key, hits] of this.entries()) fn.call(thisArg, hits, key, this); }
}

// Whose each opening is, worked out once per library (the openings array is
// replaced whenever any opening changes, and only then).
let splits = new WeakMap(); // openings → { mine, byOwner, owners }
// What's kept for one owner — '' is you, otherwise a student's card id —
// while their openings are the very same objects: their index, and their
// lines as lib/positions takes them.
const owners = new Map(); // key → { list, map, items }
const layered = new Map(); // student's card id → LayeredIndex

function splitOwners(openings) {
  let split = splits.get(openings);
  if (!split) {
    const mine = [];
    const byOwner = new Map();
    for (const o of openings) {
      const owner = o.ownerId ?? null;
      if (owner === null) mine.push(o);
      else if (byOwner.has(owner)) byOwner.get(owner).push(o);
      else byOwner.set(owner, [o]);
    }
    split = { mine, byOwner, owners: new Map() };
    splits.set(openings, split);
    // A student with no lines left (or gone altogether) keeps nothing here.
    for (const key of [...owners.keys()]) {
      if (key !== '' && !byOwner.has(key)) { owners.delete(key); layered.delete(key); }
    }
  }
  return split;
}

function ownerOf(split, key) {
  let rec = split.owners.get(key);
  if (rec) return rec;
  const list = key === '' ? split.mine : (split.byOwner.get(key) ?? NO_LIST);
  const kept = owners.get(key);
  if (kept && kept.list.length === list.length && kept.list.every((o, i) => o === list[i])) {
    rec = kept;
  } else {
    rec = { list, map: null, items: null };
    if (list.length) owners.set(key, rec); else owners.delete(key);
  }
  split.owners.set(key, rec);
  return rec;
}

function ownerIndex(split, key) {
  const rec = ownerOf(split, key);
  if (!rec.map) rec.map = rec.list.length ? buildPositionIndex(rec.list) : NO_INDEX;
  return rec.map;
}

function ownerLines(split, key) {
  const rec = ownerOf(split, key);
  if (!rec.items) {
    rec.items = [];
    for (const o of rec.list) for (const c of o.chapters ?? []) for (const v of c.variations ?? []) rec.items.push(lineItem(v));
  }
  return rec.items;
}

// The index for bookOpenings(openings, { studentId, source }) — the same
// positions and hits, in the same order, as building one from that list —
// shared between everyone who asks, and the same object until the lines
// behind it change. Read it (get, has, size, for…of); never write to it.
// The first time, its lines are played out there and then: a screen that
// mustn't wait checks bookLineParts first (lib/usePositions).
export function positionIndexFor(openings, { studentId = null, source = 'both' } = {}) {
  if (source === 'none' || !Array.isArray(openings)) return NO_INDEX;
  const split = splitOwners(openings);
  if (!studentId || source === 'mine') return ownerIndex(split, '');
  const theirs = ownerIndex(split, studentId);
  if (source === 'student') return theirs;
  const mine = ownerIndex(split, '');
  if (theirs.size === 0) return mine;
  if (mine.size === 0) return theirs;
  const kept = layered.get(studentId);
  if (kept && kept.first === theirs && kept.second === mine) return kept;
  const index = new LayeredIndex(theirs, mine);
  layered.set(studentId, index);
  return index;
}

// That book's lines, as lib/positions takes them ({ moves, startFen }), in
// up to two parts — the student's, then yours — each the same array for as
// long as its owner's openings are the same: what a screen checks
// (allCached) and asks for (requestWarm) before it reads the index.
const NO_PARTS = [];
export function bookLineParts(openings, { studentId = null, source = 'both' } = {}) {
  if (source === 'none' || !Array.isArray(openings)) return NO_PARTS;
  const split = splitOwners(openings);
  if (!studentId || source === 'mine') return [ownerLines(split, '')];
  if (source === 'student') return [ownerLines(split, studentId)];
  return [ownerLines(split, studentId), ownerLines(split, '')];
}

// For the tests: forget every index kept here.
export function resetPositionIndexes() {
  owners.clear();
  layered.clear();
  splits = new WeakMap();
}

// The repertoire's continuation(s) from one position: distinct next moves,
// each with an example line it belongs to.
export function bookMovesAt(index, fen) {
  return bookMovesAtKey(index, fen4(fen));
}

function bookMovesAtKey(index, key) {
  const hits = index.get(key) ?? [];
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
// which line does it match best, and where/how did it deviate? `startFen`:
// where the game on the board begins (a position set up in Analysis).
export function matchGameToRepertoire(moves, index, startFen = START_FEN) {
  // keys[i]: the position after i moves, as far as they can be played.
  // (positionsOnce: the line on a board changes with every move you try.)
  const { keys } = positionsOnce(moves, startFen);
  let depth = 0; // number of game moves that stayed within the repertoire
  let lastHits = index.get(keys[0]) ?? [];
  let deviation = null;

  for (let i = 0; i < moves.length; i += 1) {
    if (i + 1 >= keys.length) break; // a move that can't be played
    const hits = index.get(keys[i + 1]) ?? [];
    if (hits.length > 0) {
      depth = i + 1;
      lastHits = hits;
    } else {
      const expected = bookMovesAtKey(index, keys[i]);
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

// The side you play in the repertoire a game follows: for a game with no side
// on record (a pasted PGN, an import), the best guess at which side was yours.
// Null unless the game stays in book at least two moves, and the lines it
// reaches deepest are all played from the one side — the same position can
// sit in a White repertoire and in a Black defence against it.
export function repertoireSide(moves, index, startFen = START_FEN) {
  const { keys } = positionsOnce(moves ?? [], startFen);
  let hits = [];
  let depth = 0;
  for (let i = 0; i + 1 < keys.length; i += 1) {
    const here = index.get(keys[i + 1]) ?? [];
    if (!here.length) break;
    hits = here;
    depth = i + 1;
  }
  if (depth < 2) return null;
  const sides = new Set(hits.map((h) => h.opening?.color).filter((c) => c === 'white' || c === 'black'));
  return sides.size === 1 ? [...sides][0] : null;
}

// Positions a line passes through, as position keys (index 0 = its start).
const fenTrail = (moves, startFen = START_FEN) => positionsOf(moves, startFen).keys;

// Rank every variation by how far it walks in step with the given moves.
// Compares positions rather than move text, so a different move order that
// reaches the same position still counts as a match.
export function rankVariationsByMoves(moves, openings, startFen = START_FEN) {
  // What was typed is only passing through; the library's lines are kept.
  const inputTrail = positionsOnce(moves, startFen).keys;
  const results = [];

  for (const opening of openings) {
    for (const chapter of opening.chapters) {
      for (const variation of chapter.variations) {
        const trail = fenTrail(variation.moves, startFenOf(variation));
        // Lines only walk in step from the same start: one set up from a
        // position isn't a match for moves played from the beginning.
        if (trail[0] !== inputTrail[0]) continue;
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

export function moveLabel(ply, startFen = START_FEN) {
  // ply = 0-based index of a move from `startFen` (the game's start by default)
  return moveNumberLabel(ply, startFen, '…');
}

// Which repertoire the analysis board checks a game against (the board's ⚙,
// and Settings). On a student's game: their lines and yours together — they
// are taught yours, and a coach analysing needs the whole library, not only
// the few lines sent so far — or just one of the two, or none at all. On
// your own game it's yours, or none.
export const REPERTOIRE_SOURCES = [
  { id: 'both', label: 'Mine + the student’s', hint: 'the student’s lines first, then your whole library' },
  { id: 'mine', label: 'My whole library', hint: 'every line of yours, whoever’s game it is' },
  { id: 'student', label: 'Only the student’s', hint: 'just the lines they have' },
  { id: 'none', label: 'No repertoire', hint: 'the engine on its own' },
];

export function bookOpenings(openings, { studentId = null, source = 'both' } = {}) {
  if (source === 'none') return [];
  const mine = (openings ?? []).filter((o) => (o.ownerId ?? null) === null);
  if (!studentId) return mine;
  const theirs = (openings ?? []).filter((o) => o.ownerId === studentId);
  if (source === 'mine') return mine;
  if (source === 'student') return theirs;
  return [...theirs, ...mine];
}

// What the board's repertoire panel calls the book it's checking.
export function bookName(source, studentName) {
  if (source === 'none') return 'No repertoire';
  if (!studentName || source === 'mine') return 'Your repertoire';
  if (source === 'student') return `${studentName}'s repertoire`;
  return `${studentName}'s + yours`;
}
