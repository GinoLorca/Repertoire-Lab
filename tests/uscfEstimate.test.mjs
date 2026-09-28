// The rating estimator (lib/uscfEstimate.js): each piece of US Chess's
// formula against the worked figures in its spec (Glickman & Doan, April 6,
// 2026), then the whole thing against two real rated sections — what US
// Chess actually published, to the hundredth. Fixtures follow the standings
// API's shape (names left out).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveCap, effectiveGames, winExpectancy, provisionalExpectancy, kFactor, bonusEligible,
  standardRating, specialRating, performanceRating, absoluteFloor, establishedFloor, floorAfter,
  ageRating, fideToUscf, estimateRating, rateSection, BONUS_MULTIPLIER, REASONS,
} from '../src/lib/uscfEstimate.js';

const near = (actual, expected, tol, what = '') => assert.ok(
  Math.abs(actual - expected) <= tol,
  `${what} ${actual} should be within ${tol} of ${expected}`,
);

// ---------- The pieces ----------

test('effective games: capped by the rating, 20 at 1700, 50 over 2355', () => {
  near(effectiveCap(1700), 20.0, 0.02, 'spec example');
  assert.equal(effectiveCap(2400), 50);
  near(effectiveCap(554.22), 9.0298, 0.0001);
  // Low ratings are worth few games whatever was played.
  assert.ok(effectiveCap(500) < 9);
  near(effectiveGames(1700, 30), 20.0, 0.02);
  assert.equal(effectiveGames(1700, 12), 12);
  assert.equal(effectiveGames(1700, 0), 0);
  // Unknown count: an established player, so only the cap matters.
  assert.equal(effectiveGames(1700, null), effectiveCap(1700));
});

test('win expectancy: logistic for the standard formula, straight line for the special one', () => {
  assert.equal(winExpectancy(1500, 1500), 0.5);
  near(winExpectancy(1700, 1500), 0.7597, 0.0001);
  near(winExpectancy(1500, 1700) + winExpectancy(1700, 1500), 1, 1e-12);
  assert.equal(provisionalExpectancy(1500, 1500), 0.5);
  assert.equal(provisionalExpectancy(1700, 1500), 0.75);
  assert.equal(provisionalExpectancy(1100, 1500), 0);
  assert.equal(provisionalExpectancy(1950, 1500), 1);
});

test('K: 800 / (N′ + m), smaller above 2200 on the Regular side of a dual-rated event', () => {
  // The spec's table.
  assert.equal(kFactor(6, 4), 80);
  near(kFactor(20, 6), 30.77, 0.005);
  near(kFactor(50, 10), 13.33, 0.005);
  near(kFactor(20, 4, { rating: 2300, dualRegular: true }), (800 * (6.5 - 0.0025 * 2300)) / 24, 1e-9);
  assert.equal(kFactor(20, 4, { rating: 2550, dualRegular: true }), 200 / 24);
  // Not dual-rated, or not above 2200: the usual K.
  assert.equal(kFactor(20, 4, { rating: 2300 }), 800 / 24);
  assert.equal(kFactor(20, 4, { rating: 2100, dualRegular: true }), 800 / 24);
});

test('bonus: 3+ games, nobody met more than twice (over 3 games, more than once)', () => {
  assert.equal(bonusEligible(2), false);
  assert.equal(bonusEligible(3), true);
  assert.equal(bonusEligible(3, ['a', 'b', 'a']), false);
  assert.equal(bonusEligible(4, ['a', 'a', 'b', 'c']), true);
  assert.equal(bonusEligible(4, ['a', 'a', 'a', 'c']), false);
  assert.equal(bonusEligible(4, [null, null, null, null]), true);
  assert.equal(BONUS_MULTIPLIER, 10);
});

// The spec's own test figures: real players, with the opponents' ratings US
// Chess used for them (their first-pass results).
test('standard formula with the bonus — a 3–0, treated as 4 rounds for the threshold (member 32653994)', () => {
  const r = standardRating({
    rating: 554.22, effective: effectiveGames(554.22), opps: [499.22, 494.53, 142.69], score: 3, eligible: true,
  });
  near(r.K, 66.5013, 0.0001, 'K');
  near(r.expected, 2.0780, 0.0001, 'E');
  near(r.bonus, 41.3150, 0.001, 'bonus');
  near(r.rating, 656.85, 0.005, 'post'); // US Chess: 656.85
  // Without the bonus, only K(S − E).
  const plain = standardRating({
    rating: 554.22, effective: effectiveGames(554.22), opps: [499.22, 494.53, 142.69], score: 3,
  });
  assert.equal(plain.bonus, 0);
  near(plain.rating, 554.22 + r.K * (3 - r.expected), 1e-9);
});

test('standard formula without a bonus — 10 rounds, 6 points (member 32132991)', () => {
  const r = standardRating({
    rating: 787.25,
    effective: effectiveGames(787.25),
    opps: [694.62, 813.33, 590.87, 805.57, 599.78, 508.06, 816.01, 797.91, 658.29, 599.78],
    score: 6,
    eligible: true,
  });
  near(r.K, 39.6427, 0.0001, 'K');
  near(r.expected, 6.2689, 0.0001, 'E');
  assert.equal(r.bonus, 0);
  near(r.rating, 776.59, 0.005, 'post'); // US Chess: 776.59
});

test('special formula — 6 prior games, 1 point from 3 (member 33128229)', () => {
  const r = specialRating({ rating: 335.27, effective: effectiveGames(335.27, 6), opps: [364.67, 525.69, 100], score: 1 });
  near(r, 289.11, 0.005); // US Chess: 289.11
});

test('special formula: ties go to the nearest rating to the old one, and it stops at 2700', () => {
  // No prior games, four wins against 400s: anything from 800 up fits.
  assert.equal(specialRating({ rating: 500, effective: 0, opps: [400, 400, 400, 400], score: 4 }), 800);
  assert.equal(specialRating({ rating: 1000, effective: 0, opps: [400, 400, 400, 400], score: 4 }), 1000);
  // Four losses: anything up to 0 fits — the caller holds it at 100.
  assert.equal(specialRating({ rating: 750, effective: 0, opps: [400, 400, 400, 400], score: 0 }), 0);
  // A win never lowers it, a loss never raises it.
  assert.ok(specialRating({ rating: 1200, effective: 5, opps: [300], score: 1 }) >= 1200);
  assert.ok(specialRating({ rating: 600, effective: 5, opps: [1900], score: 0 }) <= 600);
  assert.equal(specialRating({ rating: 2650, effective: 4, opps: [2700, 2700, 2700, 2700], score: 4 }), 2700);
});

test('special formula after an all-wins or all-losses record', () => {
  // Every earlier game won: the old rating is only a lower bound, so
  // another win can't pull it down and a win against someone far stronger
  // lifts it further than a mixed record would.
  const mixed = specialRating({ rating: 1200, effective: 10, opps: [1500], score: 1 });
  const allWins = specialRating({ rating: 1200, effective: 10, opps: [1500], score: 1, previous: 'wins' });
  assert.ok(allWins >= 1200 && allWins > mixed);
  const allLosses = specialRating({ rating: 1200, effective: 10, opps: [900], score: 0, previous: 'losses' });
  assert.ok(allLosses <= 1200);
});

test('performance: the special formula with no prior games', () => {
  assert.equal(performanceRating([400, 500, 600], 1.5, 500), 500);
  assert.equal(performanceRating([400, 400, 400, 400], 4, 500), 800);
  assert.equal(performanceRating([400, 400], 0, 500), 100);
  assert.equal(performanceRating([], 0, 500), null);
});

test('floors', () => {
  assert.equal(absoluteFloor({ wins: 3, draws: 1, events: 10 }), 124); // the spec's example
  assert.equal(absoluteFloor({ wins: 20 }), 150);
  assert.equal(establishedFloor(1941), 1700);
  assert.equal(establishedFloor(1999.51), 1800);
  assert.equal(establishedFloor(1388), null);
  assert.equal(establishedFloor(2600), 2100);
  // An absolute floor grows with this event's wins, draws and (3+ games) the
  // event itself; a higher floor is fixed.
  assert.equal(floorAfter(114, { wins: 1, draws: 1, games: 4 }), 121);
  assert.equal(floorAfter(148, { wins: 2, games: 4 }), 150);
  assert.equal(floorAfter(100, { games: 2 }), 100);
  assert.equal(floorAfter(1500, { wins: 4, games: 4 }), 1500);
  assert.equal(floorAfter(null, { wins: 4, games: 4 }), 100);
});

test('starting ratings: 50 × age, 750 or 1300 without one; FIDE converted', () => {
  assert.equal(ageRating(10), 500);
  assert.equal(ageRating(6.3), 315);
  assert.equal(ageRating(30), 1300);
  assert.equal(ageRating(null), 750);
  assert.equal(ageRating(null, { adult: true }), 1300);
  assert.equal(ageRating(1), 750); // under 3 is taken as a typo
  near(fideToUscf(1500), 1277.05, 1e-9);
  near(fideToUscf(2200), 2264, 1e-9);
});

// ---------- One player ----------

const bonusCase = [{ opp: 499.22, score: 1 }, { opp: 494.53, score: 1 }, { opp: 142.69, score: 1 }];

test('estimateRating: the full answer', () => {
  const r = estimateRating({ rating: 554.22, games: null, results: bonusCase });
  assert.equal(r.post, 657);
  near(r.exact, 656.85, 0.005);
  assert.equal(r.change, 103);
  assert.equal(r.method, 'standard');
  assert.equal(r.bonusEligible, true);
  near(r.bonus, 41.315, 0.001);
  near(r.K, 66.5013, 0.0001);
  near(r.expected, 2.078, 0.001);
  assert.equal(r.score, 3);
  assert.equal(r.games, 3);
  assert.equal(r.skipped, 0);
  assert.equal(r.floored, false);
  assert.equal(r.reason, null);
  assert.equal(typeof r.performance, 'number');
});

test('estimateRating: no bonus in a match, or against the same player twice in 3 games', () => {
  const match = estimateRating({ rating: 554.22, results: bonusCase, bonus: false });
  assert.equal(match.bonus, 0);
  assert.equal(match.bonusEligible, false);
  const twice = estimateRating({
    rating: 554.22, results: bonusCase.map((g, i) => ({ ...g, id: i < 2 ? 'x' : 'y' })),
  });
  assert.equal(twice.bonusEligible, false);
  assert.ok(twice.exact < estimateRating({ rating: 554.22, results: bonusCase }).exact);
});

test('estimateRating: results as W/D/L, unrated opponents left out and counted', () => {
  const r = estimateRating({
    rating: 1500,
    results: [{ opp: 1500, score: 'W' }, { opp: 1500, score: 'd' }, { opp: null, score: 'L' }, { opp: 1600, score: 0 }],
  });
  assert.equal(r.games, 3);
  assert.equal(r.skipped, 1);
  assert.equal(r.score, 1.5);
});

test('estimateRating: the special formula by games played, not effective games', () => {
  // A 500 with 20 games has an effective count under 9 — still the standard formula.
  const results = [{ opp: 600, score: 1 }, { opp: 450, score: 0 }, { opp: 520, score: 1 }, { opp: 480, score: 0.5 }];
  assert.ok(effectiveGames(500, 20) < 9);
  assert.equal(estimateRating({ rating: 500, games: 20, results }).method, 'standard');
  assert.equal(estimateRating({ rating: 500, games: 8, results }).method, 'special');
  assert.equal(estimateRating({ rating: 500, games: 30, results, previous: 'losses' }).method, 'special');
});

test('estimateRating: floors — a first event earns its own; a set floor holds', () => {
  // 0 prior games, 3 rated losses: held at 100, then the floor that event
  // earns (100 + 1 for completing 3 games). US Chess: 101.
  const first = estimateRating({ rating: 406, games: 0, results: [{ opp: 590, score: 0 }, { opp: 475, score: 0 }, { opp: 289, score: 0 }] });
  assert.equal(first.post, 101);
  assert.equal(first.floored, true);
  assert.equal(first.change, null);
  const held = estimateRating({ rating: 1420, floor: 1400, results: [{ opp: 1800, score: 0 }, { opp: 1850, score: 0 }, { opp: 1400, score: 0 }] });
  assert.equal(held.post, 1400);
  assert.equal(held.floor, 1400);
});

test('estimateRating: says why when it cannot', () => {
  assert.deepEqual(
    [estimateRating({ rating: null, results: bonusCase }).reason, estimateRating({ rating: 900 }).reason,
      estimateRating({ rating: 900, results: [{ opp: null, score: 1 }] }).reason],
    ['no-rating', 'no-games', 'no-rated-opponents'],
  );
  const r = estimateRating({ rating: null, results: bonusCase });
  assert.equal(r.post, null);
  assert.equal(r.message, REASONS['no-rating']);
});

// ---------- Real sections ----------

// Two scholastic sections, dual-rated (Regular and Quick) — every row as US
// Chess published it: [memberId, rounds, R, Q], each system as [pre decimal,
// post decimal, post, games after (provisional only)]. Rounds are result +
// the opponent's row: W4 = beat row 4; BF/BH a bye, U unpaired, FW/FL a
// forfeit won or lost — none of those is a rated game.
const NOVICE = [ // 202608300103:5, G/25;d5, 3 rounds
  ['32653994', 'W4 W2 W6', [554.22, 656.85, 657, null], [546.49, 650.17, 650, null]],
  ['32515021', 'W5 L1 W4', [445.28, 500.21, 500, 24], [440.05, 494.78, 495, 24]],
  ['32899255', 'BH W6 L5', [124, 133.82, 134, null], [126, 135.12, 135, null]],
  ['32844935', 'L1 W5 L2', [572.53, 514.33, 514, null], [563.74, 506.08, 506, null]],
  ['33189649', 'L2 L4 W3', [174.54, 188.04, 188, 18], [173.33, 186.52, 187, 18]],
  ['33157571', 'BF L3 L1', [202.66, 148.72, 149, 19], [202.41, 148.46, 148, 19]],
];
const U600 = [ // 202608010253:6, G/30;d5, 4 rounds; 33207034 was unrated
  ['32653994', 'W8 W11 W2 W4', [437.54, 710.53, 711, null], [434.67, 702.17, 702, null]],
  ['32781134', 'W12 W13 L1 W10', [564.63, 590.96, 591, null], [560.78, 589.23, 589, null]],
  ['32570584', 'W10 L6 W13 W7', [405.74, 475.68, 476, null], [407.23, 474.46, 474, null]],
  ['32875841', 'W7 W5 W6 L1', [327.18, 545.57, 546, 20], [310.38, 534.5, 534, 20]],
  ['32494196', 'W14 L4 W8 D6', [667.16, 630.7, 631, null], [667.69, 629.69, 630, null]],
  ['33125056', 'BF W3 L4 D5', [207.83, 348.71, 349, 24], [205.82, 346.22, 346, 24]],
  ['32206749', 'L4 W12 W11 L3', [399.14, 399.4, 399, 24], [382.71, 385.15, 385, 24]],
  ['32619938', 'L1 W9 L5 W11', [553.7, 537.18, 537, 23], [552.38, 533.13, 533, 23]],
  ['33128229', 'L11 L8 FW14 W13', [335.27, 289.11, 289, 9], [335.27, 285.4, 285, 9]],
  ['33050774', 'L3 W14 W12 L2', [610.66, 556.95, 557, null], [627.19, 569.04, 569, null]],
  ['32781044', 'W9 L1 L7 L8', [427.48, 378.17, 378, null], [386.49, 346.56, 347, null]],
  ['32656114', 'L2 L7 L10 BF', [312.62, 256.84, 257, null], [314.03, 257.06, 257, 21]],
  ['33207034', 'FW L2 L3 L9', [null, 101, 101, 3], [null, 101, 101, 3]],
  ['32780990', 'L5 L10 FL9 U', [442.66, 396.94, 397, null], [432.73, 389.69, 390, null]],
];

const OUTCOME = {
  W: 'Win', L: 'Loss', D: 'Draw', BF: 'ByeFull', BH: 'ByeHalf', U: 'Unpaired', FW: 'WinForfeit', FL: 'Forfeit',
};
// The compact rows above, back in the API's shape.
function standings(rows) {
  return rows.map(([memberId, rounds, R, Q], i) => ({
    playerId: `p${i + 1}`,
    memberId,
    ratings: [['R', R], ['Q', Q]].map(([system, [pre, postDecimal, post, count]]) => ({
      ratingSystem: system,
      ...(pre != null ? { preRating: Math.round(pre), preRatingDecimal: pre } : {}),
      postRating: post,
      postRatingDecimal: postDecimal,
      ...(count != null ? { postProvisionalGameCount: count } : {}),
    })),
    roundOutcomes: rounds.split(' ').map((code, n) => {
      const [, kind, opp] = code.match(/^([A-Z]+)(\d*)$/);
      return { roundNumber: n + 1, outcome: OUTCOME[kind], opponentPlayerId: opp ? `p${opp}` : '' };
    }),
  }));
}
const entry = (row, system) => row.ratings.find((x) => x.ratingSystem === system);
const RESULT = { Win: 1, Draw: 0.5, Loss: 0 };

test('a whole section, all five steps: every player matches US Chess to the hundredth', () => {
  const items = standings(NOVICE);
  for (const system of ['R', 'Q']) {
    const out = rateSection(items, { system, dualRegular: system === 'R' });
    for (const row of items) {
      const e = entry(row, system);
      near(out[row.playerId].exact, e.postRatingDecimal, 0.01, `${row.memberId} ${system}`);
      assert.equal(out[row.playerId].post, e.postRating, `${row.memberId} ${system}`);
    }
    // The 3–0 took the bonus; the provisional 2–1s were rated with the
    // standard formula (18+ games before), the byes and forfeits left out.
    assert.equal(out.p1.method, 'standard');
    assert.ok(out.p1.bonus > 0);
    assert.equal(out.p6.played, 2);
  }
});

test('a section with an unrated player: exact once their starting rating is known, within a point without it', () => {
  const items = standings(U600);
  for (const system of ['R', 'Q']) {
    // US Chess doesn't publish the start it gave 33207034. 406 — 50 × the
    // age of an 8-year-old — reproduces every other row to the hundredth.
    const known = rateSection(items, { system, dualRegular: system === 'R', starts: { 33207034: { rating: 406, games: 0 } } });
    const guessed = rateSection(items, { system, dualRegular: system === 'R' }); // the 750 default
    for (const row of items) {
      const e = entry(row, system);
      near(known[row.playerId].exact, e.postRatingDecimal, 0.01, `${row.memberId} ${system}`);
      assert.equal(known[row.playerId].post, e.postRating, `${row.memberId} ${system}`);
      near(guessed[row.playerId].exact, e.postRatingDecimal, 1, `${row.memberId} ${system} (start guessed)`);
    }
    // Lost all three games: the formula goes below zero, the 100 floor
    // holds it, and the event's own credit makes the floor 101.
    assert.equal(known.p13.floored, true);
    assert.equal(known.p13.post, 101);
    // 6 games before the event: the special formula.
    assert.equal(known.p9.method, 'special');
  }
});

// One player's estimate — from their own row alone, with each opponent's
// rating supplied the way a caller would.
function onePlayer(items, row, system, oppRating) {
  const e = entry(row, system);
  const games = row.roundOutcomes.filter((o) => RESULT[o.outcome] != null && o.opponentPlayerId);
  return estimateRating({
    rating: e.preRatingDecimal,
    games: e.postProvisionalGameCount != null ? e.postProvisionalGameCount - games.length : null,
    results: games.map((o) => ({ opp: oppRating(o.opponentPlayerId), score: RESULT[o.outcome], id: o.opponentPlayerId })),
  });
}

test('one player, given the opponents’ ratings US Chess rated them against: within a point for established players', () => {
  let established = 0;
  let special = 0;
  for (const [rows, starts] of [[NOVICE, {}], [U600, { 33207034: { rating: 406, games: 0 } }]]) {
    const items = standings(rows);
    for (const system of ['R', 'Q']) {
      const section = rateSection(items, { system, dualRegular: system === 'R', starts });
      for (const row of items) {
        const e = entry(row, system);
        if (e.preRatingDecimal == null) continue;
        const r = onePlayer(items, row, system, (id) => section[id].step4);
        // The same arithmetic as the section's last step.
        near(r.exact, section[row.playerId].exact, 1e-9, row.memberId);
        if (r.method === 'standard' && e.postProvisionalGameCount == null) {
          established += 1;
          near(r.exact, e.postRatingDecimal, 1, `${row.memberId} ${system}`);
          assert.ok(Math.abs(r.post - e.postRating) <= 1);
        }
        // Special-formula players (8 or fewer games before) matched to the
        // hundredth here too — 33128229, 6 games, in both systems. Over all
        // 319 rows checked, rated special-formula players were within 2.3
        // points (median 0.3); the misses sit in sections whose unrated
        // players' starting ratings aren't published.
        if (r.method === 'special') {
          special += 1;
          near(r.exact, e.postRatingDecimal, 0.01, `${row.memberId} ${system}`);
        }
      }
    }
  }
  assert.equal(established, 21);
  assert.equal(special, 2);
});

test('one player, given the ratings the opponents went in with: an estimate, off by the opponents’ own progress', () => {
  // What a caller usually has. US Chess rates against each opponent's
  // result from this same event, which one player's figures can't know —
  // and in scholastic sections the field improves fast. Across all 319
  // rows checked: median 11 points out, 90% within 36, worst 99 (a 10-round
  // event where the opponents gained up to 350). With the opponents'
  // post-event ratings instead: median 3.6, 90% within 15.
  const errors = [];
  for (const rows of [NOVICE, U600]) {
    const items = standings(rows);
    const byId = new Map(items.map((r) => [r.playerId, r]));
    for (const system of ['R', 'Q']) {
      for (const row of items) {
        const e = entry(row, system);
        if (e.preRatingDecimal == null) continue;
        const r = onePlayer(items, row, system, (id) => entry(byId.get(id), system).preRatingDecimal ?? null);
        if (r.post == null || (Number.isInteger(e.postRatingDecimal) && e.postRatingDecimal <= 150)) continue;
        errors.push(Math.abs(r.exact - e.postRatingDecimal));
      }
    }
  }
  errors.sort((a, b) => a - b);
  const median = errors[Math.floor(errors.length / 2)];
  // Here (38 rated rows): median 11.5, worst 45.
  assert.ok(median < 15, `median ${median}`);
  assert.ok(errors.at(-1) < 50, `worst ${errors.at(-1)}`);
});

test('floor credit counts every rated game, unrated opponents too; online events earn none', () => {
  const r = estimateRating({ rating: 750, games: 0, results: [{ opp: null, score: 1 }, { opp: null, score: 1 }, { opp: 500, score: 0 }] });
  assert.equal(r.floor, 109); // 100 + 4·2 wins + 1 for three games
  const online = estimateRating({ rating: 300, games: 30, results: [{ opp: 900, score: 0 }, { opp: 900, score: 0 }, { opp: 900, score: 1 }], online: true });
  assert.equal(online.floor, 100);
});

test('nonsense in, nothing (or the sensible thing) out', () => {
  assert.equal(estimateRating({ rating: 0, games: 30, results: [{ opp: 1500, score: 1 }] }).reason, 'no-rating');
  assert.equal(estimateRating({ rating: -5, results: [{ opp: 1500, score: 1 }] }).reason, 'no-rating');
  // An opponent "rated" 0 is an unrated one.
  assert.equal(estimateRating({ rating: 1500, games: 30, results: [{ opp: 0, score: 1 }] }).reason, 'no-rated-opponents');
  // Negative games: unknown, so established — not a special-formula jump.
  const neg = estimateRating({ rating: 1500, games: -3, results: [{ opp: 1500, score: 1 }] });
  assert.equal(neg.method, 'standard');
  assert.ok(neg.post < 1530);
});
