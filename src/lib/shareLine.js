import { movesToMovetext } from './pgn';
import { canonicalStartFen, START_FEN } from './startPos';

// Sharing one repertoire line as a message anyone can read and open: the
// line's name, its moves, and a link to Lichess's analysis board with the
// line on it — free, and nothing to install or sign up for.
//
//   Caro-Kann Exchange Variation: 4.Nf3 #4
//
//   1.e4 c6 2.d4 d5 3.exd5 cxd5 4.Nf3 Nc6 …
//
//   Open in Lichess: https://lichess.org/analysis/pgn/1.e4_c6_…

// Whether this browser has a share sheet at all (Safari on an iPad, iPhone
// or Mac, and phones generally; most desktop browsers don't).
export const hasShareSheet = (nav = globalThis.navigator) => typeof nav?.share === 'function';

// Lichess's analysis board with the line on it, from your side of the board
// (lichess.org/analysis/pgn/<pgn>: it reads "_" as a space and drops "+",
// so a check sign is left off — the moves read the same without it). A
// line from a set-up position carries its FEN, as a PGN does.
export function lichessUrl(opening, variation) {
  const startFen = canonicalStartFen(variation.startFen);
  const moves = movesToMovetext(variation.moves, {}, {}, startFen ?? START_FEN);
  const text = `${startFen ? `[SetUp "1"] [FEN "${startFen}"] ` : ''}${moves}`
    .replace(/\+/g, '')
    .replace(/ /g, '_');
  const path = encodeURIComponent(text).replace(/%2F/g, '/');
  return `https://lichess.org/analysis/pgn/${path}${opening.color === 'black' ? '?color=black' : ''}`;
}

// The message: plain moves (notes, glyphs and arrows stay in the app), and
// for a line set up from a position, that position, so the moves make sense.
export function lineMessage(opening, variation) {
  const startFen = canonicalStartFen(variation.startFen);
  return [
    variation.name,
    ...(startFen ? [`From the position: ${startFen}`] : []),
    movesToMovetext(variation.moves, {}, {}, startFen ?? START_FEN),
    `Open in Lichess: ${lichessUrl(opening, variation)}`,
  ].join('\n\n');
}

// The share sheet, with the message as text — the link inside it, so an app
// that would keep only a separate link (Copy, on an iPhone) keeps it all.
// Called straight from a tap: a share sheet only opens in answer to one.
// 'shared', 'cancelled' (closed without choosing) or 'failed'.
export async function shareMessage(text, nav = globalThis.navigator) {
  if (!hasShareSheet(nav)) return 'failed';
  try {
    await nav.share({ text });
    return 'shared';
  } catch (err) {
    return err?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
