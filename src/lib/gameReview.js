import { Chess } from 'chess.js';

// Chess.com-style Game Review: replay a finished game, asking Stockfish for
// an eval before and after every move, and turn the swing into the same
// badge vocabulary the app already uses for hand-placed annotations (see
// lib/badges.js) — so a reviewed game reads exactly like a coach went
// through it move by move, just automatically.
//
// This is a best-effort approximation of chess.com's own (undocumented)
// classifier, not a reproduction of it — the eval-swing bands below are
// tuned by feel, and "Brilliant"/"Great" in particular are judgment calls
// no plain centipawn diff can make perfectly.

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// A one-shot search: wait for this exact position's top line to reach the
// target depth, then resolve with whatever multipv lines have arrived by
// then (1st and, when there was a real choice, 2nd — used to tell "the only
// good move here" apart from "one of several fine ones").
function searchOnce(engine, fen, depth) {
  return new Promise((resolve) => {
    const lines = {};
    const off = engine.onInfo((info) => {
      if (info.fen !== fen || info.depth < depth) return;
      lines[info.multipv] = info;
      if (info.multipv === 1) {
        off();
        resolve(lines);
      }
    });
    engine.analyze(fen, { depth });
  });
}

// A checkmated or stalemated position has no legal moves at all, so Stockfish
// never emits a `pv` line for it — searchOnce would wait forever. Read it
// off the board directly instead of asking the engine.
function gameOverScore(chess) {
  if (chess.isCheckmate()) {
    // The side to move just got mated — bad for them, so the sign belongs
    // to whoever is NOT to move, the side that just delivered it.
    return { type: 'mate', value: chess.turn() === 'w' ? -1 : 1 };
  }
  return { type: 'cp', value: 0 }; // stalemate, or a draw the engine would call ~0 anyway
}

async function positionLines(engine, chess, fen, depth) {
  if (chess.isGameOver()) {
    return { 1: { score: gameOverScore(chess), sans: [], depth, multipv: 1, fen } };
  }
  return searchOnce(engine, fen, depth);
}

// A score, already in White's-perspective centipawns (or a signed mate
// distance) per lib/engine.js, read from whoever just moved's own side —
// positive means good for them, however the game turns out.
function moverScore(score, mover) {
  if (!score) return 0;
  // A flat, bounded stand-in for "decisive" — not the literal mate distance.
  // Two consecutive searches don't always agree on exactly how many moves a
  // forced mate takes (one ply deeper can lose or find it at this depth), so
  // using the raw mate value here made "still completely winning" look like
  // a multi-thousand-centipawn swing and wrecked the accuracy average. 1000
  // is comfortably past every classification threshold below (all under
  // 300) while no longer swamping it.
  const cp = score.type === 'mate' ? Math.sign(score.value) * 1000 : score.value;
  return mover === 'w' ? cp : -cp;
}

// Did this move offer material the opponent can immediately take, without
// getting it fully back in the same move? The rough shape of a sacrifice —
// not a proof the sac is sound, that's what the eval after it is for.
function sacrificedMaterial(fenBefore, from, to) {
  const board = new Chess(fenBefore);
  const movedPiece = board.get(from);
  if (!movedPiece) return 0;
  let mv;
  try { mv = board.move({ from, to, promotion: 'q' }); } catch { return 0; }
  if (!mv) return 0;
  const gained = mv.captured ? (PIECE_VALUE[mv.captured] ?? 0) : 0;
  const netGiven = (PIECE_VALUE[movedPiece.type] ?? 0) - gained;
  if (netGiven < 2) return 0; // a pawn odds isn't what "brilliant" means here
  // board is now the position after the move, opponent to move — can they
  // just take the piece that landed on `to` back?
  const canRecapture = board.moves({ verbose: true }).some((m) => m.to === to && m.captured);
  return canRecapture ? netGiven : 0;
}

// There's no real opening database here to check theory against, so "book"
// is a stand-in: early in the game, a move that isn't already losing ground
// almost always IS still theory in practice — that's what makes it playable
// this early. Past the opening, the same eval-swing wouldn't mean much (a
// good 25th move isn't "book" just because it was accurate), so this only
// ever fires inside the first few full moves.
const BOOK_PLIES = 10;
const BOOK_LOSS_CEILING = 40;

function classify({
  loss, isTop, gap, sacrificed, moverAfter, ply,
}) {
  if (ply < BOOK_PLIES && loss <= BOOK_LOSS_CEILING) return 'book';
  if (loss <= 60) {
    if (sacrificed > 0 && (isTop || loss <= 20) && moverAfter >= -50) return 'brilliant';
    if (isTop && gap >= 150) return 'great';
    if (isTop || loss <= 10) return 'best';
    if (loss <= 30) return 'excellent';
    return 'good';
  }
  if (loss <= 100) return 'inaccuracy';
  if (loss <= 300) return 'mistake';
  return 'blunder';
}

// Lichess's own published mapping from average centipawn loss to a 0-100
// "accuracy" — reused here rather than inventing a new curve, since it's
// already the number most players recognise.
function accuracyFromAcpl(lossSum, n) {
  if (n === 0) return null;
  const acpl = lossSum / n;
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * acpl) - 3.1669));
}

// `engine` is a dedicated Engine instance the caller owns (and should quit()
// when done) — kept separate from any engine already running live analysis
// so the two never fight over the same search queue.
export async function runGameReview(engine, { baseFen, moves }, { depth = 15, onProgress } = {}) {
  const chess = new Chess(baseFen);
  let fen = chess.fen();
  let lines = await positionLines(engine, chess, fen, depth);

  const badges = {};
  let whiteLoss = 0;
  let whiteMoves = 0;
  let blackLoss = 0;
  let blackMoves = 0;

  for (let i = 0; i < moves.length; i += 1) {
    const mover = chess.turn();
    const fenBefore = fen;
    const linesBefore = lines;
    const moverBefore = moverScore(linesBefore[1]?.score, mover);

    let mv;
    try { mv = chess.move(moves[i]); } catch { mv = null; }
    if (!mv) break;

    fen = chess.fen();
    lines = await positionLines(engine, chess, fen, depth);
    const moverAfter = moverScore(lines[1]?.score, mover);
    // Two independent depth-limited searches of two different positions
    // don't perfectly agree even when the move between them was objectively
    // fine — a few centipawns of horizon-effect wobble is normal noise, not
    // an actual slip. Absorbing a small amount of it keeps a clean forced
    // sequence from reading as a string of "good"s instead of "best"s, and
    // keeps the accuracy average honest instead of nickel-and-diming every
    // move for search jitter that was never really there.
    const loss = Math.max(0, (moverBefore - moverAfter) - 15);

    const isTop = linesBefore[1]?.sans?.[0] === mv.san;
    const gap = linesBefore[2]
      ? moverScore(linesBefore[1]?.score, mover) - moverScore(linesBefore[2]?.score, mover)
      : 0;
    const sacrificed = sacrificedMaterial(fenBefore, mv.from, mv.to);

    badges[i] = classify({
      loss, isTop, gap, sacrificed, moverAfter, ply: i,
    });

    if (mover === 'w') { whiteLoss += loss; whiteMoves += 1; } else { blackLoss += loss; blackMoves += 1; }
    onProgress?.(i + 1, moves.length);
  }

  return {
    badges,
    accuracy: {
      white: accuracyFromAcpl(whiteLoss, whiteMoves),
      black: accuracyFromAcpl(blackLoss, blackMoves),
    },
  };
}
