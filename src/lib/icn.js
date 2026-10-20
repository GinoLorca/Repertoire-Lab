// A student's ChessKid practice, from their school's stats page on Impact
// Coaching Network (ICN): PLW, lessons, workouts and puzzles. The Chess Club
// Tracker (the chess-club-leaderboard repo) reads every ICN school page each
// morning and publishes it as data/icn/<school>.json:
//
//   players  [{ name, grade, plw, plwYtd, chessKidRating, uscfRating, level,
//              lessons, workouts, puzzlesCorrect, puzzlesAttempted }]
//   weeks    { '2026-W42': { date, stats: { <name>: [plw, lessons, workouts,
//              puzzlesCorrect, puzzlesAttempted, chessKidRating,
//              uscfRating] } } } — the latest numbers in each week
//
// PLW is this week's, lessons and workouts the last 7 days', and puzzles the
// season's so far — so a week's puzzles are the difference between two
// weeks' totals.
//
// Pure (no DOM, no store): tests/icn.test.mjs covers it, and the Netlify
// function that serves it to the app (netlify/functions/icn.mjs) runs it.

export const ICN_TRACKER = 'https://chess-club-leaderboard.netlify.app';
export const ICN_SCHOOLS = [
  { id: 'ps11', name: 'P.S. 11' },
  { id: 'ps33', name: 'P.S. 33' },
  { id: 'ps40', name: 'P.S. 40' },
  { id: 'ps59', name: 'P.S. 59' },
];
export const schoolName = (id) => ICN_SCHOOLS.find((s) => s.id === id)?.name ?? id;
export const isIcnSchool = (id) => ICN_SCHOOLS.some((s) => s.id === id);

// The puzzle accuracy a student aims for, unless their card says otherwise.
export const DEFAULT_GOAL = 70;
// How many weeks a card keeps: a season's worth at a glance, and small.
const KEEP_WEEKS = 16;

const num = (v) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : null);
const words = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const key = (s) => words(s).join(' ');

// The ICN row for a name: written the same (ICN capitalises some names
// "PARKER DOWNING"), else every word of one in the other — "Parker Downing"
// for "Parker J Downing".
function rowFor(players, name) {
  const want = key(name);
  if (!want) return null;
  const exact = players.find((p) => key(p.name) === want);
  if (exact) return exact;
  const a = words(name);
  const close = players.filter((p) => {
    const b = words(p.name);
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.length >= 2 && short.every((w) => long.includes(w));
  });
  return close.length === 1 ? close[0] : null;
}

// Names on the page that look like `name`: the same first name, or the same
// last — what to offer when it isn't found as typed.
export function suggestions(file, name, max = 5) {
  const a = words(name);
  if (!a.length) return [];
  const first = a[0];
  const last = a[a.length - 1];
  return (file?.players ?? [])
    .filter((p) => { const b = words(p.name); return b[0] === first || b[b.length - 1] === last; })
    .slice(0, max)
    .map((p) => p.name);
}

// Who on this page has this name: [{ name, grade }] — at most one, unless
// the page lists two people the name fits equally.
export function matchesIn(file, name) {
  const row = rowFor(file?.players ?? [], name);
  return row ? [{ name: row.name, grade: row.grade ?? '' }] : [];
}

// One student's numbers from a school's file, or null when they aren't on
// it. `weeks` oldest first, each the week's latest totals.
export function studentStats(file, name, school) {
  const row = rowFor(file?.players ?? [], name);
  if (!row) return null;
  const k = key(row.name);
  const weeks = Object.entries(file.weeks ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, w]) => {
      const entry = Object.entries(w?.stats ?? {}).find(([n]) => key(n) === k);
      if (!entry) return null;
      const [plw, lessons, workouts, correct, attempted, rating] = entry[1];
      return {
        week, date: w.date ?? null, plw: num(plw), lessons: num(lessons), workouts: num(workouts), correct: num(correct), attempted: num(attempted), rating: num(rating),
      };
    })
    .filter(Boolean)
    .slice(-KEEP_WEEKS);
  return {
    school,
    name: row.name,
    grade: row.grade ?? '',
    plw: num(row.plw),
    plwYtd: num(row.plwYtd),
    lessons: num(row.lessons),
    workouts: num(row.workouts),
    correct: num(row.puzzlesCorrect),
    attempted: num(row.puzzlesAttempted),
    rating: num(row.chessKidRating),
    level: row.level ?? '',
    // When ICN last changed its page, and when the tracker read it.
    icnUpdated: file.icnLastUpdated ?? null,
    capturedAt: file.capturedAt ?? null,
    weeks,
  };
}

// Correct out of attempted, 0–100, or null with nothing attempted.
export function accuracy(correct, attempted) {
  if (!attempted || correct == null) return null;
  return Math.round((correct / attempted) * 1000) / 10;
}

// How an accuracy sits against the goal: 'good' at or past it, 'near'
// within ten points, 'low' further off.
export function tone(acc, goal = DEFAULT_GOAL) {
  if (acc == null) return null;
  if (acc >= goal) return 'good';
  if (acc >= goal - 10) return 'near';
  return 'low';
}

// The Monday an ISO week ('2026-W42') starts on, as 'YYYY-MM-DD'.
export function weekStart(week) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(week ?? '');
  if (!m) return null;
  const jan4 = Date.UTC(Number(m[1]), 0, 4);
  const day = (new Date(jan4).getUTCDay() + 6) % 7; // Monday 0
  const monday = jan4 - day * 864e5 + (Number(m[2]) - 1) * 7 * 864e5;
  return new Date(monday).toISOString().slice(0, 10);
}

// Each week's own practice, newest first: its PLW, lessons and workouts, and
// the puzzles done that week (this week's totals less last week's). The
// oldest week saved has nothing before it to count from, so it's left out —
// and a total that went down (a new season on ICN) counts from zero.
export function weekByWeek(weeks) {
  const out = [];
  for (let i = 1; i < (weeks ?? []).length; i += 1) {
    const w = weeks[i];
    const prev = weeks[i - 1];
    const reset = w.attempted != null && prev.attempted != null && w.attempted < prev.attempted;
    const attempted = w.attempted == null ? null : w.attempted - (reset ? 0 : prev.attempted ?? 0);
    const correct = w.correct == null ? null : w.correct - (reset ? 0 : prev.correct ?? 0);
    out.push({
      week: w.week,
      start: weekStart(w.week),
      plw: w.plw,
      lessons: w.lessons,
      workouts: w.workouts,
      correct,
      attempted,
      accuracy: accuracy(correct, attempted),
    });
  }
  return out.reverse();
}

// Worth asking for again: never asked, or not in the last few hours — the
// tracker reads ICN once a morning, so more often finds nothing new.
export const ICN_FRESH_MS = 3 * 60 * 60 * 1000;
export const icnStale = (stats, now = Date.now()) => !stats?.fetchedAt || now - stats.fetchedAt > ICN_FRESH_MS;
