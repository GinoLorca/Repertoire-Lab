import { createWorker } from 'tesseract.js';
import { Chess } from 'chess.js';

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const base = window.location.origin;
      const worker = await createWorker('eng', 1, {
        workerPath: `${base}/tesseract/worker.min.js`,
        corePath: `${base}/tesseract/tesseract-core-simd.wasm.js`,
        langPath: `${base}/tesseract`,
        gzip: true,
      });
      // No character whitelist: variation titles are ordinary words, and
      // restricting to notation characters turns them into gibberish. Move
      // accuracy is recovered afterwards by legality-checking in textToLine().
      await worker.setParameters({ preserve_interword_spaces: '1' });
      return worker;
    })();
  }
  return workerPromise;
}

export async function ocrImage(imageFile) {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageFile);
  return data.text;
}

// ---------- Chess-aware OCR correction ----------

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

// 't' is a common OCR misread of '+'; real SAN never ends with 't'.
const strip = (san) => san.replace(/[+#?!t]+$/, '');

// Common OCR digit confusions inside a move token (never at position 0).
const DIGIT_FIX = { s: '5', S: '5', l: '1', I: '1', i: '1', B: '8', Z: '2', z: '2', A: '4' };

function tryMove(chess, san) {
  try { return chess.move(san); } catch { return null; }
}

// Candidate spellings for an OCR token, in order of confidence.
function candidates(word) {
  const out = [word];
  // castling: 0-0, O-0, o-o-o, O.O ...
  if (/^[0Oo][-–.]?[0Oo]([-–.]?[0Oo])?$/.test(strip(word))) {
    out.push(strip(word).replace(/[.–]/g, '-').length >= 5 ? 'O-O-O' : 'O-O');
  }
  // E4 -> e4 (uppercase file letter; B stays ambiguous with the bishop, so try both)
  if (/^[A-H]/.test(word)) out.push(word[0].toLowerCase() + word.slice(1));
  // single digit-confusion substitutions after the first character
  for (let i = 1; i < word.length; i += 1) {
    const fix = DIGIT_FIX[word[i]];
    if (fix) out.push(word.slice(0, i) + fix + word.slice(i + 1));
  }
  return out;
}

// Fuzzy fallback: the legal move most similar to the token. Gated so that
// short junk ("aa", "a0") can't fake-match a real move.
function bestLegalMatch(chess, token) {
  const cleaned = strip(token).replace(/[×X]/g, 'x');
  if (cleaned.length < 3) return null;
  const legal = chess.moves();
  let best = null;
  let bestD = Infinity;
  for (const san of legal) {
    const d = editDistance(cleaned, strip(san));
    if (d < bestD) { bestD = d; best = san; }
  }
  const maxD = Math.max(1, Math.floor(cleaned.length / 3));
  return bestD <= maxD ? best : null;
}

// Turn raw OCR text into a validated move line. Tokens that aren't exact
// legal moves get candidate substitutions (0/O, l/1, s/5, t/+, case) and a
// legality-gated fuzzy match. Junk after a substantial valid line (titles,
// UI labels caught by the crop) ends the line instead of failing it.
export function textToLine(rawText) {
  // Start parsing from the first "1." if present — skips titles/labels above the moves.
  let text = rawText;
  const startIdx = text.search(/(?:^|\s)1\s*\.+\s*\S/);
  if (startIdx >= 0) text = text.slice(startIdx);

  const words = text
    .replace(/(\d+)\s*\.+\s*/g, ' ') // detach + drop move numbers
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w) => !/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(w));

  const chess = new Chess();
  const moves = [];
  const corrections = [];
  for (const word of words) {
    // ignore stray punctuation / bullets
    if (!/[a-hA-HKQRNBOxX0-9]/.test(word)) continue;
    let mv = null;
    for (const cand of candidates(word)) {
      mv = tryMove(chess, cand) || tryMove(chess, strip(cand));
      if (mv) break;
    }
    if (!mv) {
      const fixed = bestLegalMatch(chess, word);
      if (fixed) mv = tryMove(chess, fixed);
    }
    if (!mv) {
      // Enough of a line already? Treat the rest as trailing junk (e.g. the
      // OCR picked up the next variation's title or UI labels).
      if (moves.length >= 6) {
        return { ok: true, moves, corrections, trailingJunk: word };
      }
      return { ok: false, moves, corrections, failedToken: word, failedAt: moves.length };
    }
    if (strip(mv.san) !== strip(word)) corrections.push({ from: word, to: mv.san });
    moves.push(mv.san);
  }
  if (moves.length === 0) {
    return { ok: false, moves, corrections, failedToken: '(no moves found)', failedAt: 0 };
  }
  return { ok: true, moves, corrections };
}
