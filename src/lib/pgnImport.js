import { splitPgnGames, movetextToLines, validateLine } from './pgn';

// Turn pasted text or the contents of a .pgn file into variations ready to be
// added to a chapter. Handles a full PGN with headers, several games in one
// file, and bare movetext — nested variations become their own lines.
//
// Each entry is { id, name, moves, comments, badges, ok, failedToken, event }.
let seq = 0;
const nextId = () => `imp${(seq += 1)}-${Date.now().toString(36)}`;

// Course PGNs name their lines in different places: two real players, a single
// White tag holding the line's name, or only the Event.
function nameFor(h, gi) {
  const real = (v) => v && v !== '?' && v.trim();
  if (real(h.White) && real(h.Black)) return `${h.White} – ${h.Black}`;
  return real(h.White) || real(h.Black) || real(h.Event) || `Game ${gi + 1}`;
}

function gameEntries(games, { mainLineOnly = false } = {}) {
  const entries = [];
  games.forEach((game, gi) => {
    const h = game.headers;
    const baseName = nameFor(h, gi);
    const lines = movetextToLines(game.movetext);
    (mainLineOnly ? lines.slice(0, 1) : lines).forEach((line, li) => {
      const result = validateLine(line.moves);
      if (result.moves.length === 0) return;
      entries.push({
        id: nextId(),
        name: li > 0 ? `${baseName} (alt ${li})` : baseName,
        event: h.Event || null,
        comments: line.comments,
        badges: line.badges,
        ...result,
      });
    });
  });
  return entries;
}

// Without headers, a fresh "1." at the start of a line begins a new variation,
// so several lines can be pasted in one go.
function looseEntries(text, { mainLineOnly = false } = {}) {
  const blocks = [];
  let current = [];
  for (const ln of text.split(/\r?\n/)) {
    if (/^\s*1\s*\./.test(ln) && current.some((l) => l.trim())) {
      blocks.push(current.join('\n'));
      current = [ln];
    } else {
      current.push(ln);
    }
  }
  if (current.some((l) => l.trim())) blocks.push(current.join('\n'));

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
    };
  }).filter((e) => e.moves.length > 0);
}

// Two games with the same tags would otherwise arrive as two identically named
// variations, which is no help in a list.
function deduplicate(entries) {
  const seen = new Map();
  return entries.map((e) => {
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
export function pgnTextToEntries(text, { mainLineOnly = false } = {}) {
  if (!text?.trim()) return [];
  const entries = /\[\w+\s+"/.test(text)
    ? gameEntries(splitPgnGames(text), { mainLineOnly })
    : looseEntries(text, { mainLineOnly });
  return deduplicate(entries);
}
