import { Chess } from 'chess.js';
import { badgeIdForNag, badgeIdForGlyph, badgeSuffix, BADGE_BY_ID } from './badges';

// ---------- Tokenizing movetext ----------

function tokenize(input) {
  // A pasted game usually arrives with its PGN tag pairs attached. They aren't
  // moves, so drop them before reading the movetext.
  const movetext = input.replace(/\[\s*\w+\s+"[^"]*"\s*\]/g, ' ');
  const tokens = [];
  let i = 0;
  while (i < movetext.length) {
    const c = movetext[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '{') {
      const end = movetext.indexOf('}', i);
      const text = movetext.slice(i + 1, end === -1 ? movetext.length : end).replace(/\s+/g, ' ').trim();
      if (text) tokens.push({ type: 'comment', text });
      i = end === -1 ? movetext.length : end + 1;
      continue;
    }
    if (c === ';') {
      while (i < movetext.length && movetext[i] !== '\n') i += 1;
      continue;
    }
    if (c === '(') { tokens.push({ type: 'open' }); i += 1; continue; }
    if (c === ')') { tokens.push({ type: 'close' }); i += 1; continue; }
    if (c === '$') {
      i += 1;
      let start = i;
      while (i < movetext.length && /\d/.test(movetext[i])) i += 1;
      const n = Number(movetext.slice(start, i));
      // A numeric NAG is the standards-compliant way a badge round-trips
      // through PGN — Lichess/chess.com write these, not just the glyph
      // suffix — so it has to attach to whatever move came before it, the
      // same as a {comment} does.
      if (Number.isFinite(n)) tokens.push({ type: 'nag', n });
      continue;
    }
    let j = i;
    while (j < movetext.length && !/[\s(){};]/.test(movetext[j])) j += 1;
    const word = movetext.slice(i, j);
    i = j;
    if (/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(word)) continue;
    // strip attached move numbers: "12.", "12...", "12.e4"
    const m = word.match(/^\d+\.{0,3}(.*)$/);
    let san = m ? m[1] : word;
    // …and a trailing annotation glyph ("Nf6??", "d4!") — chess.js accepts
    // and silently discards these itself, which is exactly how a badge used
    // to vanish on import. Longest match first, so "?!" reads as one glyph
    // rather than "?" with a stray "!" left dangling.
    let glyph = null;
    const gm = san.match(/(\?\?|!!|!\?|\?!|[!?])$/);
    if (gm) { glyph = gm[1]; san = san.slice(0, -glyph.length); }
    if (san) tokens.push({ type: 'san', san, glyph });
  }
  return tokens;
}

function parseSequence(tokens, pos) {
  const moves = [];
  while (pos < tokens.length) {
    const t = tokens[pos];
    if (t.type === 'close') { pos += 1; break; }
    if (t.type === 'open') {
      pos += 1;
      const sub = parseSequence(tokens, pos);
      pos = sub.pos;
      if (moves.length > 0) moves[moves.length - 1].variations.push(sub.moves);
      continue;
    }
    if (t.type === 'comment') {
      if (moves.length > 0) {
        const last = moves[moves.length - 1];
        last.comment = last.comment ? `${last.comment} ${t.text}` : t.text;
      }
      pos += 1;
      continue;
    }
    if (t.type === 'nag') {
      // A $N always refers to the move immediately before it; a glyph
      // attached straight to the SAN ("Nf6??") already set the badge when the
      // token was pushed below, so a redundant $4 alongside it — which real
      // PGN exports do write — isn't allowed to overwrite that with a
      // possibly-different reading of the same move.
      if (moves.length > 0 && !moves[moves.length - 1].badge) {
        moves[moves.length - 1].badge = badgeIdForNag(t.n);
      }
      pos += 1;
      continue;
    }
    moves.push({ san: t.san, comment: null, badge: badgeIdForGlyph(t.glyph), variations: [] });
    pos += 1;
  }
  return { moves, pos };
}

// Expand a parsed move tree into flat lines (main line first).
// A variation attached to move k is an alternative to move k, branching
// from the position before move k was played.
function expandTree(moves, prefix) {
  const sublines = [];
  const mainLine = [...prefix];
  for (const m of moves) {
    for (const v of m.variations) {
      sublines.push(...expandTree(v, [...mainLine]));
    }
    mainLine.push({ san: m.san, comment: m.comment, badge: m.badge });
  }
  return [mainLine, ...sublines];
}

// Parse a movetext string into one or more flat lines. Each line is
// { moves: [san], comments: { moveIndex: text }, badges: { moveIndex: id } }.
// Handles comments, NAGs, annotation glyphs, move numbers, results, and
// nested variations (each branch = its own line).
export function movetextToLines(movetext) {
  const tokens = tokenize(movetext);
  const { moves } = parseSequence(tokens, 0);
  return expandTree(moves, [])
    .filter((line) => line.length > 0)
    .map((line) => ({
      moves: line.map((x) => x.san),
      comments: Object.fromEntries(
        line.map((x, i) => [i, x.comment]).filter(([, c]) => c),
      ),
      badges: Object.fromEntries(
        line.map((x, i) => [i, x.badge]).filter(([, b]) => b),
      ),
    }));
}

// ---------- Validation ----------

// Try to apply a sequence of SAN tokens. Returns normalized SANs on success,
// or the index of the first token that isn't a legal move.
export function validateLine(sans) {
  const chess = new Chess();
  const moves = [];
  for (let i = 0; i < sans.length; i += 1) {
    let mv = null;
    try { mv = chess.move(sans[i]); } catch { mv = null; }
    if (!mv) {
      return { ok: false, moves, failedAt: i, failedToken: sans[i] };
    }
    moves.push(mv.san);
  }
  return { ok: true, moves };
}

// FEN after each move of a validated line (index 0 = start position).
export function lineFens(moves) {
  const chess = new Chess();
  const fens = [chess.fen()];
  for (const san of moves) {
    chess.move(san);
    fens.push(chess.fen());
  }
  return fens;
}

// ---------- Multi-game PGN splitting ----------

export function splitPgnGames(text) {
  const games = [];
  let current = { headers: {}, movetext: '' };
  let inMoves = false;
  for (const line of text.split(/\r?\n/)) {
    const hm = line.match(/^\[(\w+)\s+"(.*)"\]\s*$/);
    if (hm) {
      if (inMoves) {
        games.push(current);
        current = { headers: {}, movetext: '' };
        inMoves = false;
      }
      current.headers[hm[1]] = hm[2];
    } else if (line.trim()) {
      current.movetext += `${line}\n`;
      inMoves = true;
    }
  }
  if (current.movetext.trim()) games.push(current);
  return games;
}

// ---------- Generation ----------

export function movesToMovetext(moves, comments = {}, badges = {}) {
  const parts = [];
  let forceNumber = false;
  moves.forEach((san, i) => {
    // The glyph rides directly on the move ("Nf6??"), the way a human
    // annotates a game — the $N NAG comes right after, since that's the
    // unambiguous form other software (Lichess, ChessBase) actually reads.
    // Together they read naturally and survive either parser.
    const badge = BADGE_BY_ID[badges?.[i]];
    const suffix = badgeSuffix(badge);
    const sanOut = suffix ? `${san}${suffix}` : san;
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.${sanOut}`);
    else if (forceNumber) parts.push(`${(i - 1) / 2 + 1}...${sanOut}`);
    else parts.push(sanOut);
    forceNumber = false;
    if (suffix && badge.nag != null) parts.push(`$${badge.nag}`);
    const c = comments?.[i];
    if (c) {
      parts.push(`{${String(c).replace(/[{}]/g, '')}}`);
      forceNumber = true;
    }
  });
  return parts.join(' ');
}

function pgnDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

export function variationToPgn(variation, { event, white, black }) {
  const headers = [
    ['Event', event || 'Repertoire'],
    ['Site', 'Repertoire Lab'],
    ['Date', pgnDate()],
    ['Round', '-'],
    ['White', white || '?'],
    ['Black', black || '?'],
    ['Result', '*'],
  ];
  const headerText = headers.map(([k, v]) => `[${k} "${v.replace(/"/g, "'")}"]`).join('\n');
  return `${headerText}\n\n${movesToMovetext(variation.moves, variation.comments, variation.badges)} *\n`;
}

export function chapterToPgn(opening, chapter) {
  return chapter.variations
    .map((v) => variationToPgn(v, {
      event: `${opening.name}: ${chapter.name}`,
      white: opening.color === 'white' ? opening.name : v.name,
      black: opening.color === 'white' ? v.name : opening.name,
    }))
    .join('\n');
}

export function openingToPgn(opening) {
  return opening.chapters.map((ch) => chapterToPgn(opening, ch)).join('\n');
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/x-chess-pgn' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function safeFilename(name) {
  return name.replace(/[^\w\d-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
}
