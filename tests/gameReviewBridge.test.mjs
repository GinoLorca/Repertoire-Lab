// Game Review — src/lib/gameReviewBridge.js: a game as Chess Arcade's review
// opens it, the id it goes by there, and what's kept on the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arcadeId, tempArcadeId, isArcadeId, arcadeGame, cleanRecords, sameRecords, hasGameReview, fromArchive, MAX_TEXT,
  recordsFor, writesReviewLayer, withGameReview,
} from '../src/lib/gameReviewBridge.js';
import { parseDoc, serializeDoc, docFromGame, docIsEmpty } from '../src/lib/analysisDoc.js';
import {
  buildPatch, parsePatch, sharedCopy, needsSend, mergeLinkedGames, hashesOf,
} from '../src/lib/cloud/gameLink.js';

// Chess Arcade's own checks on an id (hvAnnId, gnIdOk) and on a Lichess one (Share).
const ARCADE_OK = /^(?:\w{8}|cc-d?\d{1,15})$/;
const LICHESS = /^[A-Za-z0-9]{8}$/;

test('a saved game always gets the same id, one Chess Arcade takes and never reads as a Lichess game', () => {
  const a = arcadeId('k3j2h1g0abc');
  assert.equal(a, arcadeId('k3j2h1g0abc'));
  assert.notEqual(a, arcadeId('k3j2h1g0abd'));
  for (const id of [a, arcadeId(''), arcadeId('x'.repeat(40)), tempArcadeId(), tempArcadeId(() => 0.999999)]) {
    assert.match(id, ARCADE_OK, id);
    assert.doesNotMatch(id, LICHESS, id);
    assert.ok(isArcadeId(id), id);
  }
  assert.equal(tempArcadeId(() => 0), 't_000000');
  assert.ok(!isArcadeId('abcdefgh'));
});

test('a game: SAN in one string, the players and their ratings, who won, and whose game it is', () => {
  const g = arcadeGame({
    name: 'Riley vs Parker',
    moves: ['e4', 'c6', 'Nc3', 'd5', ' '],
    date: Date.UTC(2026, 9, 12),
    meta: { white: 'Riley', whiteElo: '1210', black: 'Parker Downing', blackElo: '?', result: '0-1', color: 'black' },
  }, 'r_abc123');
  assert.equal(g.id, 'r_abc123');
  assert.equal(g.moves, 'e4 c6 Nc3 d5');
  assert.deepEqual(g.players.white, { user: { name: 'Riley', id: 'riley' }, rating: 1210 });
  assert.deepEqual(g.players.black, { user: { name: 'Parker Downing', id: 'parker-downing' } });
  assert.equal(g.winner, 'black');
  assert.equal(g.status, undefined);
  assert.equal(g._me, 'black');
  assert.equal(g.variant, 'standard');
  assert.equal(g.createdAt, Date.UTC(2026, 9, 12));
});

test('results: a draw has no winner, an unknown one shows as *, and the side can be given', () => {
  assert.equal(arcadeGame({ moves: ['d4'], meta: { result: '½-½' } }, 'r_000001').winner, undefined);
  assert.equal(arcadeGame({ moves: ['d4'], meta: { result: '1/2-1/2' } }, 'r_000001').status, undefined);
  assert.equal(arcadeGame({ moves: ['d4'], meta: { result: '1-0' } }, 'r_000001').winner, 'white');
  assert.equal(arcadeGame({ moves: ['d4'], meta: {} }, 'r_000001').status, 'started');
  const g = arcadeGame({ moves: ['d4'] }, 'r_000001', { side: 'white' });
  assert.equal(g._me, 'white');
  assert.equal(g.players.white.user.name, 'White');
  assert.equal(arcadeGame({ moves: ['d4'], meta: { color: 'none' } }, 'r_000001')._me, undefined);
  assert.equal(arcadeGame({ moves: ['d4'], meta: { date: '2026.10.12' } }, 'r_000001').createdAt, Date.parse('2026-10-12'));
});

test('a game from a set-up position starts there', () => {
  const fen = '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1';
  const g = arcadeGame({ moves: ['Rd1+'], startFen: fen }, 't_000002');
  assert.equal(g.variant, 'fromPosition');
  assert.equal(g.initialFen, fen);
  const s = arcadeGame({ moves: ['e4'], startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' }, 't_000002');
  assert.equal(s.variant, 'standard');
  assert.equal(s.initialFen, undefined);
});

test('what a game keeps: both texts, or nothing', () => {
  assert.equal(cleanRecords(null), null);
  assert.equal(cleanRecords({ note: ' ', an: '' }), null);
  assert.deepEqual(cleanRecords({ note: 'Good game', an: 7 }), { note: 'Good game', an: '' });
  const an = JSON.stringify({ v: 1, l: [], c: [[3, 'why?']], m: [], k: [[4, 'C']] });
  assert.deepEqual(cleanRecords({ an }), { note: '', an });
  assert.equal(cleanRecords({ note: 'x'.repeat(MAX_TEXT + 5) }).note.length, MAX_TEXT);
  assert.ok(sameRecords({ note: 'a', an: '' }, { note: 'a' }));
  assert.ok(sameRecords(null, {}));
  assert.ok(!sameRecords({ note: 'a' }, { note: 'b' }));
  assert.ok(hasGameReview({ gameReview: { note: 'n', an: '' } }));
  assert.ok(!hasGameReview({}));
});

test('a pasted or uploaded game, in a game’s shape', () => {
  const g = fromArchive(
    { name: 'Riley – Parker', white: 'Riley', black: 'Parker', whiteElo: '1200', blackElo: '', result: '0-1', date: '2026-10-12', event: 'Club', round: '3' },
    { name: 'x', moves: ['e4', 'c6'] },
  );
  assert.equal(g.name, 'Riley – Parker');
  assert.deepEqual(g.moves, ['e4', 'c6']);
  assert.equal(g.meta.result, '0-1');
  assert.equal(arcadeGame(g, 't_000003').players.white.rating, 1200);
  const bare = fromArchive({}, { name: 'Pasted', moves: ['d4'], players: { white: 'A', black: null } });
  assert.equal(bare.name, 'Pasted');
  assert.equal(bare.meta.white, 'A');
});

// ---------- whose copy, and how it travels ----------

const MOVES = ['e4', 'c6', 'Nc3', 'd5'];
const AN = JSON.stringify({ v: 1, l: [], c: [[2, 'The Caro']], m: [], k: [[2, 'C']] });

test('a review document carries a Game Review, and only when there is one', () => {
  const plain = docFromGame({ moves: MOVES });
  assert.ok(docIsEmpty(plain));
  assert.equal(serializeDoc(parseDoc(serializeDoc(plain))), serializeDoc(plain), 'unchanged without one');
  const body = withGameReview(null, { moves: MOVES }, { note: 'Nice game', an: AN, at: 5 });
  const doc = parseDoc(body);
  assert.deepEqual(doc.gameReview, { note: 'Nice game', an: AN, at: 5 });
  assert.ok(!docIsEmpty(doc));
  assert.deepEqual(doc.moves, MOVES);
  // Taken out again, the document is as it was.
  assert.equal(withGameReview(body, { moves: MOVES }, null), serializeDoc(plain));
  // A review written in Studio around it stays.
  const studio = serializeDoc({ ...plain, tree: { ...plain.tree, note: 'Summary' } });
  const both = parseDoc(withGameReview(studio, { moves: MOVES }, { note: 'n' }));
  assert.equal(both.tree.note, 'Summary');
  assert.equal(both.gameReview.note, 'n');
  // Junk from another account is cut down to what's allowed.
  const junk = parseDoc(JSON.stringify({ ...plain, gameReview: { note: 3, an: 'x'.repeat(MAX_TEXT + 9), at: 'soon', evil: 1 } }));
  assert.deepEqual(junk.gameReview, { note: '', an: 'x'.repeat(MAX_TEXT) });
});

test('whose copy opens: the one written last, from wherever it is', () => {
  const own = { player: { kind: 'self' }, game: { moves: MOVES, gameReview: { note: 'mine', an: '', at: 10 } } };
  assert.equal(recordsFor(own.game, own.player).note, 'mine');
  assert.ok(!writesReviewLayer(own.game, own.player));

  // The coach, on a student's own game: their review layer, or the student's
  // copy when it's newer.
  const coachBody = withGameReview(null, { moves: MOVES }, { note: 'coach', an: AN, at: 20 });
  const studentOwn = { kind: 'student' };
  const theirs = { moves: MOVES, link: { origin: 'student' }, gameReview: { note: 'student', an: '', at: 15 }, review: { body: coachBody } };
  assert.ok(writesReviewLayer(theirs, studentOwn));
  assert.equal(recordsFor(theirs, studentOwn).note, 'coach');
  assert.equal(recordsFor({ ...theirs, gameReview: { note: 'student', an: '', at: 25 } }, studentOwn).note, 'student');
  // A game the coach typed in is the one shared copy.
  const typed = { ...theirs, link: { origin: 'coach' } };
  assert.ok(!writesReviewLayer(typed, studentOwn));
  assert.equal(recordsFor(typed, studentOwn).note, 'student');

  // The student: a coach's review of their game, unless it's been taken away.
  const mine = { moves: MOVES, gameReview: { note: 'student', an: '', at: 15 }, reviews: { c1: { body: coachBody } } };
  assert.equal(recordsFor(mine, { kind: 'self' }).note, 'coach');
  assert.equal(recordsFor({ ...mine, reviews: { c1: { body: coachBody, removed: true } } }, { kind: 'self' }).note, 'student');
  assert.equal(recordsFor({ moves: MOVES }, { kind: 'self' }), null);
});

test('a game the coach typed in: its Game Review goes to the student field by field', () => {
  const coachGame = {
    id: 'g1abcdef', name: 'Riley vs Parker', moves: MOVES, meta: {}, comments: {}, badges: {},
    gameReview: { note: 'Look at move 2', an: AN, at: 30 },
    link: { uid: 'stu', base: {}, seen: true, sent: null },
  };
  const { patch, pending } = buildPatch(coachGame);
  assert.ok(pending.includes('gameReview:note') && pending.includes('gameReview:an') && pending.includes('gameReview:at'));
  assert.equal(patch.set['gameReview:an'], AN);
  assert.ok(needsSend(coachGame, { linkActive: true }));
  // The student's app reads it back as a valid patch…
  assert.ok(parsePatch(JSON.stringify(patch)));
  // …and refuses anything that isn't text of the right size.
  const bad = { from: { 'gameReview:note': '∅' }, set: { 'gameReview:note': { x: 1 } } };
  assert.equal(parsePatch(JSON.stringify(bad)), null);
  const long = { from: { 'gameReview:an': '∅' }, set: { 'gameReview:an': 'x'.repeat(MAX_TEXT + 1) } };
  assert.equal(parsePatch(JSON.stringify(long)), null);
  const other = { from: { 'gameReview:who': '∅' }, set: { 'gameReview:who': 'x' } };
  assert.equal(parsePatch(JSON.stringify(other)), null);
  // The coach's mirror of a student's game copies it across.
  assert.deepEqual(sharedCopy(coachGame).gameReview, coachGame.gameReview);
});

test('the student’s own Game Review on their own game reaches the coach’s card', () => {
  const studentGame = {
    id: 'g2abcdef', name: 'Parker vs Sam', moves: MOVES, meta: {}, comments: {}, badges: {},
    gameReview: { note: 'I was nervous', an: '', at: 40 },
  };
  const first = mergeLinkedGames({ games: [] }, {
    studentUid: 'stu', coachUid: 'coach', games: [studentGame], complete: true, ledger: null, now: 1,
  });
  const copy = first.card.games.find((g) => g.id === 'g2abcdef');
  assert.ok(copy, 'mirrored');
  assert.equal(copy.gameReview.note, 'I was nervous');
  assert.equal(copy.link.base['gameReview:note'], hashesOf(studentGame)['gameReview:note']);
});

// ---------- a player's CLAMP and Tactics ----------
import { insightGames, insightSummary, speedOf, marksIn } from '../src/lib/gameReviewBridge.js';

test('the summary Chess Arcade’s CLAMP and Tactics tabs read a game by', () => {
  const player = { name: 'Myla Walavalkar', kind: 'student' };
  const s = insightSummary({
    moves: ['e4', 'e5', 'Nf3'], date: 1000,
    meta: { white: 'William Lin', black: 'Myla Walavalkar', whiteElo: '553', result: '1-0', timeControl: 'G/30;d5' },
  }, player);
  assert.equal(s.me, 'black', 'the player’s own name says which side');
  assert.equal(s.res, 'loss');
  assert.equal(s.opp, 'William Lin');
  assert.equal(s.oppRating, 553);
  assert.equal(s.myRating, null);
  assert.equal(s.san, 'e4 e5 Nf3');
  assert.equal(s.plies, 3);
  assert.equal(s.at, 1000);
  assert.deepEqual([s.speed, s.tc], ['classical', '1800-5']); // Lichess: 25 minutes and over is classical
  assert.equal(insightSummary({ moves: ['d4'], meta: { color: 'white', result: '1-0' } }, player).res, 'win');
  assert.equal(insightSummary({ moves: ['d4'], meta: { result: '*' } }, player).res, 'draw');
});

test('speeds: PGN seconds, US Chess minutes, and over the board when it can’t tell', () => {
  assert.deepEqual(speedOf('60+0'), { speed: 'bullet', tc: '60-0' });
  assert.deepEqual(speedOf('180+2'), { speed: 'blitz', tc: '180-2' });
  assert.deepEqual(speedOf('600+5'), { speed: 'rapid', tc: '600-5' });
  assert.deepEqual(speedOf('G/90+30'), { speed: 'classical', tc: '5400-30' });
  assert.deepEqual(speedOf('Game in 60'), { speed: 'classical', tc: '' });
  assert.deepEqual(speedOf(''), { speed: 'classical', tc: '' });
});

test('only games with CLAMP letters or tactics on them go to the two tabs', () => {
  const marked = JSON.stringify({ v: 1, l: [], c: [], m: [], k: [[9, 'L']] });
  const tac = JSON.stringify({ v: 1, l: [], c: [], m: [], t: [[6, 'fork', 'w', 'p', 'f1b5', '']] });
  const plain = JSON.stringify({ v: 1, l: [], c: [[2, 'note']], m: [] });
  assert.deepEqual(marksIn(marked), { clamp: true, tactics: false });
  assert.deepEqual(marksIn('nope'), { clamp: false, tactics: false });
  const player = {
    name: 'Myla', kind: 'self',
    games: [
      { id: 'g1aaaaaa', moves: ['e4'], meta: {}, gameReview: { note: '', an: marked } },
      { id: 'g2aaaaaa', moves: ['d4'], meta: {}, gameReview: { note: '', an: tac } },
      { id: 'g3aaaaaa', moves: ['c4'], meta: {}, gameReview: { note: 'n', an: plain } },
      { id: 'g4aaaaaa', moves: [], meta: {}, gameReview: { note: '', an: marked } },
    ],
  };
  const { games, byArcadeId } = insightGames(player);
  assert.deepEqual(games.map((g) => byArcadeId.get(g.id)), ['g1aaaaaa', 'g2aaaaaa']);
  assert.equal(games[1].tactics, true);
  assert.equal(games[0].an, marked);
});
