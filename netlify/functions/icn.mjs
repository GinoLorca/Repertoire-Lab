// /.netlify/functions/icn?school=ps11&name=Parker%20Downing — one student's
// ChessKid practice (PLW, lessons, workouts, puzzles) from their school's ICN
// stats page; /.netlify/functions/icn?find=Parker%20Downing — which school
// pages list them.
//
// The Chess Club Tracker publishes each school's page as it read it that
// morning (see src/lib/icn.js); this reads that file and answers with the
// one student asked about — never the rest of the class. ICN_TRACKER_URL
// (Netlify → Site settings → Environment variables) points it somewhere
// else if the tracker ever moves.
import {
  ICN_SCHOOLS, ICN_TRACKER, isIcnSchool, matchesIn, studentStats, suggestions,
} from '../../src/lib/icn.js';

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...extra },
});

async function schoolFile(base, school) {
  const res = await fetch(`${base}/data/icn/${school}.json`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`the Chess Club Tracker answered ${res.status}`);
  return res.json();
}

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const base = (process.env.ICN_TRACKER_URL || ICN_TRACKER).replace(/\/+$/, '');
  const find = (q.get('find') ?? '').trim().slice(0, 80);
  const school = (q.get('school') ?? '').trim();
  const name = (q.get('name') ?? '').trim().slice(0, 80);
  try {
    if (find) {
      // Every school's page, for whoever has this name: school, name, grade.
      const found = await Promise.all(ICN_SCHOOLS.map(async (s) => {
        try {
          return matchesIn(await schoolFile(base, s.id), find).map((m) => ({ ...m, school: s.id }));
        } catch {
          return [];
        }
      }));
      return json({ matches: found.flat() }, 200, { 'cache-control': 'public, max-age=1800' });
    }
    if (!isIcnSchool(school)) return json({ error: 'Pick the student’s ICN school.' }, 400);
    if (!name) return json({ error: 'Type the student’s name as ICN lists it.' }, 400);
    const file = await schoolFile(base, school);
    const stats = studentStats(file, name, school);
    if (!stats) {
      return json({ error: `${name} isn’t on that school’s ICN page.`, suggestions: suggestions(file, name) }, 404);
    }
    // Half an hour: the tracker reads ICN once a morning.
    return json(stats, 200, { 'cache-control': 'public, max-age=1800' });
  } catch (err) {
    return json({ error: `Couldn’t read the ICN numbers — ${err.message}.` }, 502);
  }
};
