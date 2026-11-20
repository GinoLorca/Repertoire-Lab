// The shared repertoire index (lib/repertoire positionIndexFor) and the
// functions that read it, held to the code they replaced: every position,
// every hit and its order, every game's opening — the same answers, from a
// library with the awkward cases in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';

const {
  buildPositionIndex, positionIndexFor, bookOpenings, bookMovesAt, matchGameToRepertoire, repertoireSide,
  rankVariationsByMoves, fen4, resetPositionIndexes,
} = await import('../src/lib/repertoire.js');
const { classifyGame, categoryOf, playerSummary, playerRecord, OFFBEAT } = await import('../src/lib/games.js');
const { positionsStats, resetPositions: resetLines } = await import('../src/lib/positions.js');
// Each test from nothing remembered: no line played out, no index kept.
const resetPositions = () => { resetLines(); resetPositionIndexes(); };
const { START_FEN, startFenOf, newGameAt, plyOffset } = await import('../src/lib/startPos.js');

// ---------- the code as it was (before lib/positions) ----------
const oldFen4 = (fen) => fen.split(' ').slice(0, 4).join(' ');
function oldBuild(openings) {
  const map = new Map();
  const add = (key, entry) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  };
  for (const opening of openings) {
    for (const chapter of opening.chapters) {
      for (const variation of chapter.variations) {
        const chess = newGameAt(startFenOf(variation));
        add(oldFen4(chess.fen()), { opening, chapter, variation, ply: 0 });
        for (let i = 0; i < variation.moves.length; i += 1) {
          try { chess.move(variation.moves[i]); } catch { break; }
          add(oldFen4(chess.fen()), { opening, chapter, variation, ply: i + 1 });
        }
      }
    }
  }
  return map;
}
function oldBookMovesAt(index, fen) {
  const hits = index.get(oldFen4(fen)) ?? [];
  const byMove = new Map();
  for (const h of hits) {
    const next = h.variation.moves[h.ply];
    if (!next) continue;
    if (!byMove.has(next)) byMove.set(next, { san: next, opening: h.opening, chapter: h.chapter, variation: h.variation });
  }
  return [...byMove.values()];
}
function oldMatch(moves, index, startFen = START_FEN) {
  const chess = newGameAt(startFen);
  let depth = 0;
  let lastHits = index.get(oldFen4(chess.fen())) ?? [];
  let deviation = null;
  for (let i = 0; i < moves.length; i += 1) {
    const expected = oldBookMovesAt(index, chess.fen());
    try { chess.move(moves[i]); } catch { break; }
    const hits = index.get(oldFen4(chess.fen())) ?? [];
    if (hits.length > 0) {
      depth = i + 1;
      lastHits = hits;
    } else {
      if (expected.length > 0) deviation = { atPly: i, played: moves[i], expected: expected.map((e) => e.san) };
      break;
    }
  }
  if (depth === 0) return { matched: false };
  const best = [...lastHits].sort((a, b) => (b.variation.moves.length - a.variation.moves.length))[0];
  return {
    matched: true, depth, opening: best.opening, chapter: best.chapter, variation: best.variation,
    exhausted: depth >= moves.length, deviation,
  };
}
function oldSide(moves, index, startFen = START_FEN) {
  const chess = newGameAt(startFen);
  let hits = [];
  let depth = 0;
  for (let i = 0; i < (moves?.length ?? 0); i += 1) {
    try { chess.move(moves[i]); } catch { break; }
    const here = index.get(oldFen4(chess.fen())) ?? [];
    if (!here.length) break;
    hits = here;
    depth = i + 1;
  }
  if (depth < 2) return null;
  const sides = new Set(hits.map((h) => h.opening?.color).filter((c) => c === 'white' || c === 'black'));
  return sides.size === 1 ? [...sides][0] : null;
}
function oldClassify(moves = [], index) {
  if (!index) return { matched: false };
  const chess = new Chess();
  let best = null;
  let contiguous = 0;
  let stillContiguous = true;
  const consider = (hits, gamePly) => {
    for (const hit of hits) {
      if (hit.ply === 0 && !hit.variation.startFen) continue;
      const depth = hit.ply + (hit.variation.startFen ? plyOffset(hit.variation.startFen) : 0);
      const score = depth * 1000 + hit.variation.moves.length;
      if (!best || score > best.score) best = { ...hit, score, gamePly };
    }
  };
  consider(index.get(oldFen4(chess.fen())) ?? [], 0);
  for (let i = 0; i < moves.length; i += 1) {
    try { chess.move(moves[i]); } catch { break; }
    const hits = index.get(oldFen4(chess.fen())) ?? [];
    if (hits.length > 0) {
      consider(hits, i + 1);
      if (stillContiguous) contiguous = i + 1;
    } else if (stillContiguous) {
      stillContiguous = false;
    }
  }
  if (!best || (best.ply === 0 && !best.variation.startFen)) return { matched: false, contiguous: 0 };
  return {
    matched: true, opening: best.opening, chapter: best.chapter, variation: best.variation,
    bookPly: best.ply, gamePly: best.gamePly, contiguous,
    transposed: best.gamePly > contiguous || contiguous === 0,
  };
}
function oldTrail(moves, startFen = START_FEN) {
  const chess = newGameAt(startFen);
  const trail = [oldFen4(chess.fen())];
  for (const san of moves) {
    try { chess.move(san); } catch { break; }
    trail.push(oldFen4(chess.fen()));
  }
  return trail;
}
function oldRank(moves, openings, startFen = START_FEN) {
  const inputTrail = oldTrail(moves, startFen);
  const results = [];
  for (const opening of openings) {
    for (const chapter of opening.chapters) {
      for (const variation of chapter.variations) {
        const trail = oldTrail(variation.moves, startFenOf(variation));
        if (trail[0] !== inputTrail[0]) continue;
        let common = 0;
        while (common + 1 < inputTrail.length && common + 1 < trail.length && inputTrail[common + 1] === trail[common + 1]) common += 1;
        if (common === 0) continue;
        results.push({
          opening, chapter, variation, depth: common,
          exact: common === moves.length && common === variation.moves.length,
          coversInput: common === moves.length,
          divergesAt: common < moves.length ? common : null,
          played: common < moves.length ? moves[common] : null,
          book: variation.moves[common] ?? null,
        });
      }
    }
  }
  return results.sort((a, b) => b.depth - a.depth || a.variation.moves.length - b.variation.moves.length);
}

// ---------- a library: shared prefixes, set-up lines, broken lines, copies ----------
let seed = 20261120;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
let n = 0;
const id = (p) => `${p}${(n += 1)}`;
function extend(prefix, plies, startFen) {
  const c = startFen ? new Chess(startFen) : new Chess();
  for (const m of prefix) c.move(m);
  const out = [...prefix];
  for (let i = 0; i < plies; i += 1) {
    const ms = c.moves();
    if (!ms.length) break;
    const m = pick(ms);
    c.move(m); out.push(m);
  }
  return out;
}
const MIDDLE = 'r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2QK2R w KQ - 0 8';
const variation = (moves, extra = {}) => ({ id: id('v'), name: `Line ${n}`, moves, comments: {}, ...extra });
function opening(name, ownerId, color, chapters, vars) {
  const root = extend([], 3 + Math.floor(rnd() * 3));
  return {
    id: id('o'), name, color, ownerId,
    chapters: Array.from({ length: chapters }, (_, ci) => {
      const chRoot = extend(root, 2 + Math.floor(rnd() * 2));
      return { id: id('c'), name: `${name} ch ${ci + 1}`, variations: Array.from({ length: vars }, () => variation(extend(chRoot, 6 + Math.floor(rnd() * 14)))) };
    }),
  };
}
const coach = [opening('Alpha', null, 'white', 3, 6), opening('Beta', null, 'black', 3, 6), opening('Gamma', null, 'white', 2, 5)];
// A course's typical middlegame, a line with a move that can't be played, an empty one, an empty chapter.
coach[0].chapters.push({
  id: id('c'), name: 'Typical ideas',
  variations: [variation(extend([], 8, MIDDLE), { startFen: MIDDLE }), variation(extend([], 5, MIDDLE), { startFen: MIDDLE })],
});
coach[1].chapters[0].variations.push(variation([...coach[1].chapters[0].variations[0].moves.slice(0, 5), 'Ke3', 'e5']));
coach[1].chapters[0].variations.push(variation([]));
coach[2].chapters.push({ id: id('c'), name: 'Nothing yet', variations: [] });
const allCoachLines = coach.flatMap((o) => o.chapters.flatMap((c) => c.variations));
const students = ['s1', 's2', 's3', 's4'];
const own = {
  s1: [opening('S1 own', 's1', 'white', 2, 4)],
  // copies of your lines (as Give to student makes), and one set-up line of their own
  s2: [{
    id: id('o'), name: 'S2 copies', color: 'black', ownerId: 's2',
    chapters: [{ id: id('c'), name: 'Copied', variations: [...coach[1].chapters[1].variations.slice(0, 3).map((v) => variation([...v.moves])), variation(extend([], 6, MIDDLE), { startFen: MIDDLE })] }],
  }, opening('S2 own', 's2', 'white', 1, 3)],
  s3: [],                                                   // nothing of their own
  s4: [{ id: id('o'), name: 'S4 empty', color: 'white', ownerId: 's4', chapters: [] }],   // an opening with no lines
};
const openings = [own.s1[0], coach[0], ...own.s2, coach[1], coach[2], ...own.s4];   // owners interleaved, as a real library is
const lineOf = () => pick(allCoachLines.filter((v) => !v.startFen && v.moves.length > 6));
const games = [];
for (let i = 0; i < 60; i += 1) {
  const r = rnd();
  let moves;
  if (r < 0.45) { const v = lineOf(); moves = extend(v.moves.slice(0, 3 + Math.floor(rnd() * 8)), 20); } // follows a line, then leaves
  else if (r < 0.55) { const v = pick(own.s1[0].chapters[0].variations); moves = extend(v.moves.slice(0, 5), 12); }
  else if (r < 0.65) { const v = lineOf(); moves = [...v.moves]; }                                        // a whole line, nothing after
  else moves = extend([], 30);                                                                             // its own way
  games.push({ id: id('g'), moves, meta: { color: i % 2 ? 'black' : 'white', result: pick(['1-0', '0-1', '½-½', '*']) } });
}
games.push({ id: id('g'), moves: [] }, { id: id('g'), moves: ['e4', 'e5', 'Ke3', 'Nc6'] }, { id: id('g'), moves: ['Zz9'] });
// A transposition: a line's position by another move order, where the moves allow it.
{
  const v = allCoachLines.find((x) => !x.startFen && x.moves.length >= 4);
  const [a, b, c, d] = v.moves;
  try { const t = new Chess(); t.move(c); t.move(b); t.move(a); t.move(d); games.push({ id: id('g'), moves: [c, b, a, d, ...v.moves.slice(4)] }); } catch { /* not one that transposes */ }
}

const sameIndex = (got, want, label) => {
  const g = [...got]; const w = [...want];
  assert.equal(g.length, w.length, `${label}: positions`);
  assert.equal(got.size, want.size, `${label}: size`);
  for (let i = 0; i < w.length; i += 1) {
    assert.equal(g[i][0], w[i][0], `${label}: position ${i} in the same place`);
    const a = g[i][1]; const b = w[i][1];
    assert.equal(a.length, b.length, `${label}: hits at ${w[i][0]}`);
    for (let j = 0; j < b.length; j += 1) {
      assert.ok(a[j].opening === b[j].opening && a[j].chapter === b[j].chapter && a[j].variation === b[j].variation && a[j].ply === b[j].ply,
        `${label}: hit ${j} at ${w[i][0]}`);
    }
    assert.equal(got.has(w[i][0]), true);
    const viaGet = got.get(w[i][0]);
    assert.equal(viaGet.length, b.length);
    assert.ok(viaGet.every((h, j) => h.variation === b[j].variation && h.ply === b[j].ply), `${label}: get() at ${w[i][0]}`);
  }
  assert.equal(got.get('8/8/8/8/8/8/8/8 w - -'), undefined, `${label}: a position nobody has`);
  assert.equal(got.has('8/8/8/8/8/8/8/8 w - -'), false);
  assert.deepEqual([...got.keys()], w.map(([k]) => k), `${label}: keys()`);
  assert.equal([...got.values()].length, w.length, `${label}: values()`);
  let walked = 0;
  got.forEach((hits, key) => { assert.equal(key, w[walked][0]); assert.equal(hits.length, w[walked][1].length); walked += 1; });
  assert.equal(walked, w.length, `${label}: forEach`);
};
const SOURCES = ['both', 'mine', 'student', 'none'];

test('one index, built from remembered positions: the same as playing every line out', () => {
  resetPositions();
  sameIndex(buildPositionIndex(openings), oldBuild(openings), 'everything');
  sameIndex(buildPositionIndex(coach), oldBuild(coach), 'yours');
  sameIndex(buildPositionIndex([]), oldBuild([]), 'nothing');
  assert.equal(fen4('a b c d e f'), 'a b c d');
});

test('the shared index: for every student and every "Repertoire to check", what one built from that list would be', () => {
  resetPositions();
  for (const studentId of [null, ...students, 'nobody']) {
    for (const source of SOURCES) {
      const want = oldBuild(bookOpenings(openings, { studentId, source }));
      sameIndex(positionIndexFor(openings, { studentId, source }), want, `${studentId ?? 'you'} / ${source}`);
    }
  }
  sameIndex(positionIndexFor(openings), oldBuild(bookOpenings(openings)), 'no options');
  assert.equal(positionIndexFor(null).size, 0);
  assert.equal(positionIndexFor(undefined, { studentId: 's1' }).get('x'), undefined);
});

test('each line is played out once, however many cards and boards ask', () => {
  resetPositions();
  for (const studentId of students) positionIndexFor(openings, { studentId });
  const distinct = new Set(openings.flatMap((o) => o.chapters.flatMap((c) => c.variations.map((v) => `${v.startFen ?? ''}|${v.moves.join(' ')}`)))).size;
  assert.equal(positionsStats().walked, distinct, 'a student’s copy of your line costs nothing');
  const before = positionsStats().walked;
  for (let i = 0; i < 5; i += 1) for (const studentId of students) for (const source of SOURCES) positionIndexFor(openings, { studentId, source });
  assert.equal(positionsStats().walked, before);
  // The same object while the lines behind it are the same: what a screen's memo keys on.
  for (const studentId of [null, ...students]) {
    assert.equal(positionIndexFor(openings, { studentId }), positionIndexFor(openings, { studentId }), `${studentId}`);
  }
  // Everyone without lines of their own reads your index itself.
  assert.equal(positionIndexFor(openings, { studentId: 's3' }), positionIndexFor(openings, { studentId: null }));
  assert.equal(positionIndexFor(openings, { studentId: 's4' }), positionIndexFor(openings, { source: 'mine' }));
});

test('a change to one opening touches only its owner’s index — and is in it', () => {
  resetPositions();
  const mineBefore = positionIndexFor(openings, { source: 'mine' });
  const s1Before = positionIndexFor(openings, { studentId: 's1' });
  const s2Before = positionIndexFor(openings, { studentId: 's2' });
  const s2Own = positionIndexFor(openings, { studentId: 's2', source: 'student' });
  // s1 gets a new line (a new opening object, a new openings array — as the store does it).
  const added = variation(['b3', 'e5', 'Bb2', 'Nc6']);
  const next = openings.map((o) => (o === own.s1[0]
    ? { ...o, chapters: o.chapters.map((c, i) => (i === 0 ? { ...c, variations: [...c.variations, added] } : c)) }
    : o));
  const walkedBefore = positionsStats().walked;
  const s1After = positionIndexFor(next, { studentId: 's1' });
  assert.notEqual(s1After, s1Before);
  sameIndex(s1After, oldBuild(bookOpenings(next, { studentId: 's1' })), 's1 after');
  assert.equal(positionsStats().walked, walkedBefore + 1, 'only the new line is played out');
  assert.equal(positionIndexFor(next, { source: 'mine' }), mineBefore, 'your index is the one it was');
  assert.equal(positionIndexFor(next, { studentId: 's2', source: 'student' }), s2Own, 'another student’s too');
  assert.equal(positionIndexFor(next, { studentId: 's2' }), s2Before);
  // One of yours changes: every student's "both" has it, their own halves untouched.
  const mineNext = next.map((o) => (o === coach[2] ? { ...o, name: 'Gamma renamed' } : o));
  const s2Then = positionIndexFor(mineNext, { studentId: 's2' });
  assert.notEqual(s2Then, s2Before);
  sameIndex(s2Then, oldBuild(bookOpenings(mineNext, { studentId: 's2' })), 's2 after yours changed');
  assert.equal(positionIndexFor(mineNext, { studentId: 's2', source: 'student' }), s2Own);
  assert.ok([...s2Then].some(([, hits]) => hits.some((h) => h.opening.name === 'Gamma renamed')), 'hits name the opening as it is now');
  assert.equal(positionsStats().walked, walkedBefore + 1);
  // A student whose lines are all taken away reads yours.
  const gone = mineNext.filter((o) => o.ownerId !== 's2');
  assert.equal(positionIndexFor(gone, { studentId: 's2' }), positionIndexFor(gone, { studentId: null }));
  sameIndex(positionIndexFor(gone, { studentId: 's2', source: 'student' }), oldBuild([]), 's2 with nothing');
});

test('after a sync — every object new, saying the same — nothing is played out again, and hits are the new objects', () => {
  resetPositions();
  positionIndexFor(openings, { studentId: 's1' });
  const walked = positionsStats().walked;
  const synced = JSON.parse(JSON.stringify(openings));
  const index = positionIndexFor(synced, { studentId: 's1' });
  assert.equal(positionsStats().walked, walked);
  sameIndex(index, oldBuild(bookOpenings(synced, { studentId: 's1' })), 'synced');
  const mineNow = new Set(synced.filter((o) => !o.ownerId));
  assert.ok([...positionIndexFor(synced, { source: 'mine' })].every(([, hits]) => hits.every((h) => mineNow.has(h.opening))));
});

test('every game is named as it was: classifyGame, for every student’s book', () => {
  resetPositions();
  let matched = 0; let transposed = 0;
  for (const studentId of [null, ...students]) {
    for (const source of SOURCES) {
      const index = positionIndexFor(openings, { studentId, source });
      const want = oldBuild(bookOpenings(openings, { studentId, source }));
      for (const g of games) {
        const a = classifyGame(g.moves, index);
        const b = oldClassify(g.moves, want);
        assert.deepEqual(
          { ...a, opening: a.opening?.id, chapter: a.chapter?.id, variation: a.variation?.id },
          { ...b, opening: b.opening?.id, chapter: b.chapter?.id, variation: b.variation?.id },
          `game ${g.id} for ${studentId ?? 'you'} / ${source}`,
        );
        assert.ok(a.variation === b.variation && a.opening === b.opening, 'the very same line');
        if (a.matched) matched += 1;
        if (a.transposed) transposed += 1;
      }
    }
  }
  assert.ok(matched > 100 && transposed > 0, `the library is one games really match (${matched} matched, ${transposed} transposed)`);
  assert.deepEqual(classifyGame(games[0].moves, null), { matched: false });
  assert.deepEqual(classifyGame(undefined, positionIndexFor(openings)), oldClassify(undefined, oldBuild(bookOpenings(openings))));
});

test('the board’s readings are what they were: book moves, how deep, whose side', () => {
  resetPositions();
  for (const studentId of [null, 's1', 's2']) {
    const index = positionIndexFor(openings, { studentId });
    const want = oldBuild(bookOpenings(openings, { studentId }));
    const strip = (r) => ({ ...r, opening: r.opening?.id, chapter: r.chapter?.id, variation: r.variation?.id });
    for (const g of games) {
      assert.deepEqual(strip(matchGameToRepertoire(g.moves, index)), strip(oldMatch(g.moves, want)), `match ${g.id}`);
      assert.equal(repertoireSide(g.moves, index), oldSide(g.moves, want), `side ${g.id}`);
      // …at every move of the game, as the board asks while you step through it.
      const c = new Chess();
      for (const m of g.moves.slice(0, 12)) {
        const a = bookMovesAt(index, c.fen()); const b = oldBookMovesAt(want, c.fen());
        assert.deepEqual(a.map((x) => [x.san, x.variation.id]), b.map((x) => [x.san, x.variation.id]));
        try { c.move(m); } catch { break; }
      }
    }
    // From a set-up position.
    const setUp = coach[0].chapters.at(-1).variations[0];
    for (const moves of [setUp.moves, setUp.moves.slice(0, 3), [...setUp.moves.slice(0, 2), 'Ke3'], []]) {
      assert.deepEqual(strip(matchGameToRepertoire(moves, index, MIDDLE)), strip(oldMatch(moves, want, MIDDLE)));
      assert.equal(repertoireSide(moves, index, MIDDLE), oldSide(moves, want, MIDDLE));
    }
    assert.equal(repertoireSide(null, index), oldSide(null, want));
  }
});

test('Search by moves ranks the lines as before', () => {
  resetPositions();
  const strip = (rows) => rows.map((r) => ({ ...r, opening: r.opening.id, chapter: r.chapter.id, variation: r.variation.id }));
  for (const g of games.slice(0, 25)) {
    assert.deepEqual(strip(rankVariationsByMoves(g.moves.slice(0, 9), openings)), strip(oldRank(g.moves.slice(0, 9), openings)), `rank ${g.id}`);
  }
  const setUp = coach[0].chapters.at(-1).variations[0];
  assert.deepEqual(strip(rankVariationsByMoves(setUp.moves.slice(0, 4), openings, MIDDLE)), strip(oldRank(setUp.moves.slice(0, 4), openings, MIDDLE)));
});

test('a card’s line in Coaches Corner: one look at each game, the same counts as two', () => {
  resetPositions();
  const state = { openings, categories: [{ id: 'k1', name: 'Mine' }] };
  for (const studentId of students) {
    const player = {
      id: studentId, kind: 'student',
      games: games.map((g, i) => (i % 9 === 0 ? { ...g, meta: { ...g.meta, categoryId: i % 2 ? 'custom:k1' : OFFBEAT } } : g)),
    };
    const index = positionIndexFor(openings, { studentId });
    const want = oldBuild(bookOpenings(openings, { studentId }));
    // As the list worked it out: every game classified twice, against an index built for the card.
    const cats = new Set(player.games.map((g) => categoryOf(g, want, state).id));
    const offbeat = player.games.filter((g) => categoryOf(g, want, state).id === OFFBEAT).length;
    assert.deepEqual(playerSummary(player, index, state), { record: playerRecord(player.games), openings: cats.size, offbeat });
  }
  assert.deepEqual(playerSummary({ games: [] }, positionIndexFor(openings), state), { record: playerRecord([]), openings: 0, offbeat: 0 });
});
