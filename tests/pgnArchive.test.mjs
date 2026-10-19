// PGN uploads — src/lib/pgnArchive.js: zips and plain files, read and indexed,
// one game opened, and games filed into a Games section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import {
  readPgnFiles, decodeText, indexGames, searchGames, openGame, gameRecord, sameName, sideIn, alreadyIn,
} from '../src/lib/pgnArchive.js';

const game = (tags, moves) => `${Object.entries(tags).map(([k, v]) => `[${k} "${v}"]`).join('\n')}\n\n${moves}\n\n`;
const R1 = game({
  Event: 'Spring Open', Site: 'Los Angeles', Date: '2026.04.12', Round: '3', White: 'Smith, Parker', Black: 'Lee, Jordan',
  Result: '1-0', WhiteElo: '1402', BlackElo: '1388', TimeControl: '40/90',
}, '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 1-0');
const R2 = game({
  Event: 'Spring Open', Date: '2026.04.12', Round: '4', White: 'Ng, Ava', Black: 'Smith, Parker', Result: '1/2-1/2',
}, '1. d4 d5 2. c4 e6 1/2-1/2');
const SETUP = game({ Event: 'Study', White: 'Endgame', Black: '?', FEN: '8/8/8/4k3/8/8/4P3/4K3 w - - 0 1', SetUp: '1' }, '1. Kd2 Kd5 *');
const VARIANT = game({ Event: 'Fun', White: 'A', Black: 'B', Variant: 'Chess960' }, '1. e4 *');

test('a plain .pgn: decoded, its byte-order mark dropped', () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...strToU8(R1)]);
  const out = readPgnFiles('round3.pgn', bytes);
  assert.equal(out.files.length, 1);
  assert.ok(out.files[0].text.startsWith('[Event'));
  assert.deepEqual(out.skipped, []);
});

test('text that isn’t UTF-8 is read as Windows-1252, the way ChessBase writes it', () => {
  assert.equal(decodeText(new Uint8Array([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72])), 'Müller');
  assert.equal(decodeText(strToU8('Dvořák')), 'Dvořák');
});

test('a .zip: every PGN in it, in order, and only those', () => {
  const zip = zipSync({
    'spring/round10.pgn': strToU8(R2),
    'spring/round2.pgn': strToU8(R1),
    'notes.TXT': strToU8('just a note'),
    'cover.jpg': new Uint8Array([1, 2, 3]),
    '__MACOSX/spring/._round2.pgn': new Uint8Array([0, 1]),
    '.DS_Store': new Uint8Array([0]),
    'empty/': new Uint8Array(0),
  });
  const out = readPgnFiles('spring.zip', zip);
  assert.deepEqual(out.files.map((f) => f.name), ['notes.TXT', 'round2.pgn', 'round10.pgn']);
  assert.deepEqual(out.skipped, ['cover.jpg']);
  assert.equal(out.truncated, false);
  const games = indexGames(out.files);
  assert.deepEqual(games.map((g) => g.round), ['3', '4']); // the note has no moves in it
});

test('a damaged zip, or a .zip that isn’t one, says so', () => {
  const zip = zipSync({ 'a.pgn': strToU8(R1) });
  const broken = zip.slice(0, zip.length - 30);
  assert.match(readPgnFiles('a.zip', broken).error, /couldn’t be opened/);
  assert.match(readPgnFiles('notreally.zip', strToU8('hello')).error, /couldn’t be opened/);
});

test('the index: tags read, moves left as text until a game is opened', () => {
  const [g1, g2, g3, g4] = indexGames([{ name: 'all.pgn', text: R1 + R2 + SETUP + VARIANT }]);
  assert.equal(g1.name, 'Smith, Parker – Lee, Jordan');
  assert.deepEqual([g1.whiteElo, g1.blackElo, g1.result, g1.event, g1.round, g1.date], ['1402', '1388', '1-0', 'Spring Open', '3', '2026-04-12']);
  assert.equal(g2.result, '½-½');
  assert.equal(g2.whiteElo, '');
  assert.ok(g1.movetext.includes('Nf3#'));
  assert.equal(g1.file, 'all.pgn');
  // Searching: every word, anywhere in the players, event, round, date…
  const all = [g1, g2, g3, g4];
  assert.deepEqual(searchGames(all, 'parker').map((g) => g.id), [g1.id, g2.id]);
  assert.deepEqual(searchGames(all, 'smith  lee').map((g) => g.id), [g1.id]);
  assert.deepEqual(searchGames(all, 'spring 2026-04-12').length, 2);
  assert.equal(searchGames(all, '').length, 4);
  assert.equal(searchGames(all, 'nobody').length, 0);
});

test('a file of bare moves, no tags: each "1." a game, as when pasted', () => {
  const games = indexGames([{ name: 'lines.txt', text: '1. e4 e5 2. Nf3\n1. d4 d5' }]);
  assert.equal(games.length, 2);
  assert.deepEqual(openGame(games[1]).moves, ['d4', 'd5']);
});

test('opening one: played through, or why it can’t be', () => {
  const [g1, , g3, g4] = indexGames([{ name: 'all.pgn', text: R1 + R2 + SETUP + VARIANT }]);
  const e1 = openGame(g1);
  assert.equal(e1.moves.length, 14);
  assert.equal(e1.moves.at(-1), 'Nf3#');
  const e3 = openGame(g3);
  assert.equal(e3.startFen.split(' ')[0], '8/8/8/4k3/8/8/4P3/4K3');
  assert.deepEqual(e3.moves, ['Kd2', 'Kd5']);
  assert.match(openGame(g4).unusable, /Chess960/);
});

test('names: "Smith, Parker" is Parker Smith; a bare initial isn’t anyone', () => {
  assert.ok(sameName('Parker Smith', 'Smith, Parker'));
  assert.ok(sameName('parker smith', 'SMITH,PARKER'));
  assert.ok(sameName('Parker Smith', 'Smith, Parker J'));
  assert.ok(!sameName('Parker Smith', 'Smith, Jordan'));
  assert.ok(!sameName('Carlsen', 'Carlsen, M'));
  assert.ok(sameName('Hikaru', 'hikaru'));
  assert.ok(!sameName('', 'Smith'));
  const parker = { name: 'Parker Smith', profile: { lichess: 'parker_s' } };
  assert.equal(sideIn(parker, 'Smith, Parker', 'Lee, Jordan'), 'white');
  assert.equal(sideIn(parker, 'Ng, Ava', 'Smith, Parker'), 'black');
  assert.equal(sideIn(parker, 'parker_s', 'someone'), 'white');
  assert.equal(sideIn(parker, 'Ng, Ava', 'Lee, Jordan'), '');
});

test('a game for a Games section: its details from the tags, and which side was theirs', () => {
  const [g1, g2, g3] = indexGames([{ name: 'all.pgn', text: R1 + R2 + SETUP }]);
  const parker = { id: 'p', name: 'Parker Smith', profile: {}, games: [] };
  const rec = gameRecord(g1, openGame(g1), parker, 5);
  assert.equal(rec.name, 'Smith, Parker vs Lee, Jordan');
  assert.equal(rec.moves.length, 14);
  assert.equal(rec.date, new Date('2026-04-12').getTime());
  assert.deepEqual(rec.meta, {
    white: 'Smith, Parker', whiteElo: '1402', black: 'Lee, Jordan', blackElo: '1388', event: 'Spring Open',
    eventType: 'otb', round: '3', result: '1-0', color: 'white', date: '2026-04-12', timeControl: '40/90',
  });
  assert.equal(gameRecord(g2, openGame(g2), parker).meta.color, 'black');
  assert.equal(gameRecord(g2, openGame(g2), parker).meta.result, '½-½');
  // A set-up position isn't a game record; nor is a game with no moves.
  assert.equal(gameRecord(g3, openGame(g3), parker), null);
  assert.equal(gameRecord(g1, { moves: [] }, parker), null);
  // Already there: the same moves between the same players.
  const there = { ...parker, games: [{ ...rec }] };
  assert.ok(alreadyIn(there, gameRecord(g1, openGame(g1), parker)));
  assert.ok(!alreadyIn(there, gameRecord(g2, openGame(g2), parker)));
  // Online games say where they were played.
  const online = indexGames([{ name: 'x.pgn', text: game({ Event: 'Live Chess', Site: 'Chess.com', White: 'a1', Black: 'b2', Result: '0-1' }, '1. e4 e5 0-1') }])[0];
  const r = gameRecord(online, openGame(online), parker);
  assert.deepEqual([r.meta.eventType, r.meta.event, r.meta.result], ['chess.com', 'Online Chess', '0-1']);
});
