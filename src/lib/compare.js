import {
  START_FEN, startFenOf, newGameAt, moveNumberLabel, fen4,
} from './startPos';

// How many opening moves two lines share. Compared by position rather than by
// notation, so a different move order that reaches the same place still counts
// as "the same so far". Lines from different starts (one set up from a
// position) share nothing.
export function sharedPrefix(a = [], b = [], aStart = START_FEN, bStart = START_FEN) {
  const ca = newGameAt(aStart);
  const cb = newGameAt(bStart);
  const key = (c) => fen4(c.fen());
  if (key(ca) !== key(cb)) return 0;
  let n = 0;
  while (n < a.length && n < b.length) {
    try {
      ca.move(a[n]);
      cb.move(b[n]);
    } catch {
      break;
    }
    if (key(ca) !== key(cb)) break;
    n += 1;
  }
  return n;
}

// Everything about how two lines relate: where they part company, what each
// plays at that moment, and how much of each line is left afterwards.
export function diverge(a, b) {
  const aStart = startFenOf(a);
  const bStart = startFenOf(b);
  const at = sharedPrefix(a?.moves ?? [], b?.moves ?? [], aStart, bStart);
  const aMove = a?.moves?.[at] ?? null;
  const bMove = b?.moves?.[at] ?? null;
  return {
    at, // ply index of the first differing move
    aMove,
    bMove,
    // One line simply being a prefix of the other is worth saying out loud.
    contained: aMove === null || bMove === null,
    aRest: (a?.moves ?? []).slice(at),
    bRest: (b?.moves ?? []).slice(at),
    maxLen: Math.max(a?.moves?.length ?? 0, b?.moves?.length ?? 0),
    // Lines from two different positions don't part anywhere: they never met.
    sameStart: fen4(newGameAt(aStart).fen()) === fen4(newGameAt(bStart).fen()),
  };
}

// Flat list of every variation with its opening and chapter attached.
export function allVariations(openings) {
  const out = [];
  for (const opening of openings) {
    for (const chapter of opening.chapters) {
      for (const variation of chapter.variations) out.push({ opening, chapter, variation });
    }
  }
  return out;
}

// Lines most worth comparing against `target`: the ones that follow it longest
// before doing something different. Same chapter first, then the rest.
export function siblingsOf(target, openings, limit = 40) {
  if (!target) return [];
  return allVariations(openings)
    .filter((it) => it.variation.id !== target.variation.id)
    .map((it) => {
      const at = sharedPrefix(
        target.variation.moves, it.variation.moves, startFenOf(target.variation), startFenOf(it.variation),
      );
      return {
        ...it,
        at,
        sameChapter: it.chapter.id === target.chapter.id,
        sameOpening: it.opening.id === target.opening.id,
      };
    })
    .filter((it) => it.at > 0)
    .sort((x, y) => (
      y.at - x.at
      || (y.sameChapter ? 1 : 0) - (x.sameChapter ? 1 : 0)
      || (y.sameOpening ? 1 : 0) - (x.sameOpening ? 1 : 0)
    ))
    .slice(0, limit);
}

// Positions after each move, starting from the line's start.
export function fensFor(moves = [], startFen = START_FEN) {
  const chess = newGameAt(startFen);
  const out = [chess.fen()];
  for (const san of moves) {
    try { chess.move(san); } catch { break; }
    out.push(chess.fen());
  }
  return out;
}

// from/to squares of one move, for drawing the arrow that marks a split.
export function moveSquares(moves, ply, startFen = START_FEN) {
  if (ply == null || ply < 0 || ply >= moves.length) return null;
  const chess = newGameAt(startFen);
  for (let i = 0; i < ply; i += 1) {
    try { chess.move(moves[i]); } catch { return null; }
  }
  try {
    const mv = chess.move(moves[ply]);
    return mv ? { from: mv.from, to: mv.to, san: mv.san } : null;
  } catch {
    return null;
  }
}

// "4." for White's move, "4…" for Black's — from where the line starts.
export const plyLabel = (ply, startFen = START_FEN) => moveNumberLabel(ply, startFen, '…');
