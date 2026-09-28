// What a member's rated games say, worked out from their history and the
// crosstables of their sections (lib/uscfHistory.js). Pure.
//
// Everything here is an estimate from public figures: an expected score
// from the ratings both players brought to the event, a "performance" from
// how they scored against the field they met. US Chess's own formula has
// more in it (bonuses, K-factors, provisional rules), so these are labelled
// estimates wherever they're shown.

import { PLAYED, POINTS, mainSystem } from './uscfHistory';

// The chance-weighted score one player expects against another.
export const expectedScore = (mine, theirs) => 1 / (1 + 10 ** ((theirs - mine) / 400));

// Every game played (not a bye, not a forfeit) in the loaded sections, oldest
// first: { key, eventName, date, round, result, color, oppId, oppName,
// oppPre, myPre, gap, expected, timeClass }.
export function ratedGames(history, standings) {
  const out = [];
  const sections = [...(history?.sections ?? [])].reverse();
  for (const s of sections) {
    const st = standings?.[s.key];
    if (!st) continue;
    const sys = mainSystem(s);
    const myPre = s.records[sys]?.pre ?? st.pre ?? null;
    for (const r of st.rounds) {
      if (!PLAYED.has(r.result)) continue;
      const known = myPre != null && r.oppPre != null;
      out.push({
        key: s.key,
        eventId: s.eventId,
        section: s.section,
        eventName: s.eventName,
        date: s.end,
        round: r.round,
        result: r.result,
        score: POINTS[r.result],
        color: r.color,
        oppId: r.oppId,
        oppName: r.oppName,
        oppLast: r.oppLast,
        oppPre: r.oppPre,
        myPre,
        gap: known ? r.oppPre - myPre : null,
        expected: known ? expectedScore(myPre, r.oppPre) : null,
        timeClass: timeClass(st.timeControl),
      });
    }
  }
  return out;
}

// A section's own numbers: score over games played, the score expected from
// the ratings, and a performance estimate — the average opponent, plus 400
// for every win beyond the losses per game (the "linear" performance rating;
// capped at ±400 of the average for a perfect or empty score).
export function sectionSummary(section, standing) {
  if (!standing) return null;
  const played = standing.rounds.filter((r) => PLAYED.has(r.result));
  const points = standing.rounds.reduce((t, r) => t + (POINTS[r.result] ?? 0), 0);
  const playedPoints = played.reduce((t, r) => t + POINTS[r.result], 0);
  const sys = mainSystem(section);
  const myPre = section.records[sys]?.pre ?? standing.pre ?? null;
  const rated = played.filter((r) => r.oppPre != null);
  const avgOpp = rated.length ? rated.reduce((t, r) => t + r.oppPre, 0) / rated.length : null;
  const expected = myPre != null && rated.length
    ? rated.reduce((t, r) => t + expectedScore(myPre, r.oppPre), 0) : null;
  const ratedPoints = rated.reduce((t, r) => t + POINTS[r.result], 0);
  const wins = rated.filter((r) => r.result === 'W').length;
  const losses = rated.filter((r) => r.result === 'L').length;
  const performance = avgOpp != null && rated.length
    ? Math.round(avgOpp + Math.max(-400, Math.min(400, (400 * (wins - losses)) / rated.length)))
    : null;
  return {
    // US Chess's own score when it gave one (byes and forfeits as it counts
    // them), else worked out here.
    points: standing.score ?? points,
    games: played.length,
    playedPoints,
    byes: standing.rounds.filter((r) => r.result === 'BF' || r.result === 'BH').length,
    forfeits: standing.rounds.filter((r) => r.result === 'FW' || r.result === 'FL').length,
    avgOpp: avgOpp != null ? Math.round(avgOpp) : null,
    expected,
    ratedPoints,
    // Scored more (or less) than the ratings said they would, in the games
    // where both ratings were known.
    overExpected: expected != null ? ratedPoints - expected : null,
    performance,
  };
}

// Time controls as US Chess writes them: "G/25;d5", "40/80,SD/30;d30",
// "G/60+30", "G/90;inc30". What's given for the whole game, per player —
// the classes a coach talks in.
export function timeClass(tc) {
  const text = String(tc ?? '');
  if (!text) return null;
  const first = text.match(/(\d+)\s*\/\s*(\d+)/); // moves/minutes
  const g = text.match(/(?:G|SD)\s*\/\s*(\d+)/i);
  let minutes = null;
  if (first && !/^\s*(G|SD)/i.test(text)) minutes = Number(first[2]);
  else if (g) minutes = Number(g[1]);
  const inc = text.match(/(?:inc|\+)\s*(\d+)|d\s*(\d+)/i);
  const extra = inc ? Number(inc[1] ?? inc[2] ?? 0) : 0;
  if (minutes == null) return null;
  // An increment or delay adds about a minute per second over 60 moves.
  const total = minutes + extra;
  if (total < 10) return 'blitz';
  if (total < 30) return 'quick';
  if (total < 60) return 'rapid';
  return 'classical';
}
export const TIME_CLASS_LABEL = {
  blitz: 'Blitz <10′', quick: 'Quick 10–29′', rapid: 'Rapid 30–59′', classical: 'Classical 60′+',
};

// `expected` and `ratedPoints` cover the same games — those where both
// ratings were known — so one can be held against the other.
const tally = (games) => {
  const t = {
    games: games.length, W: 0, D: 0, L: 0, points: 0, expected: 0, ratedPoints: 0, rated: 0,
  };
  for (const g of games) {
    t[g.result] += 1;
    t.points += g.score;
    if (g.expected != null) { t.expected += g.expected; t.ratedPoints += g.score; t.rated += 1; }
  }
  t.pct = t.games ? t.points / t.games : null;
  return t;
};

// Results split the ways a coach looks at them.
// (The opponent's rating against the player's, both going into the event.)
export const GAP_BANDS = [
  { id: 'up200', label: '200+ higher', test: (g) => g >= 200 },
  { id: 'up', label: '1–199 higher', test: (g) => g > 0 && g < 200 },
  { id: 'down', label: '0–199 lower', test: (g) => g <= 0 && g > -200 },
  { id: 'down200', label: '200+ lower', test: (g) => g <= -200 },
];

export function splits(games) {
  const byGap = GAP_BANDS.map((b) => ({ ...b, ...tally(games.filter((g) => g.gap != null && b.test(g.gap))) }));
  // Games against unrated opponents (not ones from before the player had a
  // rating of their own, which have no gap either).
  const unrated = tally(games.filter((g) => g.oppPre == null));
  const beforeRated = tally(games.filter((g) => g.myPre == null && g.oppPre != null));
  const byColor = ['white', 'black'].map((c) => ({ id: c, label: c === 'white' ? 'White' : 'Black', ...tally(games.filter((g) => g.color === c)) }));
  const byTime = ['classical', 'rapid', 'quick', 'blitz']
    .map((c) => ({ id: c, label: TIME_CLASS_LABEL[c], ...tally(games.filter((g) => g.timeClass === c)) }))
    .filter((t) => t.games > 0);
  const years = [...new Set(games.map((g) => String(g.date ?? '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const byYear = years.map((y) => ({ id: y, label: y, ...tally(games.filter((g) => String(g.date ?? '').startsWith(y))) }));
  return {
    all: tally(games), byGap, unrated, beforeRated, byColor, byTime, byYear,
  };
}

// Form: the last `n` results, the current run, the longest winning and
// losing runs, and how often a loss was followed by a win.
export function form(games, n = 10) {
  const last = games.slice(-n);
  let current = null;
  for (let i = games.length - 1; i >= 0; i -= 1) {
    const r = games[i].result;
    if (!current) current = { result: r, length: 1 };
    else if (r === current.result) current.length += 1;
    else break;
  }
  let best = 0; let worst = 0; let runW = 0; let runL = 0;
  let afterLoss = 0; let bounce = 0;
  games.forEach((g, i) => {
    runW = g.result === 'W' ? runW + 1 : 0;
    runL = g.result === 'L' ? runL + 1 : 0;
    best = Math.max(best, runW);
    worst = Math.max(worst, runL);
    if (i > 0 && games[i - 1].result === 'L') {
      afterLoss += 1;
      if (g.result === 'W') bounce += 1;
    }
  });
  return {
    last, current, longestWin: best, longestLoss: worst,
    bounceBack: afterLoss ? { wins: bounce, of: afterLoss } : null,
  };
}

// The standout results: the biggest wins against stronger players, and the
// losses to weaker ones that cost the most.
export function highlights(games, n = 3) {
  const upsets = games.filter((g) => g.result === 'W' && g.gap != null && g.gap > 0)
    .sort((a, b) => b.gap - a.gap).slice(0, n);
  const traps = games.filter((g) => g.result === 'L' && g.gap != null && g.gap < 0)
    .sort((a, b) => a.gap - b.gap).slice(0, n);
  const bestWin = games.filter((g) => g.result === 'W' && g.oppPre != null)
    .sort((a, b) => b.oppPre - a.oppPre)[0] ?? null;
  return { upsets, traps, bestWin };
}

// Opponents met more than once, most-played first: { id, name, games, W, D, L }.
export function opponents(games) {
  const by = new Map();
  for (const g of games) {
    const id = g.oppId || g.oppName;
    if (!id) continue;
    const o = by.get(id) ?? { id, name: g.oppName, games: 0, W: 0, D: 0, L: 0, last: g.oppPre };
    o.games += 1;
    o[g.result] += 1;
    o.last = g.oppPre ?? o.last;
    by.set(id, o);
  }
  return [...by.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
}
