// Game dates — src/lib/gameDate.js: a game saved as Nov 14 shows as Nov 14,
// not Nov 13, west of Greenwich. Seen on the Analysis board's game card in
// New York: a date-only "2026-11-14" is kept as UTC midnight, which is the
// evening before in local time.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayParts, dayMs, isDayMs, localMoment, formatGameDate, isoDay, todayIso } from '../src/lib/gameDate.js';
import { arcadeGame, insightSummary } from '../src/lib/gameReviewBridge.js';
import { gameRecord } from '../src/lib/pgnArchive.js';

// How the game editor keeps the date box's "2026-11-14".
const SAVED = new Date('2026-11-14').getTime();

test('the clock really is New York and the saved value really is UTC midnight', () => {
  assert.equal(new Date(SAVED).getTimezoneOffset(), 300);
  assert.equal(SAVED, Date.UTC(2026, 10, 14));
  assert.equal(new Date(SAVED).getDate(), 13); // the bug, read the plain way
});

test('a saved game date shows as the day it was saved, not the day before', () => {
  assert.equal(formatGameDate(SAVED, undefined, 'en-US'), 'Nov 14, 2026');
  assert.equal(formatGameDate('2026-11-14', undefined, 'en-US'), 'Nov 14, 2026');
  assert.equal(formatGameDate('2026.11.14', undefined, 'en-US'), 'Nov 14, 2026');
  assert.equal(isoDay(SAVED), '2026-11-14');
  assert.equal(isoDay('2026.11.14'), '2026-11-14');
  // New Year's Day too, where the day before is also last year.
  assert.equal(formatGameDate(new Date('2027-01-01').getTime(), undefined, 'en-US'), 'Jan 1, 2027');
});

test('a real moment stays a moment, shown in local time', () => {
  const late = Date.UTC(2026, 10, 20, 2, 30); // 9:30 PM Nov 19 in New York
  assert.equal(isDayMs(late), false);
  assert.equal(localMoment(late), late);
  assert.equal(formatGameDate(late, undefined, 'en-US'), 'Nov 19, 2026');
  assert.equal(isoDay(late), '2026-11-19');
  assert.equal(formatGameDate('2026-11-20T02:30:00Z', undefined, 'en-US'), 'Nov 19, 2026');
});

test('no date, or half a date, is no date', () => {
  assert.equal(formatGameDate(null), '');
  assert.equal(formatGameDate(undefined), '');
  assert.equal(formatGameDate(''), '');
  assert.equal(formatGameDate(NaN), '');
  assert.equal(formatGameDate('2026.??.??'), '');
  assert.equal(isoDay(null), null);
  assert.equal(dayParts('2026.13.01'), null);
  assert.deepEqual(dayParts(' 2026.11.14 '), { y: 2026, m: 11, d: 14 });
  assert.ok(Number.isNaN(dayMs('????.??.??')));
  // Kept the way it always was, so old games and new ones sort together.
  assert.equal(dayMs('2026.11.14'), SAVED);
  assert.equal(dayMs('2026-11-14'), SAVED);
});

test("a new game's date box starts on today where you are, not tomorrow in London", () => {
  const evening = new Date(Date.UTC(2026, 10, 20, 2, 30)); // 9:30 PM Nov 19 in New York
  assert.equal(evening.toISOString().slice(0, 10), '2026-11-20'); // the old default
  assert.equal(todayIso(evening), '2026-11-19');
});

test("Chess Arcade's review is handed the game's day, which it shows in local time", () => {
  const shown = (ms) => new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  assert.equal(shown(arcadeGame({ moves: ['d4'], date: SAVED }, 'r_000001').createdAt), 'Nov 14, 2026');
  assert.equal(shown(arcadeGame({ moves: ['d4'], meta: { date: '2026.11.14' } }, 'r_000001').createdAt), 'Nov 14, 2026');
  assert.equal(shown(arcadeGame({ moves: ['d4'], meta: { date: '2026-11-14' } }, 'r_000001').createdAt), 'Nov 14, 2026');
  const late = Date.UTC(2026, 10, 20, 2, 30);
  assert.equal(arcadeGame({ moves: ['d4'], date: late }, 'r_000001').createdAt, late);
  assert.equal(arcadeGame({ moves: ['d4'], meta: { date: '2026.??.??' } }, 'r_000001').createdAt, undefined);
  const s = insightSummary({ moves: ['d4'], date: SAVED, meta: { color: 'white' } }, { name: 'Tester' });
  assert.equal(shown(s.at), 'Nov 14, 2026');
});

test('a game from a PGN file keeps its day the way the editor does', () => {
  const item = { white: 'Tester', black: 'Oppo77', result: '1-0', date: '2026-11-14', headers: {} };
  const rec = gameRecord(item, { moves: ['e4', 'e5'] }, null);
  assert.equal(rec.date, SAVED);
  assert.equal(formatGameDate(rec.date, undefined, 'en-US'), 'Nov 14, 2026');
});
