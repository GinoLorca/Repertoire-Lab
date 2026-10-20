// ChessKid practice from ICN — src/lib/icn.js, and the function that serves
// it (netlify/functions/icn.mjs). Made-up students, in the shape the Chess
// Club Tracker publishes data/icn/<school>.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  studentStats, matchesIn, suggestions, accuracy, tone, weekStart, weekByWeek, icnStale, DEFAULT_GOAL,
} from '../src/lib/icn.js';
import handler from '../netlify/functions/icn.mjs';

const row = (name, o) => ({
  name, grade: '2nd', plw: 0, plwYtd: 0, chessKidRating: 800, uscfRating: null, level: 'Pawn 3', lessons: 0, workouts: 0, puzzlesCorrect: 0, puzzlesAttempted: 0, ...o,
});
const SCHOOL = {
  icnId: 'ps11',
  icnLastUpdated: '2026-10-18 23:00',
  capturedAt: '2026-10-19T11:04:00.000Z',
  players: [
    row('ALEX RIVERA', {
      grade: '1st', plw: 396, plwYtd: 818, chessKidRating: 1411, level: 'King 34', lessons: 1, workouts: 0, puzzlesCorrect: 193, puzzlesAttempted: 363,
    }),
    row('Sam Rivera', { puzzlesCorrect: 40, puzzlesAttempted: 50 }),
    row('Alex Chen', { puzzlesCorrect: 7, puzzlesAttempted: 10 }),
  ],
  weeks: {
    '2026-W41': { date: '2026-10-11', stats: { 'ALEX RIVERA': [264, 1, 0, 127, 250, 1359, 524] } },
    '2026-W40': { date: '2026-10-04', stats: { 'ALEX RIVERA': [158, 0, 0, 79, 155, 1408, 579] } },
    '2026-W43': { date: '2026-10-19', stats: { 'ALEX RIVERA': [396, 1, 0, 193, 363, 1411, 540], 'Sam Rivera': [10, 0, 0, 40, 50, 800, 0] } },
    '2026-W42': { date: '2026-10-18', stats: { 'ALEX RIVERA': [356, 1, 0, 173, 321, 1420, 710] } },
  },
};

test('a student’s numbers, however their name is written', () => {
  const s = studentStats(SCHOOL, 'Alex Rivera', 'ps11');
  assert.equal(s.name, 'ALEX RIVERA');
  assert.deepEqual(
    [s.plw, s.plwYtd, s.lessons, s.workouts, s.correct, s.attempted, s.rating, s.level, s.grade],
    [396, 818, 1, 0, 193, 363, 1411, 'King 34', '1st'],
  );
  assert.equal(s.icnUpdated, '2026-10-18 23:00');
  // Weeks in order, oldest first.
  assert.deepEqual(s.weeks.map((w) => w.week), ['2026-W40', '2026-W41', '2026-W42', '2026-W43']);
  assert.deepEqual(s.weeks[2], {
    week: '2026-W42', date: '2026-10-18', plw: 356, lessons: 1, workouts: 0, correct: 173, attempted: 321, rating: 1420,
  });
  assert.equal(studentStats(SCHOOL, 'alex   rivera', 'ps11')?.name, 'ALEX RIVERA');
  assert.equal(studentStats(SCHOOL, 'Alex J. Rivera', 'ps11')?.name, 'ALEX RIVERA');
  assert.equal(studentStats(SCHOOL, 'Rivera', 'ps11'), null, 'one word isn’t enough');
  assert.equal(studentStats(SCHOOL, 'Jordan Lee', 'ps11'), null);
});

test('not on the page: names like it are offered, and found ones give school and grade', () => {
  assert.deepEqual(suggestions(SCHOOL, 'Alex Riviera'), ['ALEX RIVERA', 'Alex Chen']);
  assert.deepEqual(suggestions(SCHOOL, 'Jo Rivera'), ['ALEX RIVERA', 'Sam Rivera']);
  assert.deepEqual(matchesIn(SCHOOL, 'Alex Rivera'), [{ name: 'ALEX RIVERA', grade: '1st' }]);
  assert.deepEqual(matchesIn(SCHOOL, 'Nobody Here'), []);
});

test('accuracy, and how it sits against the goal', () => {
  assert.equal(accuracy(193, 363), 53.2);
  assert.equal(accuracy(0, 0), null);
  assert.equal(DEFAULT_GOAL, 70);
  assert.equal(tone(53.2), 'low');
  assert.equal(tone(64.8), 'near');
  assert.equal(tone(70), 'good');
  assert.equal(tone(85, 90), 'near');
  assert.equal(tone(null), null);
});

test('week by week: each week’s own puzzles, newest first', () => {
  assert.equal(weekStart('2026-W42'), '2026-10-12');
  assert.equal(weekStart('2026-W01'), '2025-12-29');
  assert.equal(weekStart('nope'), null);
  const weeks = weekByWeek(studentStats(SCHOOL, 'Alex Rivera', 'ps11').weeks);
  assert.deepEqual(weeks.map((w) => [w.start, w.correct, w.attempted, w.accuracy, w.plw]), [
    ['2026-10-19', 20, 42, 47.6, 396],
    ['2026-10-12', 46, 71, 64.8, 356],
    ['2026-10-05', 48, 95, 50.5, 264],
  ]);
  // A new season on ICN starts the totals again: that week counts from zero.
  const reset = weekByWeek([
    { week: '2027-W35', correct: 400, attempted: 600 },
    { week: '2027-W36', correct: 12, attempted: 20 },
  ]);
  assert.deepEqual([reset[0].correct, reset[0].attempted], [12, 20]);
  assert.deepEqual(weekByWeek([]), []);
});

test('asked for again after a few hours, not before', () => {
  const now = Date.UTC(2026, 9, 20, 12);
  assert.ok(icnStale(null, now));
  assert.ok(!icnStale({ fetchedAt: now - 60 * 60 * 1000 }, now));
  assert.ok(icnStale({ fetchedAt: now - 4 * 60 * 60 * 1000 }, now));
});

test('the function: one student back, never the class', async (t) => {
  const asked = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    asked.push(String(url));
    if (String(url).endsWith('/ps11.json')) return new Response(JSON.stringify(SCHOOL));
    if (String(url).endsWith('.json')) return new Response(JSON.stringify({ players: [], weeks: {} }));
    return new Response('nope', { status: 404 });
  });
  const call = async (qs) => {
    const res = await handler(new Request(`https://example.org/.netlify/functions/icn?${qs}`));
    return { status: res.status, body: await res.json() };
  };
  let r = await call('school=ps11&name=Alex%20Rivera');
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'ALEX RIVERA');
  assert.equal(r.body.attempted, 363);
  assert.ok(!('players' in r.body), 'the rest of the class stays out');
  assert.equal(asked[0], 'https://chess-club-leaderboard.netlify.app/data/icn/ps11.json');

  r = await call('school=ps11&name=Alex%20Riviera');
  assert.equal(r.status, 404);
  assert.deepEqual(r.body.suggestions, ['ALEX RIVERA', 'Alex Chen']);

  r = await call('find=Alex%20Rivera');
  assert.deepEqual(r.body.matches, [{ name: 'ALEX RIVERA', grade: '1st', school: 'ps11' }]);

  assert.equal((await call('school=ps99&name=x')).status, 400);
  assert.equal((await call('school=ps11')).status, 400);
});
