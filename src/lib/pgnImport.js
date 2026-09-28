import { splitPgnGames, movetextToLines, validateLine } from './pgn';
import { normalizeFen, canonicalStartFen } from './startPos';

// Turn pasted text or the contents of a .pgn file into variations ready to be
// added to a chapter. Handles a full PGN with headers, several games in one
// file, and bare movetext — nested variations become their own lines.
//
// Each entry is { id, name, moves, comments, badges, ok, failedToken, event },
// plus `startFen` for a line set up from a position.
let seq = 0;
const nextId = () => `imp${(seq += 1)}-${Date.now().toString(36)}`;

// Course PGNs name their lines in different places: two real players, a single
// White tag holding the line's name, or only the Event.
const real = (v) => (v && v.trim() !== '?' ? v.trim() : '');

// The chapter a game's lines go to in a course import: its Event, as written
// but without stray spaces — "?" (PGN's "unknown") counts as none.
export const eventOf = (h) => real(h.Event) || null;

// Where a game starts. { startFen } for one set up from a position ([FEN …]),
// {} for the normal start (including a [FEN] of the normal start), or
// { error } when it can't be used: a FEN that isn't a legal position, or a
// chess variant this app doesn't play (Chess960, Crazyhouse …).
export function setUpOf(h) {
  const variant = String(h.Variant ?? '').trim().toLowerCase();
  if (variant && variant !== 'standard' && variant !== 'from position') {
    return { error: `is a ${String(h.Variant).trim()} game` };
  }
  if (!h.FEN?.trim()) return {};
  if (!normalizeFen(h.FEN)) return { error: 'its set-up position (FEN) can’t be read' };
  const startFen = canonicalStartFen(h.FEN);
  return startFen ? { startFen } : {};
}

export function nameFor(h, gi) {
  if (real(h.White) && real(h.Black)) return `${h.White} – ${h.Black}`;
  return real(h.White) || real(h.Black) || real(h.Event) || `Game ${gi + 1}`;
}

// One line typed or pasted somewhere a single line is wanted (Compare,
// Search): its first line, read from its set-up position if it has one.
// { startFen, line, parsed } or { error }.
export function parsePastedLine(text) {
  const game = /\[\w+\s+"/.test(text) ? splitPgnGames(text)[0] : null;
  const setUp = game ? setUpOf(game.headers) : {};
  if (setUp.error) return { error: `That game ${setUp.error}.` };
  const { startFen } = setUp;
  const lines = movetextToLines(game ? game.movetext : text, { startFen });
  if (!lines.length) return { error: 'No moves found in that text.' };
  return { startFen, line: lines[0], parsed: validateLine(lines[0].moves, startFen) };
}

export function gameEntries(games, { mainLineOnly = false } = {}) {
  const entries = [];
  games.forEach((game, gi) => {
    const h = game.headers;
    const baseName = nameFor(h, gi);
    // Listed, not added, with the reason — rather than left out without a
    // word, or played from the wrong position into a line that looks fine.
    const setUp = setUpOf(h);
    if (setUp.error) {
      entries.push({
        id: nextId(), name: baseName, event: eventOf(h), comments: {}, badges: {},
        ok: false, moves: [], failedToken: null, unusable: setUp.error,
      });
      return;
    }
    // Every line of a set-up game — its side lines too — starts there.
    const { startFen } = setUp;
    const lines = movetextToLines(game.movetext, { startFen });
    // Nothing to play — a position with only a note, say — is listed too.
    if (!lines.length) {
      entries.push({
        id: nextId(), name: baseName, event: eventOf(h), comments: {}, badges: {},
        ok: false, moves: [], failedToken: null,
        unusable: startFen ? 'a set-up position with no moves' : 'has no moves',
      });
      return;
    }
    (mainLineOnly ? lines.slice(0, 1) : lines).forEach((line, li) => {
      const result = validateLine(line.moves, startFen);
      entries.push({
        id: nextId(),
        name: li > 0 ? `${baseName} (alt ${li})` : baseName,
        event: eventOf(h),
        comments: line.comments,
        badges: line.badges,
        ...(startFen ? { startFen } : {}),
        // Who played it, when the tags say — so a game sent to the analysis
        // board can open from your side (lib/pov.js).
        ...(real(h.White) || real(h.Black) ? { players: { white: real(h.White) || null, black: real(h.Black) || null } } : {}),
        ...result,
        ...(result.moves.length === 0 ? { unusable: `can’t read its first move, “${result.failedToken}”` } : {}),
      });
    });
  });
  return entries;
}

// Without headers, a fresh "1." at the start of a line begins a new variation,
// so several lines can be pasted in one go. So does a line's opening comment
// in front of its "1." ("{The Panov [%cal Gc2c4]} 1.e4 c6 …") — and a comment
// on a line of its own just above a "1." goes with the line it introduces,
// not on the end of the one before.
const LINE_START = /^\s*(?:\{[^}]*\}\s*)*1\s*\./;
const COMMENT_ONLY = /^\s*\{[^}]*\}\s*$/;
export function splitLooseBlocks(text) {
  const blocks = [];
  let current = [];
  for (const ln of text.split(/\r?\n/)) {
    if (LINE_START.test(ln)) {
      const carry = [];
      while (current.length && (COMMENT_ONLY.test(current[current.length - 1]) || !current[current.length - 1].trim())) {
        carry.unshift(current.pop());
      }
      if (current.some((l) => l.trim())) {
        blocks.push(current.join('\n'));
        current = [];
      }
      current.push(...carry, ln);
    } else {
      current.push(ln);
    }
  }
  if (current.some((l) => l.trim())) blocks.push(current.join('\n'));
  return blocks;
}

function looseEntries(text, { mainLineOnly = false } = {}) {
  const blocks = splitLooseBlocks(text);

  const lines = blocks.flatMap((block) => {
    const blockLines = movetextToLines(block);
    return mainLineOnly ? blockLines.slice(0, 1) : blockLines;
  });
  return lines.map((line, i) => {
    const result = validateLine(line.moves);
    return {
      id: nextId(),
      name: lines.length > 1 ? `Line ${i + 1}` : 'Pasted line',
      event: null,
      comments: line.comments,
      badges: line.badges,
      ...result,
      ...(result.moves.length === 0 && line.moves.length ? { unusable: `can’t read its first move, “${result.failedToken}”` } : {}),
    };
  }).filter((e) => e.moves.length > 0 || e.unusable);
}

// Two games with the same tags would otherwise arrive as two identically named
// variations, which is no help in a list.
function deduplicate(entries) {
  const seen = new Map();
  return entries.map((e) => {
    // A row that can't be added keeps its own name and takes none from a
    // line that can.
    if (e.moves.length === 0) return e;
    const n = (seen.get(e.name) ?? 0) + 1;
    seen.set(e.name, n);
    return n === 1 ? e : { ...e, name: `${e.name} (${n})` };
  });
}

// mainLineOnly: skip a game's own parenthetical side-variations instead of
// offering each one as if it were a whole separate game to pick from. A
// course PGN's variations really are alternate lines worth choosing between
// (the default, used for study/course import) — but a game someone just
// played and pasted in isn't a set of games, whatever engine-analysis
// branches its export happens to carry alongside the moves actually played.
//
// includeUnusable: also list games that can't become a line (no moves, or set
// up from a position), each with `unusable` saying why — the Add PGN list
// shows them so nothing a file held goes missing without a word.
export function pgnTextToEntries(text, { mainLineOnly = false, includeUnusable = false } = {}) {
  if (!text?.trim()) return [];
  const entries = /\[\w+\s+"/.test(text)
    ? gameEntries(splitPgnGames(text), { mainLineOnly })
    : looseEntries(text, { mainLineOnly });
  return deduplicate(includeUnusable ? entries : entries.filter((e) => e.moves.length > 0));
}
