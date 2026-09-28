// What a US Chess rating will be after an event, worked out the way US Chess
// rates one: Glickman & Doan, "The US Chess Rating System", April 6, 2026 —
// the version in force (new.uschess.org/sites/default/files/media/documents/
// us_chess_rating_system_specs-2026-04-06.pdf). Older copies still say the
// bonus multiplier is 14; it has been 10 since January 2025. Pure.
//
// US Chess rates a whole section at once. Everyone's new rating is worked
// out twice: first against the opponents' ratings going into the event,
// then again against the opponents' *first-pass* results — so an opponent
// who had a great weekend counts as stronger than their old rating said.
// That second pass is why a lone player's figures can't reproduce US Chess
// exactly: it needs every opponent's own results.
//
// So there are two ways in:
//   · estimateRating — one player, the opponents' ratings as typed in. One
//     pass, so it's an estimate. Given the ratings the opponents went in
//     with, it was a median 11 points from US Chess (90% within 36) on
//     seven 2026 sections, mostly young players who improve fast — the
//     second pass is what it can't see. Given their ratings after the
//     event instead: a median 3.4 (90% within 15).
//   · rateSection — a whole crosstable (the standings rows the US Chess API
//     returns), all five steps. On the same sections it matched US Chess to
//     the hundredth wherever every player came in with a rating; an unrated
//     player's unpublished starting rating moves the others a little
//     (under a point, mostly), and personal floors it isn't given it can't
//     apply.
//
// Checked against all 319 player-system results in those sections;
// tests/uscfEstimate.test.mjs carries two of them whole.

// ---------- The constants US Chess uses ----------

// B in the bonus formula: 14 from June 2017, 12 from February 2023, 10 for
// events from January 1, 2025.
export const BONUS_MULTIPLIER = 10;
// No rating goes below 100, whatever happens.
export const ABSOLUTE_FLOOR = 100;
// The "special" formula (few games, or a one-sided record) stops here.
export const SPECIAL_CAP = 2700;
// The personal floor a new player earns from wins and draws tops out here.
export const ABSOLUTE_FLOOR_CAP = 150;

// How close to zero counts as zero when solving the special formula.
const EPS = 1e-7;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------- The pieces of the formula ----------

// How many games' worth of trust a rating carries. A rating is only as
// settled as its level allows: US Chess treats a 600 as worth about 8 games
// however many were played (young players' ratings move fast), a 1700 as
// about 20, and anything over 2355 as 50.
export function effectiveCap(rating) {
  if (rating > 2355) return 50;
  return 50 / Math.sqrt(0.662 + 0.00000739 * (2569 - rating) ** 2);
}

// N′: the games a rating is based on, or the cap above if that's smaller.
// Unknown (null) means "plenty" — an established player, where only the cap
// matters.
export function effectiveGames(rating, games = null) {
  const cap = effectiveCap(rating);
  if (games == null || !finite(games)) return cap;
  return Math.max(0, Math.min(games, cap));
}

// The chance-weighted score a player rated R expects against one rated Ri —
// the usual logistic curve (a 200-point edge is worth about 0.76).
export const winExpectancy = (R, Ri) => 1 / (1 + 10 ** (-(R - Ri) / 400));

// The straight-line version the special formula uses: an even game at equal
// ratings, a sure thing 400 points apart.
export function provisionalExpectancy(R, Ri) {
  if (R <= Ri - 400) return 0;
  if (R >= Ri + 400) return 1;
  return 0.5 + (R - Ri) / 800;
}

// K: how far one game's surprise moves the rating. Fewer effective games,
// bigger swings. The Regular side of a dual-rated event (mm+ss 30–65) uses a
// smaller K above 2200 so faster games don't move a master's rating as much.
export function kFactor(effective, m, { rating = null, dualRegular = false } = {}) {
  if (dualRegular && rating != null && rating > 2200) {
    return rating < 2500 ? (800 * (6.5 - 0.0025 * rating)) / (effective + m) : 200 / (effective + m);
  }
  return 800 / (effective + m);
}

// The bonus is for a real event, not a match: at least 3 games, and no
// opponent met more than twice (or, over just 3 games, more than once).
// `ids` names each game's opponent where known (null for "someone else").
export function bonusEligible(m, ids = []) {
  if (m < 3) return false;
  const seen = new Map();
  for (const id of ids) if (id != null && id !== '') seen.set(id, (seen.get(id) ?? 0) + 1);
  const most = Math.max(1, ...seen.values());
  return m === 3 ? most <= 1 : most <= 2;
}

// The "standard" formula, for ratings based on more than 8 games: move by K
// times (score − expected), plus a bonus for a result well beyond what was
// expected. Over 3 rounds the bonus threshold is worked out as if there were
// 4, so a short event doesn't get one too easily.
export function standardRating({ rating, effective, opps, score, eligible = false, dualRegular = false }) {
  const m = opps.length;
  const K = kFactor(effective, m, { rating, dualRegular });
  const expected = opps.reduce((t, r) => t + winExpectancy(rating, r), 0);
  const gain = K * (score - expected);
  const bonus = eligible ? Math.max(0, gain - BONUS_MULTIPLIER * Math.sqrt(Math.max(m, 4))) : 0;
  return { rating: rating + gain + bonus, K, expected, bonus };
}

// The "special" formula, for ratings based on 8 or fewer games (and for
// players whose every earlier game was a win, or every one a loss): the
// rating at which the score would have been exactly what the straight-line
// expectancy predicts — with the old rating counted as `effective` games
// drawn against a player of that rating, so it pulls the answer toward it.
//
// `previous` is 'wins' or 'losses' when every earlier rated game went one
// way: the old rating then says only "at least" (or "at most") that much,
// so it's pushed 400 points the other way and those games counted as won.
//
// The function being zeroed is piecewise-straight and never decreasing, so
// this walks from knot to knot the way the spec lays out, then settles ties
// (a flat stretch where any rating fits) as close to the old rating as the
// stretch allows. Not clamped at 100 here — the caller does that.
export function specialRating({ rating, effective, opps, score, previous = null }) {
  let anchor = rating;
  let target = score + effective / 2;
  if (previous === 'wins') { anchor = rating - 400; target = score + effective; }
  else if (previous === 'losses') { anchor = rating + 400; target = score; }
  const f = (R) => effective * provisionalExpectancy(R, anchor)
    + opps.reduce((t, r) => t + provisionalExpectancy(R, r), 0) - target;
  const knots = [...new Set([anchor - 400, anchor + 400, ...opps.flatMap((r) => [r - 400, r + 400])])]
    .sort((a, b) => a - b);
  const below = (M) => { let z = null; for (const k of knots) if (k < M) z = k; return z; };
  const above = (M) => knots.find((k) => k > M) ?? null;

  // The spec starts at the (adjusted) old rating, not at its faster guess —
  // that guess can land on the wrong answer when there are no prior games.
  let M = anchor;
  for (let i = 0; i < 500; i += 1) {
    const fM = f(M);
    if (fM > EPS) {
      const za = below(M);
      if (za == null) break;
      const fa = f(za);
      if (Math.abs(fM - fa) < EPS) { M = za; continue; }
      const next = M - (fM * (M - za)) / (fM - fa);
      M = next < za ? za : next;
    } else if (fM < -EPS) {
      const zb = above(M);
      if (zb == null) break;
      const fb = f(zb);
      if (Math.abs(fb - fM) < EPS) { M = zb; continue; }
      const next = M - (fM * (zb - M)) / (fb - fM);
      M = next > zb ? zb : next;
    } else break;
  }
  // On a flat stretch — no opponent (nor the old rating) within 400 — any
  // rating there fits the score equally well: take the old rating if it's
  // on the stretch, else the end nearest it.
  const near = opps.filter((r) => Math.abs(M - r) <= 400).length + (Math.abs(M - anchor) <= 400 ? 1 : 0);
  if (near === 0) {
    const za = below(M) ?? -Infinity;
    const zb = above(M) ?? Infinity;
    if (rating >= za && rating <= zb) M = rating;
    else M = rating < za ? za : zb;
  }
  return Math.min(M, SPECIAL_CAP);
}

// What these games alone say the player is worth: the special formula with
// no prior games — what US Chess would make of them as a brand-new player.
// `anchor` settles a perfect (or empty) score, which fits any rating past a
// point: the answer is the nearest such rating to it.
export function performanceRating(opps, score, anchor = null) {
  if (!opps.length) return null;
  const start = anchor ?? opps.reduce((t, r) => t + r, 0) / opps.length;
  return Math.max(ABSOLUTE_FLOOR, specialRating({ rating: start, effective: 0, opps, score }));
}

// ---------- Floors ----------

// A new player's personal floor (over-the-board systems only): 100, plus 4
// for every rated win, 2 for every draw and 1 for every event with at least
// 3 rated games, up to 150.
export function absoluteFloor({ wins = 0, draws = 0, events = 0 } = {}) {
  return Math.min(ABSOLUTE_FLOOR_CAP, ABSOLUTE_FLOOR + 4 * wins + 2 * draws + events);
}

// An established player's floor: 200 below their best established rating,
// down to a round hundred, from 1200 to 2100. Below 1200 it's the absolute
// floor instead (null here).
export function establishedFloor(peak) {
  if (!finite(peak)) return null;
  const level = Math.floor((Math.round(peak) - 200) / 100) * 100;
  return level >= 1200 ? Math.min(level, 2100) : null;
}

// The floor that holds after this event. A floor under 150 is the absolute
// floor, which this event's own wins, draws and (at 3+ games) the event
// itself raise before it's applied; anything higher is a fixed level.
export function floorAfter(floor, { wins = 0, draws = 0, games = 0 } = {}) {
  if (!finite(floor)) return ABSOLUTE_FLOOR;
  if (floor < ABSOLUTE_FLOOR_CAP) {
    return Math.min(ABSOLUTE_FLOOR_CAP, Math.max(ABSOLUTE_FLOOR, floor) + 4 * wins + 2 * draws + (games >= 3 ? 1 : 0));
  }
  return floor;
}

// ---------- Starting ratings for unrated players ----------

// With no rating anywhere, US Chess starts a player at 50 × their age (10
// years old: 500), between 100 and 1300. With no birth date: 1300 for an
// adult, 750 otherwise. A first event is rated as if there were no prior
// games, but the start still counts for something: it's the rating the
// player's opponents are first measured against, which moves theirs — and,
// through them, this player's (by several points, in the data checked).
export function ageRating(age = null, { adult = false } = {}) {
  if (!finite(age) || age < 3) return adult ? 1300 : 750;
  return Math.round(Math.min(1300, Math.max(ABSOLUTE_FLOOR, 50 * age)));
}

// A FIDE rating on the US Chess scale (since March 2024), for starting a
// player who has one.
export const fideToUscf = (fide) => (fide <= 2000 ? -1073 + 1.5667 * fide : 20 + 1.02 * fide);

// ---------- One player's estimate ----------

const SCORE = { W: 1, D: 0.5, L: 0, 1: 1, 0.5: 0.5, 0: 0 };
const scoreOf = (s) => SCORE[typeof s === 'string' ? s.toUpperCase() : s] ?? null;

// Why an estimate couldn't be made, in words a screen can show.
export const REASONS = {
  'no-rating': 'Needs a rating going into the event.',
  'no-games': 'Add at least one game.',
  'no-rated-opponents': 'Every game was against an unrated player, so there is nothing to rate against.',
};

// One rating update — shared by the one-player estimate and by the section's
// steps 4 and 5. `games` is N (null for "established"), and the result is
// held at 100 but no other floor.
function rateOne({ rating, games, opps, score, eligible, previous, dualRegular }) {
  const effective = effectiveGames(rating, games);
  const expected = opps.reduce((t, r) => t + winExpectancy(rating, r), 0);
  // The special formula is chosen by the games actually played (N ≤ 8),
  // not by the effective count — a 500-rated player with 20 games has an
  // effective count near 8 but is rated with the standard formula.
  if ((games != null && games <= 8) || previous === 'wins' || previous === 'losses') {
    const r = specialRating({ rating, effective, opps, score, previous });
    return {
      method: 'special', effective, rating: Math.max(ABSOLUTE_FLOOR, r), K: null, bonus: null, expected,
    };
  }
  const s = standardRating({ rating, effective, opps, score, eligible, dualRegular });
  return {
    method: 'standard', effective, rating: Math.max(ABSOLUTE_FLOOR, s.rating), K: s.K, bonus: s.bonus, expected,
  };
}

// estimateRating({ rating, games, floor, results }):
//   rating    the rating going into the event (the decimal one if known —
//             US Chess keeps 634.81, not 635)
//   games     rated games played before it (null if unknown: treated as
//             established; 0 with a starting guess for a first event)
//   floor     the player's floor (null: just the 100 everyone has — or,
//             for a first event, 100 plus what this event earns)
//   results   [{ opp, score, id? }] — the opponent's rating (null for an
//             unrated opponent, whose game is left out and counted in
//             `skipped`), and 1 / 0.5 / 0 (or 'W' / 'D' / 'L'). `id` names
//             the opponent, so meeting someone twice can be spotted.
//   bonus     false for a match, where there is never a bonus
//   previous  'wins' / 'losses' if every earlier rated game went that way
//   dualRegular  the Regular side of a dual-rated event
//   online    an online event — no over-the-board floor credit
// Only played games count: byes, forfeits and unplayed rounds aren't rated,
// so leave them out.
//
// The opponents' ratings after the event give a closer answer than the ones
// they went in with, where they're known (see the top of the file).
//
// Returns { post, exact, change, method, K, bonus, bonusEligible, expected,
// score, games, skipped, performance, effective, floor, floored } — `post`
// rounded as US Chess shows it (from the full-precision figure, not the
// two-decimal one), `change` against the rating going in (null for a first
// event) — or { post: null, reason, message } when there's nothing to rate.
export function estimateRating({
  rating, games: gamesIn = null, floor = null, results = [], bonus = true, previous: previousIn = null,
  dualRegular = false, online = false,
} = {}) {
  let skipped = 0;
  const opps = [];
  const ids = [];
  let score = 0; let wins = 0; let draws = 0; let played = 0;
  for (const r of results ?? []) {
    const s = scoreOf(r?.score);
    if (s == null) continue; // not a played game
    // A game against an unrated opponent is still a rated game: it earns
    // floor credit, though it can't be scored here (US Chess rates that
    // opponent first).
    played += 1;
    if (s === 1) wins += 1;
    if (s === 0.5) draws += 1;
    if (!finite(r.opp) || r.opp <= 0) { skipped += 1; continue; }
    opps.push(r.opp);
    ids.push(r.id ?? null);
    score += s;
  }
  const fail = (reason) => ({ post: null, exact: null, reason, message: REASONS[reason], skipped });
  if (!finite(rating) || rating <= 0) return fail('no-rating');
  if (!opps.length) return fail(skipped ? 'no-rated-opponents' : 'no-games');
  const games = finite(gamesIn) && gamesIn >= 0 ? gamesIn : null;
  // A one-sided record only means something for someone who has played.
  const previous = games === 0 ? null : previousIn;

  const m = opps.length;
  const eligible = Boolean(bonus) && bonusEligible(m, ids);
  const one = rateOne({
    rating, games, opps, score, eligible, previous, dualRegular,
  });
  // The floor: the player's own (100 if none given), raised over the board
  // by what this event earns — always a true lower bound, since US Chess's
  // floor counts the event's wins and draws.
  const first = games === 0;
  const given = finite(floor) ? floor : ABSOLUTE_FLOOR;
  const personal = online
    ? Math.max(ABSOLUTE_FLOOR, given)
    : floorAfter(given, { wins, draws, games: played });
  const exact = Math.max(one.rating, personal);
  const post = Math.round(exact);
  return {
    post,
    exact,
    // A first event's "rating going in" is only a starting guess.
    change: first ? null : post - Math.round(rating),
    method: one.method,
    K: one.K,
    bonus: one.bonus,
    bonusEligible: one.method === 'standard' ? eligible : false,
    expected: one.expected,
    score,
    games: m,
    skipped,
    performance: Math.round(performanceRating(opps, score, rating)),
    effective: one.effective,
    floor: personal,
    floored: one.rating < personal,
    reason: null,
  };
}

// ---------- A whole section ----------

const GAME_SCORE = { win: 1, draw: 0.5, loss: 0 };

// The rating a standings row carries into the event in one system — the
// decimal where US Chess gives one — or null for a player who had none.
function preRatingOf(entry) {
  if (!entry) return null;
  const dec = entry.preRatingDecimal;
  if (finite(dec) && dec > 0) return dec;
  const whole = Number(entry.preRating);
  return Number.isFinite(whole) && whole > 0 ? whole : null;
}

// rateSection(items, options): every player's new rating, the way US Chess
// computes the section — steps 1 to 5 of the spec.
//   items   the rows of /rated-events/{id}/sections/{n}/standings (each with
//           playerId, memberId, ratings[], roundOutcomes[])
//   system  'R', 'Q', 'B', … — a dual-rated section is rated twice, once
//           per system, each against that system's ratings
//   dualRegular  the Regular side of a dual-rated section
//   starts  { [memberId]: { rating, games } } for unrated players, from
//           another system or their age (ageRating); anyone without one
//           starts at `defaultStart` with no games
//   floors  { [memberId]: floor } — applied at the end; an unrated player's
//           absolute floor (100 plus this event's credit) is applied anyway
//   previous  { [memberId]: 'wins' | 'losses' }
// Returns { [playerId]: { memberId, pre, games, played, score, method, K,
// bonus, expected, step3, step4, rating, exact, post, floor, floored } }:
// `rating` is step 5 before personal floors, `exact` after them.
//
// The number of games before the event comes from the row: a provisional
// player's post-event count less this event's games; an established player
// (no count shown) is treated as having plenty, which only the effective
// cap then limits.
export function rateSection(items, {
  system = 'R', dualRegular = false, starts = {}, defaultStart = 750, floors = {}, previous = {},
} = {}) {
  const players = new Map();
  for (const row of items ?? []) {
    if (!row?.playerId) continue;
    const entry = (row.ratings ?? []).find((x) => x.ratingSystem === system) ?? null;
    const played = [];
    for (const o of row.roundOutcomes ?? []) {
      // Byes, forfeits and unplayed rounds aren't games: nobody moved.
      const s = GAME_SCORE[String(o.outcome ?? '').toLowerCase()];
      if (s == null || !o.opponentPlayerId) continue;
      played.push({ opp: o.opponentPlayerId, score: s });
    }
    const memberId = String(row.memberId ?? '');
    const pre = preRatingOf(entry);
    const m = played.length;
    let start; let games;
    if (pre != null) {
      start = pre;
      const after = Number(entry.postProvisionalGameCount);
      games = entry.postProvisionalGameCount != null && Number.isFinite(after) ? Math.max(0, after - m) : null;
    } else {
      const given = starts[memberId] ?? starts[row.playerId];
      start = finite(given?.rating) ? given.rating : defaultStart;
      games = finite(given?.games) ? given.games : 0;
    }
    players.set(row.playerId, {
      playerId: row.playerId, memberId, pre, start, games, played,
      score: played.reduce((t, g) => t + g.score, 0),
      previous: previous[memberId] ?? null,
    });
  }

  // Step 3: a first rough rating for each newcomer with nothing to go on,
  // counting their starting guess as a single game — only so their
  // opponents have something to be rated against.
  const step3 = new Map();
  for (const p of players.values()) {
    if (p.pre != null || p.games !== 0 || !p.played.length) continue;
    const opps = p.played.map((g) => players.get(g.opp)?.start ?? defaultStart);
    step3.set(p.playerId, Math.max(ABSOLUTE_FLOOR, specialRating({
      rating: p.start, effective: 1, opps, score: p.score,
    })));
  }
  const firstLook = (id) => {
    const q = players.get(id);
    if (!q) return defaultStart;
    return step3.get(id) ?? q.start;
  };

  const rate = (p, oppRating) => rateOne({
    rating: p.start,
    games: p.games,
    opps: p.played.map((g) => oppRating(g.opp)),
    score: p.score,
    eligible: bonusEligible(p.played.length, p.played.map((g) => g.opp)),
    previous: p.previous,
    dualRegular,
  });

  // Step 4 against the ratings everyone brought; step 5 again, against
  // everyone's step-4 result.
  const step4 = new Map();
  for (const p of players.values()) step4.set(p.playerId, p.played.length ? rate(p, firstLook).rating : p.start);
  const otb = !String(system).startsWith('O');
  const out = {};
  for (const p of players.values()) {
    const five = p.played.length ? rate(p, (id) => step4.get(id) ?? firstLook(id)) : null;
    const rating = five ? five.rating : p.start;
    const wins = p.played.filter((g) => g.score === 1).length;
    const draws = p.played.filter((g) => g.score === 0.5).length;
    const given = floors[p.memberId];
    let floor = ABSOLUTE_FLOOR;
    if (finite(given)) floor = otb ? floorAfter(given, { wins, draws, games: p.played.length }) : Math.max(ABSOLUTE_FLOOR, given);
    else if (otb) floor = floorAfter(ABSOLUTE_FLOOR, { wins, draws, games: p.played.length });
    const exact = Math.max(rating, floor);
    out[p.playerId] = {
      memberId: p.memberId,
      pre: p.pre,
      start: p.start,
      games: p.games,
      played: p.played.length,
      score: p.score,
      method: five?.method ?? null,
      K: five?.K ?? null,
      bonus: five?.bonus ?? null,
      expected: five?.expected ?? null,
      step3: step3.get(p.playerId) ?? null,
      step4: step4.get(p.playerId),
      rating,
      exact,
      post: Math.round(exact),
      floor,
      floored: rating < floor,
    };
  }
  return out;
}
