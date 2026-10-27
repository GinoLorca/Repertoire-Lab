import {
  variationPgn, movesToMovetext, safeFilename,
} from './pgn';
import { canonicalStartFen, START_FEN } from './startPos';

// Sharing one repertoire line: its PGN through the device's share sheet
// (Messages, Mail, AirDrop, Files…), on the clipboard, as a .pgn download, or
// as a link to Lichess's analysis board, which anyone can open.

// The line's PGN and the name its file goes by.
export function linePgn(opening, chapter, variation) {
  return {
    pgn: variationPgn(opening, chapter, variation),
    filename: `${safeFilename(variation.name)}.pgn`,
    title: `${opening.name} — ${variation.name}`,
  };
}

// Whether this browser has a share sheet at all (Safari on an iPad, iPhone
// or Mac, and phones generally; most desktop browsers don't).
export const hasShareSheet = (nav = globalThis.navigator) => typeof nav?.share === 'function';

// The share sheet, with the PGN as a .pgn file where the browser takes files
// (Safari does), else as text. Called straight from a tap: a share sheet
// only opens in answer to one. 'shared', 'cancelled' (closed without
// choosing) or 'failed'.
export async function sharePgn({ pgn, filename, title }, nav = globalThis.navigator) {
  if (!hasShareSheet(nav)) return 'failed';
  const tries = [];
  if (typeof File === 'function') {
    const file = new File([pgn], filename, { type: 'application/x-chess-pgn' });
    if (nav.canShare?.({ files: [file] })) tries.push({ files: [file], title });
  }
  tries.push({ title, text: pgn });
  for (const data of tries) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  return 'failed';
}

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
