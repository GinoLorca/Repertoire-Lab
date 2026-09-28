import { badgeIdForNag, badgeIdForGlyph, badgeSuffix, BADGE_BY_ID } from './badges';
import { withoutArrow } from './marks';
import {
  START_FEN, newGameAt, replay, isWhiteMove, moveNumberOf, canonicalStartFen,
} from './startPos';

// ---------- Tokenizing movetext ----------

// Words in movetext that aren't moves and carry nothing the app keeps:
// evaluation signs a book or course writes between moves ("±", "+=", "∞",
// "N" for a novelty …) and "e.p.". Read as moves they cut the line short.
// Not "Δ" ("with the idea") or "⌓" ("better is"): the move after those
// wasn't played, and skipping the sign would make it look as if it was — the
// line stops at them instead, where it shows.
const NOT_A_MOVE = new Set([
  '+=', '=+', '±', '∓', '+-', '-+', '+/-', '-/+', '+/=', '=/+', '+−', '−+', '=', '∞', '=/∞', '∞/=',
  '⩲', '⩱', 'N', 'TN', '□', '→', '↑', '⇆', '<=>', '○', '⨀', '⟳', '⊕', 'e.p.',
]);
// Castling written with zeros ("0-0", "0-0-0"), as many books and people do.
const castleZeros = (w) => w.replace(/^0-0(-0)?(?=$|[+#!?])/, (x) => x.replace(/0/g, 'O'));
const GLYPH_ONLY = /^(\?\?|!!|!\?|\?!|[!?])$/;

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
    // A stray "}" — a comment with braces nested inside it closes at the
    // first one — is skipped. Read as a word it was zero characters long, so
    // the reader never moved past it and the page froze.
    if (c === '}') { i += 1; continue; }
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
    // (A "$" ends a word too: "e4$1" is the move and its NAG.)
    while (j < movetext.length && !/[\s(){};$]/.test(movetext[j])) j += 1;
    const word = castleZeros(movetext.slice(i, j));
    i = j;
    if (/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(word)) continue;
    // A lone "N" is a novelty mark — unless a square follows: "N f3" is as
    // likely a knight move typed with a space, and dropping the "N" would
    // quietly turn Nf3 into f3. Left in, the line stops at it, visibly.
    if (word === 'N' && /^\s+[a-h]?[1-8]?x?[a-h][1-8]/.test(movetext.slice(i))) {
      tokens.push({ type: 'san', san: 'N', glyph: null });
      continue;
    }
    if (NOT_A_MOVE.has(word)) continue;
    // strip attached move numbers: "12.", "12...", "12.e4", and Black's
    // written with the one-character ellipsis: "12…", "12…Rxc6"
    const m = word.match(/^\d+(?:\.?…|\.{0,3})(.*)$/);
    // …and dots standing on their own ("12. ... Rxc6") or leading a move
    // with no number ("...Rxc6").
    let san = castleZeros((m ? m[1] : word).replace(/^[.…]+/, ''));
    // A glyph written apart from its move ("Nf6 ??") belongs to that move.
    if (GLYPH_ONLY.test(san)) { tokens.push({ type: 'glyph', glyph: san }); continue; }
    // …and a trailing annotation glyph ("Nf6??", "d4!", "Bxf7!+") — chess.js
    // accepts and silently discards these itself, which is exactly how a
    // badge used to vanish on import. Longest match first, so "?!" reads as
    // one glyph rather than "?" with a stray "!" left dangling.
    let glyph = null;
    const gm = san.match(/(\?\?|!!|!\?|\?!|[!?])([+#]?)$/);
    if (gm) { glyph = gm[1]; san = san.slice(0, -gm[0].length) + gm[2]; }
    if (san) tokens.push({ type: 'san', san, glyph });
  }
  return tokens;
}

// A comment before a sequence's first move (`lead`) is about the position it
// starts from — a course's introduction, or the arrows on the starting
// position ({[%cal Ge2e4]} 1.e4 …). It used to be dropped.
function parseSequence(tokens, pos) {
  const moves = [];
  let lead = null;
  while (pos < tokens.length) {
    const t = tokens[pos];
    if (t.type === 'close') { pos += 1; break; }
    if (t.type === 'open') {
      pos += 1;
      const sub = parseSequence(tokens, pos);
      pos = sub.pos;
      if (moves.length > 0) moves[moves.length - 1].variations.push({ moves: sub.moves, lead: sub.lead });
      continue;
    }
    if (t.type === 'comment') {
      if (moves.length > 0) {
        const last = moves[moves.length - 1];
        last.comment = last.comment ? `${last.comment} ${t.text}` : t.text;
      } else {
        lead = lead ? `${lead} ${t.text}` : t.text;
      }
      pos += 1;
      continue;
    }
    if (t.type === 'glyph') {
      if (moves.length > 0 && !moves[moves.length - 1].badge) {
        moves[moves.length - 1].badge = badgeIdForGlyph(t.glyph);
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
  return { moves, pos, lead };
}

const joined = (a, b) => (a ? `${a} ${b}` : b);

// Expand a parsed move tree into flat lines (main line first), each
// { items, lead } — `lead` the words on the line's starting position.
// A variation attached to move k is an alternative to move k, branching
// from the position before move k was played; its own leading comment is
// about that position, so it goes on the move before (or, at the very
// start, on the starting position).
function expandTree(moves, prefix, lead = null, prefixLead = null, startFen = START_FEN) {
  const sublines = [];
  const mainLine = [...prefix];
  let startLead = prefixLead;
  if (lead) {
    if (mainLine.length) {
      const last = mainLine[mainLine.length - 1];
      mainLine[mainLine.length - 1] = { ...last, comment: joined(last.comment, lead) };
    } else {
      startLead = joined(startLead, lead);
    }
  }
  for (const m of moves) {
    // A bracket with no moves in it — "(An alternative is …)" written as a
    // side line — would come out as a copy of the line cut off before this
    // move. Its words go on the position it's about, in this line.
    for (const v of m.variations) {
      if (v.moves.length || !v.lead) continue;
      if (mainLine.length) {
        const last = mainLine[mainLine.length - 1];
        mainLine[mainLine.length - 1] = { ...last, comment: joined(last.comment, v.lead) };
      } else {
        startLead = joined(startLead, v.lead);
      }
    }
    m.variations = m.variations.filter((v) => v.moves.length);
    if (m.variations.length) {
      // A side line takes the main line's moves up to here, comments and all
      // — but an arrow on the move before, pointing out the main line's reply
      // ("Nc6 defends", with b8→c6 drawn), would point the wrong way in a
      // line that answers differently. That one arrow stays behind.
      // (Only worked out when there's an arrow to check — replaying the moves
      // for every branch of a big course would be slow for nothing.)
      const inherited = mainLine.length ? mainLine[mainLine.length - 1].comment : startLead;
      const replaced = inherited?.includes('%cal') ? squaresOf(mainLine.map((x) => x.san), m.san, startFen) : null;
      let branchLine = mainLine;
      let branchLead = startLead;
      if (replaced) {
        if (mainLine.length) {
          const last = mainLine[mainLine.length - 1];
          const comment = last.comment && withoutArrow(last.comment, replaced.from, replaced.to);
          if (comment !== last.comment) branchLine = [...mainLine.slice(0, -1), { ...last, comment: comment || null }];
        } else if (startLead) {
          branchLead = withoutArrow(startLead, replaced.from, replaced.to) || null;
        }
      }
      for (const v of m.variations) {
        sublines.push(...expandTree(v.moves, [...branchLine], v.lead, branchLead, startFen));
      }
    }
    mainLine.push({ san: m.san, comment: m.comment, badge: m.badge });
  }
  return [{ items: mainLine, lead: startLead }, ...sublines];
}

// { from, to } of `san` played after `sans` (from `startFen`), or null if any
// of it is illegal.
function squaresOf(sans, san, startFen) {
  const { game, played } = replay(sans, startFen);
  if (played.length !== sans.length) return null;
  try {
    const mv = game.move(san);
    return mv ? { from: mv.from, to: mv.to } : null;
  } catch {
    return null;
  }
}

// Parse a movetext string into one or more flat lines. Each line is
// { moves: [san], comments: { moveIndex: text }, badges: { moveIndex: id } }.
// Handles comments, NAGs, annotation glyphs, move numbers, results, and
// nested variations (each branch = its own line).
// Comments keep their [%cal]/[%csl] arrow and square codes (lib/marks.js);
// the starting position's comment is keyed -1. `startFen`: a game set up from
// a position ([FEN …]) — its moves are read from there, whatever numbers the
// movetext gives them.
export function movetextToLines(movetext, { startFen = START_FEN } = {}) {
  const tokens = tokenize(movetext);
  const { moves, lead } = parseSequence(tokens, 0);
  return expandTree(moves, [], lead, null, startFen || START_FEN)
    .filter(({ items }) => items.length > 0)
    .map(({ items, lead: start }) => ({
      moves: items.map((x) => x.san),
      comments: Object.fromEntries([
        ...(start ? [[-1, start]] : []),
        ...items.map((x, i) => [i, x.comment]).filter(([, c]) => c),
      ]),
      badges: Object.fromEntries(
        items.map((x, i) => [i, x.badge]).filter(([, b]) => b),
      ),
    }));
}

// ---------- Validation ----------

// Try to apply a sequence of SAN tokens (from `startFen`, the normal start by
// default). Returns normalized SANs on success, or the index of the first
// token that isn't a legal move.
export function validateLine(sans, startFen = START_FEN) {
  const chess = newGameAt(startFen);
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

// FEN after each move of a line (index 0 = its start position), as far as its
// moves can be played — a move that can't stops it, rather than throwing
// while a board is being drawn.
export function lineFens(moves, startFen = START_FEN) {
  const chess = newGameAt(startFen);
  const fens = [chess.fen()];
  for (const san of moves) {
    let mv = null;
    try { mv = chess.move(san); } catch { mv = null; }
    if (!mv) break;
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
    // (Indented, or with a space before the "]", it's still a tag.)
    const hm = line.match(/^\s*\[(\w+)\s+"(.*)"\s*\]\s*$/);
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

// Numbered from where the line starts: a line set up with Black to move at
// move 12 reads "12...e4 13.Nd2 …".
export function movesToMovetext(moves, comments = {}, badges = {}, startFen = START_FEN) {
  const parts = [];
  let forceNumber = false;
  // The starting position's comment (and arrows) before the first move.
  const start = comments?.[-1];
  if (start) parts.push(`{${String(start).replace(/[{}]/g, '')}}`);
  moves.forEach((san, i) => {
    // The glyph rides directly on the move ("Nf6??"), the way a human
    // annotates a game — the $N NAG comes right after, since that's the
    // unambiguous form other software (Lichess, ChessBase) actually reads.
    // Together they read naturally and survive either parser.
    const badge = BADGE_BY_ID[badges?.[i]];
    const suffix = badgeSuffix(badge);
    const sanOut = suffix ? `${san}${suffix}` : san;
    const n = moveNumberOf(i, startFen);
    if (isWhiteMove(i, startFen)) parts.push(`${n}.${sanOut}`);
    else if (forceNumber || i === 0) parts.push(`${n}...${sanOut}`);
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
  // A line set up from a position says so, the way any PGN does.
  const startFen = canonicalStartFen(variation.startFen);
  if (startFen) headers.push(['SetUp', '1'], ['FEN', startFen]);
  const headerText = headers.map(([k, v]) => `[${k} "${v.replace(/"/g, "'")}"]`).join('\n');
  const movetext = movesToMovetext(variation.moves, variation.comments, variation.badges, startFen ?? START_FEN);
  return `${headerText}\n\n${movetext} *\n`;
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
