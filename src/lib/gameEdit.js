import { Chess } from 'chess.js';

// ---------------------------------------------------------------------------
// Move-by-move validation for the verify screen.
// A transcription can only be trusted up to its first bad move, so each move
// is checked in sequence and anything after a break is marked unverifiable.
// ---------------------------------------------------------------------------

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

const strip = (san) => String(san ?? '').replace(/[+#?!]+$/, '');

// Legal moves ranked by similarity to what was transcribed — the candidate
// list a human picks from when a cell is wrong or unreadable.
export function suggestMoves(token, legal, limit = 6) {
  const cleaned = strip(token).replace(/[×X]/g, 'x');
  if (!cleaned) return legal.slice(0, limit);
  return [...legal]
    .map((san) => ({ san, d: editDistance(cleaned, strip(san)) }))
    .sort((a, b) => a.d - b.d || a.san.length - b.san.length)
    .slice(0, limit)
    .map((x) => x.san);
}

// rows[i] = { raw, status, san?, fenBefore?, fenAfter?, legal[], suggestions[] }
// status: 'ok' | 'illegal' | 'unknown' (?? placeholder) | 'blocked' (after a break)
export function validateSequence(sans) {
  const chess = new Chess();
  const rows = [];
  let broken = false;

  for (let i = 0; i < sans.length; i += 1) {
    const raw = sans[i];
    if (broken) {
      rows.push({ raw, status: 'blocked', legal: [], suggestions: [] });
      continue;
    }
    const fenBefore = chess.fen();
    const legal = chess.moves();

    if (!raw || /^\?\?+$/.test(String(raw).trim())) {
      rows.push({ raw: raw ?? '??', status: 'unknown', fenBefore, legal, suggestions: legal.slice(0, 8) });
      broken = true;
      continue;
    }
    let mv = null;
    try { mv = chess.move(String(raw).trim()); } catch { mv = null; }
    if (mv) {
      rows.push({ raw, status: 'ok', san: mv.san, fenBefore, fenAfter: chess.fen(), legal, suggestions: [] });
    } else {
      rows.push({ raw, status: 'illegal', fenBefore, legal, suggestions: suggestMoves(raw, legal) });
      broken = true;
    }
  }
  return rows;
}

// Position after `count` verified moves (used to drive the preview board).
export function fenAfter(rows, count) {
  if (count <= 0) return new Chess().fen();
  const row = rows[count - 1];
  return row?.fenAfter ?? row?.fenBefore ?? new Chess().fen();
}

export function summarize(rows) {
  const ok = rows.filter((r) => r.status === 'ok').length;
  const problems = rows.filter((r) => r.status === 'illegal' || r.status === 'unknown').length;
  const blocked = rows.filter((r) => r.status === 'blocked').length;
  return { ok, problems, blocked, total: rows.length, clean: problems === 0 && blocked === 0 };
}

// Split a flat move list into scoresheet rows: [{ n, white, black }]
export function toScoresheetRows(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += 2) {
    out.push({ n: i / 2 + 1, whiteIndex: i, blackIndex: i + 1 < rows.length ? i + 1 : null });
  }
  return out;
}
