// The student dashboard's US Chess data: history, crosstables, the numbers
// worked out from them, and games recorded in the app lined up with the
// rounds US Chess rated. Fixtures follow the real API's shapes (member
// 31955868, the 2026 NY State Championship).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHistory, normalizeStanding, standing, ratingSeries, outcomeCode, loadHistory, loadStandings,
  mainSystem, parseSectionKey, patient,
} from '../src/lib/uscfHistory.js';
import {
  ratedGames, sectionSummary, timeClass, splits, form, highlights, expectedScore,
} from '../src/lib/uscfStats.js';
import {
  matchGames, nameFit, confirmMeta, refuseMeta, unlinkMeta, isCandidateGame,
} from '../src/lib/uscfMatch.js';

const member = {
  id: '31955868', firstName: 'Gino', lastName: 'Lorca', stateRep: 'NY', status: 'Active', expirationDate: '2032-09-30',
  rank: 51548, stateRank: 5815,
  ratings: [
    { rating: 475, ratingSystem: 'R', gamesPlayed: 5, isProvisional: true, floor: 114 },
    { rating: 469, ratingSystem: 'Q', gamesPlayed: 5, isProvisional: true, floor: 105 },
    { ratingSystem: 'B', isProvisional: true },
  ],
};
const sec = (eventId, n, name, start, end, system, records, eventName) => ({
  sectionNumber: n, sectionName: name, startDate: start, endDate: end, format: 'Swiss', ratingSystem: system,
  ratingRecords: records.map(([src, pre, post, prov]) => ({ ratingSource: src, preRating: pre, postRating: post, postProvisionalGameCount: prov })),
  event: { id: eventId, name: eventName, startDate: start, endDate: end, stateCode: 'NY' },
});
const sections = [
  sec('202609070223', 5, 'Under 1200 Section', '2026-09-04', '2026-09-07', 'R', [['R', 475, 700, 9]], '148th Annual NY State Championship!'),
  sec('202508014782', 3, 'U600', '2025-07-28', '2025-08-01', 'D', [['R', 406, 475, 5], ['Q', 398, 469, 5]], 'IMPACTCOACHINGNETWORK.ORG MIDTOWN CAMP WEEK5'),
  sec('202407123012', 5, '7/12', '2024-07-08', '2024-07-12', 'D', [['R', null, 406, 1], ['Q', null, 398, 1]], 'IMPACTCOACHINGNETWORK.ORG UES SUMMER TRAINING CAMP'),
];
const lists = [
  { ratingSupplementDate: '2026-10-01', ratings: [{ source: 'R', rating: 700, provisionalGameCount: 9 }, { source: 'Q', rating: 469, provisionalGameCount: 5 }, { source: 'B' }] },
  { ratingSupplementDate: '2025-09-01', ratings: [{ source: 'R', rating: 475, provisionalGameCount: 5 }] },
];

// The NY State crosstable, trimmed to the rows that matter.
const row = (pid, memberId, first, last, pre, post, rounds = [], ordinal = 1, score = 0) => ({
  ordinal, playerId: pid, memberId, firstName: first, lastName: last, score,
  ratings: [{ preRating: pre, postRating: post, ratingSystem: 'R' }],
  roundOutcomes: rounds,
});
const ro = (n, outcome, color, opp) => ({
  roundNumber: n, outcome, color,
  opponentPlayerId: opp?.pid ?? '', opponentMemberId: opp?.id, opponentFirstName: opp?.first, opponentLastName: opp?.last,
});
const crawford = { pid: 'p1', id: '16416245', first: 'Elliott', last: 'Crawford' };
const htun = { pid: 'p2', id: '32943323', first: 'Samuel', last: 'Htun' };
const palaitis = { pid: 'p3', id: '10150582', first: 'Waldemar', last: 'Palaitis' };
const magnussen = { pid: 'p4', id: '32244441', first: 'Keith', last: 'Magnussen' };
const standingsItems = [
  row('me', '31955868', 'Gino', 'Lorca', 475, 700, [
    ro(1, 'ByeFull', 'Unknown'),
    ro(2, 'Loss', 'White', crawford),
    ro(3, 'Win', 'Black', htun),
    ro(4, 'Win', 'White', palaitis),
    ro(5, 'Loss', 'Black', magnussen),
    ro(6, 'Unpaired', 'Unknown'),
  ], 21, 3),
  row('p1', '16416245', 'ELLIOTT', 'CRAWFORD', 1182, 1190),
  row('p2', '32943323', 'SAMUEL', 'HTUN', 1065, 1050),
  row('p3', '10150582', 'WALDEMAR', 'PALAITIS', 917, 900),
  row('p4', '32244441', 'KEITH', 'MAGNUSSEN', 1078, 1085),
];
const detail = { playerCount: 35, roundCount: 6, timeControl: '40/80,SD/30;d30', ratingSystem: 'R', isOnline: false };

const history = normalizeHistory(member, sections, lists);
const nyKey = '202609070223:5';
const ny = normalizeStanding(standingsItems, '31955868', detail);
const standings = { [nyKey]: ny };

test('history: profile, sections newest first, ratings by system', () => {
  assert.equal(history.name, 'Gino Lorca');
  assert.equal(history.rank, 51548);
  assert.deepEqual(Object.keys(history.ratings), ['R', 'Q']);
  assert.deepEqual(history.sections.map((s) => s.key), [nyKey, '202508014782:3', '202407123012:5']);
  assert.equal(mainSystem(history.sections[1]), 'R');
  assert.deepEqual(parseSectionKey(nyKey), { eventId: '202609070223', section: 5 });
  assert.equal(parseSectionKey('../evil:5'), null);
});

test('where each rating stands: live, official, next list, peak', () => {
  const s = standing(history, '2026-09-27');
  assert.equal(s.R.live, 700);
  assert.equal(s.R.change, 225);
  assert.equal(s.R.official, 475);
  assert.equal(s.R.next, 700);
  assert.equal(s.R.nextDate, '2026-10-01');
  assert.equal(s.R.peak, 700);
  assert.equal(s.R.provisionalGames, 9);
  assert.equal(s.Q.live, 469);
  // Once the list's month arrives it isn't "next" any more.
  assert.equal(standing(history, '2026-10-02').R.next, null);
  assert.deepEqual(ratingSeries(history, 'R').map((p) => p.post), [406, 475, 700]);
});

test('a crosstable as the member saw it: rounds, colours, opponents and their ratings', () => {
  assert.equal(ny.place, 21);
  assert.equal(ny.field, 35);
  assert.equal(ny.score, 3);
  assert.deepEqual(ny.rounds.map((r) => r.result), ['BF', 'L', 'W', 'W', 'L', 'U']);
  assert.deepEqual(ny.rounds[1], {
    round: 2, result: 'L', color: 'white', oppId: '16416245', oppFirst: 'Elliott', oppLast: 'Crawford',
    oppName: 'Elliott Crawford', oppPre: 1182, oppPost: 1190,
  });
  assert.equal(ny.rounds[0].oppName, null);
  assert.equal(outcomeCode('ForfeitWin'), 'FW');
  assert.equal(outcomeCode('ByeHalf'), 'BH');
  // Someone else's crosstable: nothing.
  assert.equal(normalizeStanding(standingsItems, '99999999', detail), null);
});

test('numbers from the games: performance, expected score, time class, splits, form', () => {
  const sum = sectionSummary(history.sections[0], ny);
  assert.equal(sum.points, 3);
  assert.equal(sum.games, 4);
  assert.equal(sum.byes, 1);
  assert.equal(sum.avgOpp, 1061);
  assert.equal(sum.performance, 1061); // two wins, two losses
  assert.ok(sum.overExpected > 1.5); // 2 points where the ratings gave about 0.3
  assert.equal(timeClass('40/80,SD/30;d30'), 'classical');
  assert.equal(timeClass('G/25;d5'), 'rapid');
  assert.equal(timeClass('G/10;d2'), 'quick');
  assert.equal(timeClass('G/3;d2'), 'blitz');
  assert.equal(timeClass(''), null);
  assert.ok(Math.abs(expectedScore(1400, 1000) - 0.909) < 0.001);
  const games = ratedGames(history, standings);
  assert.equal(games.length, 4);
  const sp = splits(games);
  assert.deepEqual(sp.byGap.map((b) => b.games), [4, 0, 0, 0]);
  assert.equal(sp.byGap[0].W, 2);
  assert.deepEqual(sp.byColor.map((c) => `${c.W}-${c.D}-${c.L}`), ['1-0-1', '1-0-1']);
  const f = form(games);
  assert.deepEqual(f.last.map((g) => g.result), ['L', 'W', 'W', 'L']);
  assert.deepEqual(f.current, { result: 'L', length: 1 });
  assert.equal(f.longestWin, 2);
  assert.deepEqual(f.bounceBack, { wins: 1, of: 1 });
  const h = highlights(games);
  assert.equal(h.upsets[0].oppName, 'Samuel Htun');
  assert.equal(h.traps.length, 0);
});

// The games on the card, as the app has them.
const game = (id, meta, extra = {}) => ({ id, name: 'x', moves: [], date: Date.parse('2026-09-08T10:00:00Z'), meta, ...extra });
const games = [
  game('magnussen', { white: 'Keith Magnussen', whiteElo: '1078', black: 'Gino Lorca', blackElo: '475', result: '1-0', color: 'black', date: '2026-09-06', event: 'NYS Championship u1200', round: '5', eventType: 'otb' }),
  // Round written wrong (it was 3), but everything else fits.
  game('htun', { white: 'Samuel Htun', whiteElo: '1084', black: 'Gino Lorca', result: '0-1', color: 'black', date: '2026-09-06', event: 'NYS Championship u1200', round: '5', eventType: 'otb' }),
  game('crawford', { white: 'Gino Lorca', black: 'Elliott Crawford', blackElo: '1031', result: '0-1', color: 'white', date: '2026-09-05', event: 'NYS Championship u1200', eventType: 'otb' }),
  // A scanned scoresheet saved with no details the day after.
  game('scan', null),
  game('online', { white: 'Gino', black: 'Someone', result: '1-0', color: 'white', date: '2026-09-05', eventType: 'chess.com' }),
];

test('recorded games line up with the rounds US Chess rated', () => {
  const m = matchGames(history, standings, games);
  assert.equal(m.played, 4);
  assert.equal(m.rounds[`${nyKey}:5`].gameId, 'magnussen');
  assert.equal(m.rounds[`${nyKey}:5`].state, 'matched');
  assert.equal(m.rounds[`${nyKey}:3`].gameId, 'htun'); // the opponent outweighs a wrong round
  assert.equal(m.rounds[`${nyKey}:2`].gameId, 'crawford');
  assert.equal(m.rounds[`${nyKey}:2`].state, 'matched');
  // The scan can only be a suggestion, for the round left over.
  assert.equal(m.rounds[`${nyKey}:4`].gameId, 'scan');
  assert.equal(m.rounds[`${nyKey}:4`].state, 'suggested');
  assert.equal(m.recorded, 3);
  assert.ok(!isCandidateGame(games[4]));
  assert.ok(!m.unmatched.includes('online'));
});

test('confirming writes the link and fills in what the game was missing; refusing is remembered', () => {
  const r4 = ny.rounds[3];
  const meta = confirmMeta(games[3], history.sections[0], r4, { name: 'Gino Lorca' });
  assert.equal(meta.uscfRef, `${nyKey}:4`);
  assert.equal(meta.uscfOpp, '10150582');
  assert.equal(meta.white, 'Gino Lorca');
  assert.equal(meta.black, 'Waldemar Palaitis');
  assert.equal(meta.blackElo, '917');
  assert.equal(meta.result, '1-0');
  assert.equal(meta.round, '4');
  assert.equal(meta.date, '2026-09-07');
  // A confirmed link stands even when a better-scored game appears.
  const linked = games.map((g) => (g.id === 'scan' ? { ...g, meta } : g));
  const m = matchGames(history, standings, linked);
  assert.equal(m.rounds[`${nyKey}:4`].state, 'linked');
  assert.equal(m.rounds[`${nyKey}:4`].gameId, 'scan');
  assert.equal(m.recorded, 4);
  // Turned down: that game isn't offered for that round again.
  const refused = games.map((g) => (g.id === 'scan' ? { ...g, meta: refuseMeta(g, `${nyKey}:4`) } : g));
  assert.notEqual(matchGames(history, standings, refused).rounds[`${nyKey}:4`]?.gameId, 'scan');
  const undone = unlinkMeta({ meta });
  assert.deepEqual([undone.uscfRef, undone.uscfOpp, undone.uscfNot], ['', '', `${nyKey}:4`]);
});

test('a game whose colour or result disagrees is never paired, and a confirmed one is flagged', () => {
  const wrong = [game('x', { white: 'Keith Magnussen', black: 'Gino Lorca', result: '0-1', color: 'black', date: '2026-09-06', round: '5', eventType: 'otb' })];
  assert.equal(matchGames(history, standings, wrong).rounds[`${nyKey}:5`], undefined);
  const forced = [game('x', { ...wrong[0].meta, uscfRef: `${nyKey}:5` })];
  assert.equal(matchGames(history, standings, forced).rounds[`${nyKey}:5`].conflict, true);
});

test('names on a scoresheet fit a US Chess opponent however they\'re written', () => {
  assert.equal(nameFit('Crawford, Elliott', 'Elliott', 'Crawford'), 2);
  assert.equal(nameFit('E. Crawford', 'Elliott', 'Crawford'), 2);
  assert.equal(nameFit('Crawford', 'Elliott', 'Crawford'), 1);
  assert.equal(nameFit('Elliot Crawfurd', 'Elliott', 'Crawford'), 0);
  assert.equal(nameFit('', 'Elliott', 'Crawford'), 0);
});

test('fetching: pages followed, crosstables trimmed to the member, bad input refused', async () => {
  const calls = [];
  const api = {
    '/members/31955868': member,
    '/members/31955868/sections?Offset=0&Size=100': { items: sections.slice(0, 2), hasNextPage: true },
    '/members/31955868/sections?Offset=100&Size=100': { items: sections.slice(2), hasNextPage: false },
    '/members/31955868/rating-supplements?Offset=0&Size=100': { items: lists, hasNextPage: false },
    '/rated-events/202609070223/sections/5/standings?Offset=0&Size=100': { items: standingsItems, hasNextPage: false },
    '/rated-events/202609070223/sections/5': detail,
  };
  const getJson = async (p) => { calls.push(p); return api[p] ?? null; };
  const h = await loadHistory(getJson, '31955868');
  assert.equal(h.sections.length, 3);
  const xt = await loadStandings(getJson, '31955868', [nyKey, 'nonsense', '202508014782:3']);
  assert.equal(xt[nyKey].rounds.length, 6);
  assert.equal(xt['202508014782:3'], null);
  assert.ok(!('nonsense' in xt));
  assert.ok(calls.every((c) => c.startsWith('/members/31955868') || c.startsWith('/rated-events/2025') || c.startsWith('/rated-events/2026')));
  await assert.rejects(() => loadHistory(getJson, '12;DROP'), /8 digits/);
  assert.equal(await loadHistory(async () => null, '12345678'), null);
});

test('the function answers history, crosstables, and nothing else', async () => {
  const { default: handler } = await import('../netlify/functions/uscf-history.mjs');
  const realFetch = globalThis.fetch;
  const api = {
    'https://ratings-api.uschess.org/api/v1/members/31955868': member,
    'https://ratings-api.uschess.org/api/v1/members/31955868/sections?Offset=0&Size=100': { items: sections, hasNextPage: false },
    'https://ratings-api.uschess.org/api/v1/members/31955868/rating-supplements?Offset=0&Size=100': { items: lists, hasNextPage: false },
    'https://ratings-api.uschess.org/api/v1/rated-events/202609070223/sections/5/standings?Offset=0&Size=100': { items: standingsItems, hasNextPage: false },
    'https://ratings-api.uschess.org/api/v1/rated-events/202609070223/sections/5': detail,
  };
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    // US Chess having a bad moment for this one section.
    if (String(url).includes('202508014782')) return new Response('{}', { status: 503 });
    const body = api[String(url)];
    return new Response(body ? JSON.stringify(body) : '{}', { status: body ? 200 : 404 });
  };
  try {
    const h = await (await handler(new Request('https://x/.netlify/functions/uscf-history?id=31955868'))).json();
    assert.equal(h.name, 'Gino Lorca');
    const res = await handler(new Request(`https://x/?id=31955868&xt=${nyKey},../../members`));
    assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
    const xt = await res.json();
    assert.equal(xt.standings[nyKey].place, 21);
    // A section whose request failed isn't cached as an answer.
    const partial = await handler(new Request('https://x/?id=31955868&xt=202508014782:3'));
    assert.equal(partial.headers.get('cache-control'), 'no-store');
    assert.equal((await handler(new Request('https://x/?id=abc'))).status, 400);
    assert.equal((await handler(new Request('https://x/?id=31955868&xt=../../x'))).status, 400);
    assert.ok(asked.every((u) => u.startsWith('https://ratings-api.uschess.org/api/v1/members/31955868')
      || u.startsWith('https://ratings-api.uschess.org/api/v1/rated-events/202609070223/sections/5')
      || u.startsWith('https://ratings-api.uschess.org/api/v1/rated-events/202508014782/sections/3')));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('forfeits as the API writes them: "WinForfeit" is a point, a bare "Forfeit" is none', () => {
  assert.equal(outcomeCode('WinForfeit'), 'FW');
  assert.equal(outcomeCode('Forfeit'), 'FL');
  assert.equal(outcomeCode('ForfeitWin'), 'FW');
  const rows = [row('me', '1111111', 'A', 'B', 500, 480, [ro(1, 'Loss', 'White', crawford), ro(2, 'Forfeit', 'Unknown')], 3, 0),
    row('p1', '16416245', 'E', 'C', 900, 900)];
  const st = normalizeStanding(rows, '1111111', { playerCount: 2, ratingSystem: 'R' });
  assert.deepEqual(st.rounds.map((r) => r.result), ['L', 'FL']);
  assert.equal(sectionSummary({ records: { R: { pre: 500 } } }, st).points, 0);
});

test('a dual-rated section uses Regular for everyone, whatever order the rows list their ratings', () => {
  const dual = (pid, memberId, reg, quick, rounds = []) => ({
    playerId: pid, memberId, firstName: 'X', lastName: pid, score: 0, ordinal: 1,
    // Quick listed first, as the API often does.
    ratings: [{ ratingSystem: 'Q', preRating: quick, postRating: quick }, { ratingSystem: 'R', preRating: reg, postRating: reg }],
    roundOutcomes: rounds,
  });
  const items = [
    dual('me', '32653994', 431, 252, [ro(1, 'Win', 'White', { pid: 'o1', id: '1', first: 'O', last: 'One' })]),
    dual('o1', '1', 775, 606),
  ];
  const st = normalizeStanding(items, '32653994', { ratingSystem: 'D', playerCount: 2 });
  assert.equal(st.system, 'R');
  assert.equal(st.pre, 431);
  assert.equal(st.rounds[0].oppPre, 775);
  // An opponent with no Regular rating is unrated here, not their Quick number.
  const noReg = [dual('me', '32653994', 431, 252, [ro(1, 'Win', 'White', { pid: 'o2', id: '2', first: 'O', last: 'Two' })]),
    { playerId: 'o2', memberId: '2', ratings: [{ ratingSystem: 'Q', preRating: 300 }] }];
  assert.equal(normalizeStanding(noReg, '32653994', { ratingSystem: 'D' }).rounds[0].oppPre, null);
});

test('expected score is held against points from the same games; "unrated" means the opponent', () => {
  const h = normalizeHistory(member, [sections[2]]); // first event: no rating going in
  const first = { '202407123012:5': normalizeStanding([
    row('me', '31955868', 'Gino', 'Lorca', null, 406, [ro(1, 'Loss', 'White', { pid: 'b', id: '9', first: 'M', last: 'Baez' })]),
    row('b', '9', 'M', 'BAEZ', 741, 745),
  ], '31955868', { ratingSystem: 'R' }) };
  const sp = splits(ratedGames(h, first));
  assert.equal(sp.unrated.games, 0);
  assert.equal(sp.beforeRated.games, 1);
  const games = ratedGames(history, standings);
  const all = splits(games).all;
  assert.equal(all.ratedPoints, 2);
  assert.ok(all.expected > 0 && all.expected < 1);
});

test('matching: a named opponent who isn\'t the one paired only suggests; scouting games never match', () => {
  const clash = [game('x', { white: 'Tom Brown', black: 'Gino Lorca', result: '1-0', color: 'black', date: '2026-09-06', round: '5', eventType: 'otb' })];
  assert.equal(matchGames(history, standings, clash).rounds[`${nyKey}:5`].state, 'suggested');
  const scouting = [game('s', { white: 'Keith Magnussen', black: 'Someone', result: '1-0', color: 'none', date: '2026-09-06', eventType: 'otb' })];
  assert.equal(Object.keys(matchGames(history, standings, scouting).rounds).length, 0);
});

test('matching: a game typed in days later is still offered, and a dateless game turned down once leaves the section', () => {
  const later = [game('l', { white: 'Keith Magnussen', black: 'Gino Lorca', result: '1-0', color: 'black', date: '2026-09-12', round: '5', eventType: 'otb' })];
  const m = matchGames(history, standings, later);
  assert.equal(m.rounds[`${nyKey}:5`].gameId, 'l');
  assert.equal(m.rounds[`${nyKey}:5`].state, 'suggested');
  const bare = game('b', null);
  const once = matchGames(history, standings, [{ ...bare, meta: refuseMeta(bare, `${nyKey}:2`) }]);
  assert.equal(Object.values(once.rounds).filter((r) => r.gameId === 'b').length, 0);
});

test('unlinking takes back what the link filled in, but not what was edited since', () => {
  const bare = game('scan', null);
  const meta = confirmMeta(bare, history.sections[0], ny.rounds[3], { name: 'Gino Lorca', rating: 475, timeControl: '40/80,SD/30;d30' });
  assert.equal(meta.whiteElo, '475');
  assert.equal(meta.timeControl, '40/80,SD/30;d30');
  const edited = { ...meta, event: 'My own name for it' };
  const undo = unlinkMeta({ meta: edited });
  assert.equal(undo.uscfRef, '');
  assert.equal(undo.black, ''); // filled by the link: taken back
  assert.equal(undo.round, '');
  assert.ok(!('event' in undo)); // edited since: left alone
});

test('told to slow down, the reader waits and asks again; other errors aren\'t retried', async () => {
  let n = 0;
  const busy = async () => {
    n += 1;
    if (n < 3) { const e = new Error('busy'); e.status = 429; e.retryAfter = 0.01; throw e; }
    return { ok: true };
  };
  assert.deepEqual(await patient(busy)('/x'), { ok: true });
  assert.equal(n, 3);
  let m = 0;
  const broken = async () => { m += 1; const e = new Error('nope'); e.status = 500; throw e; };
  await assert.rejects(() => patient(broken)('/x'), /nope/);
  assert.equal(m, 1);
});
