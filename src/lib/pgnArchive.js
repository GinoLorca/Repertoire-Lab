// PGN files uploaded onto the analysis board: a .pgn (or .txt) as it is, or a
// .zip of them — a tournament's games, a week of TWIC, a ChessBase export.
//
//   readPgnFiles   the PGN text in an upload, unzipped and decoded
//   indexGames     every game in it, its tags read but its moves left as text
//                  until it's opened — a zip of thousands of games lists at
//                  once, and only the one you open is played through
//   openGame       one of them, as a line the board can load
//   gameRecord     one of them, as a game for a Games section
//
// Pure (no DOM, no store), so tests/pgnArchive.test.mjs covers it.
import { unzipSync } from 'fflate';
import { splitPgnGames } from './pgn';
import { gameEntries, pgnTextToEntries, setUpOf } from './pgnImport';
import { RESULTS, tidyEvent } from './games';

// More PGN than this in one upload is more than a board needs (a year of
// TWIC is about 150 MB): what's past it is left out, and said so.
export const MAX_TEXT = 60 * 1024 * 1024;
export const MAX_GAMES = 20000;

const isZip = (b) => b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);
const PGN_NAME = /\.(pgn|txt)$/i;
// What else a zip made on a Mac or by ChessBase carries alongside the games.
const JUNK = /(^|\/)(__MACOSX\/|\._|\.DS_Store$)/;

// Text from bytes: UTF-8 when it is, else Windows-1252 — what a lot of PGN
// is written in (ChessBase, TWIC), where "Ä" and "ő" in player names would
// otherwise come out as boxes.
export function decodeText(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// { files: [{ name, text }], skipped: [name], truncated, error? } — `skipped`
// the files in a zip that aren't PGN, `truncated` when there was more than
// MAX_TEXT of it.
export function readPgnFiles(name, bytes) {
  if (!isZip(bytes)) {
    if (!PGN_NAME.test(name) && /\.zip$/i.test(name)) return { files: [], skipped: [], truncated: false, error: 'That .zip file couldn’t be opened.' };
    const truncated = bytes.length > MAX_TEXT;
    return { files: [{ name, text: decodeText(truncated ? bytes.subarray(0, MAX_TEXT) : bytes) }], skipped: [], truncated };
  }
  const skipped = [];
  let total = 0;
  let truncated = false;
  let found;
  try {
    found = unzipSync(bytes, {
      filter: (f) => {
        if (f.name.endsWith('/') || JUNK.test(f.name)) return false;
        if (!PGN_NAME.test(f.name)) { skipped.push(f.name); return false; }
        if (total + f.originalSize > MAX_TEXT) { truncated = true; return false; }
        total += f.originalSize;
        return true;
      },
    });
  } catch {
    return { files: [], skipped: [], truncated: false, error: 'That .zip file couldn’t be opened — it may be damaged, or password-protected.' };
  }
  const files = Object.keys(found)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((n) => ({ name: n.split('/').pop(), text: decodeText(found[n]) }));
  return { files, skipped, truncated };
}

const real = (v) => (typeof v === 'string' && v.trim() && v.trim() !== '?' ? v.trim() : '');
const elo = (v) => (/^\d{3,4}$/.test(String(v ?? '').trim()) ? String(v).trim() : '');
const RESULT = { '1-0': '1-0', '0-1': '0-1', '1/2-1/2': '½-½', '½-½': '½-½', '*': '*' };

// Every game in the files, in order: { id, file, headers, movetext, white,
// black, whiteElo, blackElo, result, event, round, date, search }. A file of
// bare moves with no tags at all is read as it's always been read when
// pasted (each "1." a new game), and those come with their `entry` already.
export function indexGames(files) {
  const out = [];
  for (const f of files) {
    if (out.length >= MAX_GAMES) break;
    if (!/\[\w+\s+"/.test(f.text)) {
      for (const entry of pgnTextToEntries(f.text, { mainLineOnly: true })) {
        if (out.length >= MAX_GAMES) break;
        out.push(summary({ id: `g${out.length}`, file: f.name, headers: {}, movetext: '', entry }));
      }
      continue;
    }
    for (const g of splitPgnGames(f.text)) {
      if (out.length >= MAX_GAMES) break;
      if (!g.movetext.trim() && !Object.keys(g.headers).length) continue;
      out.push(summary({ id: `g${out.length}`, file: f.name, headers: g.headers, movetext: g.movetext }));
    }
  }
  return out;
}

function summary(item) {
  const h = item.headers;
  const white = real(h.White) || (item.entry?.players?.white ?? '');
  const black = real(h.Black) || (item.entry?.players?.black ?? '');
  const event = real(h.Event);
  const round = real(h.Round);
  const date = /^\d{4}\.\d{2}\.\d{2}$/.test(h.Date ?? '') ? h.Date.replace(/\./g, '-') : '';
  return {
    ...item,
    white,
    black,
    whiteElo: elo(h.WhiteElo),
    blackElo: elo(h.BlackElo),
    result: RESULT[String(h.Result ?? '').trim()] ?? '',
    event,
    round,
    date,
    name: white || black ? `${white || '?'} – ${black || '?'}` : (item.entry?.name ?? event ?? 'Game'),
    search: [white, black, event, round, date, h.Site, h.ECO, h.Opening].filter(Boolean).join(' ').toLowerCase(),
  };
}

// Games whose players, event, round, date, site or opening have every word
// of `query` in them.
export function searchGames(games, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return games;
  return games.filter((g) => words.every((w) => g.search.includes(w)));
}

// One game, played through, as the board loads a pasted one: { name, moves,
// comments, badges, startFen?, players?, ok, unusable? } — `unusable` saying
// why when it can't be played (a variant, an unreadable first move).
export function openGame(item) {
  if (item.entry) return item.entry;
  const [entry] = gameEntries([{ headers: item.headers, movetext: item.movetext }], { mainLineOnly: true });
  return entry ?? { name: item.name, moves: [], comments: {}, badges: {}, ok: false, unusable: 'has no moves' };
}

// ---------- Into a Games section ----------

const tokens = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
// "Smith, Parker" is Parker Smith (a middle initial or not); a one-word name
// — a handle, "Carlsen" — only matches exactly, so "Carlsen, M" isn't it.
export function sameName(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length || !y.length) return false;
  if (x.length === 1 || y.length === 1) return x.join(' ') === y.join(' ');
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.filter((w) => w.length > 1).every((w) => long.includes(w))
    && short.some((w) => w.length > 1);
}

// Which side a section's player had: their name, or a handle they play under.
export function sideIn(section, white, black) {
  const names = [section?.name, section?.profile?.chesscom, section?.profile?.lichess].filter(Boolean);
  const isW = names.some((n) => sameName(n, white));
  const isB = names.some((n) => sameName(n, black));
  if (isW && !isB) return 'white';
  if (isB && !isW) return 'black';
  return '';
}

const guessEventType = (h) => {
  const site = `${h.Site ?? ''} ${h.Event ?? ''}`.toLowerCase();
  if (site.includes('chess.com')) return 'chess.com';
  if (site.includes('lichess')) return 'lichess';
  return 'otb';
};

// A game for a Games section, with what its tags say — the same fields the
// game editor fills from a pasted PGN. Null for one that can't be a game
// record: no moves, or set up from a position (that belongs in a chapter).
export function gameRecord(item, entry, section, now = Date.now()) {
  if (!entry || !entry.moves?.length || entry.startFen || setUpOf(item.headers).startFen) return null;
  const h = item.headers;
  const eventType = guessEventType(h);
  const result = RESULTS.includes(item.result) ? item.result : '';
  return {
    name: `${item.white || 'White'} vs ${item.black || 'Black'}`,
    moves: entry.moves,
    comments: entry.comments ?? {},
    badges: entry.badges ?? {},
    date: item.date ? new Date(item.date).getTime() : now,
    meta: {
      white: item.white,
      whiteElo: item.whiteElo,
      black: item.black,
      blackElo: item.blackElo,
      event: tidyEvent(item.event, eventType),
      eventType,
      round: item.round,
      result,
      color: sideIn(section, item.white, item.black),
      date: item.date,
      timeControl: real(h.TimeControl),
    },
  };
}

// Already in the section: the same moves between the same two players.
export function alreadyIn(section, record) {
  const key = (g) => `${(g.moves ?? []).join(' ')}|${String(g.meta?.white ?? '').toLowerCase()}|${String(g.meta?.black ?? '').toLowerCase()}`;
  const k = key(record);
  return (section?.games ?? []).some((g) => key(g) === k);
}
