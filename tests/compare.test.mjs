// Compare lines' "how far do these two run together" (lib/compare
// sharedPrefix, siblingsOf), now read from the positions lib/positions
// remembers, held to the code it replaced: both lines played out, move by
// move, for every pair.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';

const { sharedPrefix, siblingsOf, diverge, allVariations } = await import('../src/lib/compare.js');
const { START_FEN, startFenOf, newGameAt, fen4 } = await import('../src/lib/startPos.js');
const { resetPositions, positionsStats } = await import('../src/lib/positions.js');

// ---------- as it was ----------
function oldSharedPrefix(a = [], b = [], aStart = START_FEN, bStart = START_FEN) {
  const ca = newGameAt(aStart);
  const cb = newGameAt(bStart);
  const key = (c) => fen4(c.fen());
  if (key(ca) !== key(cb)) return 0;
  let n = 0;
  while (n < a.length && n < b.length) {
    try { ca.move(a[n]); cb.move(b[n]); } catch { break; }
    if (key(ca) !== key(cb)) break;
    n += 1;
  }
  return n;
}
function oldSiblingsOf(target, openings, limit = 40) {
  if (!target) return [];
  return allVariations(openings)
    .filter((it) => it.variation.id !== target.variation.id)
    .map((it) => ({
      ...it,
      at: oldSharedPrefix(target.variation.moves, it.variation.moves, startFenOf(target.variation), startFenOf(it.variation)),
      sameChapter: it.chapter.id === target.chapter.id,
      sameOpening: it.opening.id === target.opening.id,
    }))
    .filter((it) => it.at > 0)
    .sort((x, y) => (y.at - x.at || (y.sameChapter ? 1 : 0) - (x.sameChapter ? 1 : 0) || (y.sameOpening ? 1 : 0) - (x.sameOpening ? 1 : 0)))
    .slice(0, limit);
}

// ---------- a library with the awkward cases in it ----------
let seed = 4242;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
function extend(prefix, plies, startFen = START_FEN) {
  const c = newGameAt(startFen);
  for (const m of prefix) c.move(m);
  const out = [...prefix];
  for (let i = 0; i < plies; i += 1) { const ms = c.moves(); if (!ms.length) break; const m = pick(ms); c.move(m); out.push(m); }
  return out;
}
const MIDDLE = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
let n = 0;
const id = (p) => `${p}${(n += 1)}`;
const line = (moves, extra = {}) => ({ id: id('v'), name: `line ${n}`, moves, ...extra });
const openings = [];
for (let o = 0; o < 4; o += 1) {
  const root = extend([], 4);
  const chapters = [];
  for (let c = 0; c < 3; c += 1) {
    const chRoot = extend(root, 3);
    const variations = [];
    for (let v = 0; v < 7; v += 1) variations.push(line(extend(chRoot, 4 + Math.floor(rnd() * 14))));
    chapters.push({ id: id('c'), name: `chapter ${n}`, variations });
  }
  openings.push({ id: id('o'), name: `opening ${n}`, color: o % 2 ? 'black' : 'white', ownerId: null, chapters });
}
const first = openings[0].chapters[0].variations;
// The same line twice; one the start of another; a line with nothing in it; a move that can't be played;
// the same position by another order; lines set up from a position.
first.push(line([...first[0].moves]));
first.push(line(first[1].moves.slice(0, 3)));
first.push(line([]));
first.push(line([...first[2].moves.slice(0, 4), 'Zz9', 'e4']));
first.push(line(['Nf3', 'Nf6', 'd4', 'd5', 'c4']), line(['d4', 'd5', 'Nf3', 'Nf6', 'c4']), line(['d4', 'Nf6', 'Nf3', 'd5', 'c4', 'e6']));
openings.push({
  id: id('o'), name: 'Set up', color: 'white', ownerId: 's1',
  chapters: [{ id: id('c'), name: 'From a position', variations: [line(extend([], 8, MIDDLE), { startFen: MIDDLE }), line(extend([], 5, MIDDLE), { startFen: MIDDLE }), line(extend([], 6))] }],
});
const all = allVariations(openings);

test('how far two lines run together: as playing both out says, for every pair', () => {
  resetPositions();
  let pairs = 0;
  for (const x of all) {
    for (const y of all) {
      const want = oldSharedPrefix(x.variation.moves, y.variation.moves, startFenOf(x.variation), startFenOf(y.variation));
      assert.equal(
        sharedPrefix(x.variation.moves, y.variation.moves, startFenOf(x.variation), startFenOf(y.variation)), want,
        `${x.variation.moves.join(' ')}  |  ${y.variation.moves.join(' ')}`,
      );
      pairs += 1;
    }
  }
  assert.ok(pairs > 8000);
  // The awkward ones, by name.
  assert.equal(sharedPrefix(['Nf3', 'Nf6', 'd4', 'd5', 'c4'], ['d4', 'd5', 'Nf3', 'Nf6', 'c4']), 0, 'another order parts at once (a different first position)');
  assert.equal(sharedPrefix(['d4', 'd5', 'Nf3'], ['d4', 'd5', 'Nf3', 'Nf6']), 3, 'one the start of the other');
  assert.equal(sharedPrefix([], ['e4']), 0);
  assert.equal(sharedPrefix(['e4', 'Zz9'], ['e4', 'e5']), 1, 'a move that can\'t be played ends it there');
  assert.equal(sharedPrefix(['d4'], ['d4'], MIDDLE, START_FEN), 0, 'different starts share nothing');
  assert.equal(sharedPrefix(), 0);
});

test('the lines offered to compare with: the same ones, in the same order', () => {
  resetPositions();
  for (const target of all) {
    const got = siblingsOf(target, openings);
    const want = oldSiblingsOf(target, openings);
    assert.equal(got.length, want.length, target.variation.name);
    got.forEach((g, i) => {
      assert.ok(g.variation === want[i].variation && g.at === want[i].at && g.sameChapter === want[i].sameChapter && g.sameOpening === want[i].sameOpening,
        `${target.variation.name}: place ${i}`);
    });
  }
  assert.deepEqual(siblingsOf(null, openings), []);
  // A line typed in (not the library's): compared all the same, and a limit kept.
  const typed = { opening: openings[0], chapter: openings[0].chapters[0], variation: { id: 'typed', moves: [...first[0].moves.slice(0, 5), 'a3'] } };
  const gotTyped = siblingsOf(typed, openings, 5);
  const wantTyped = oldSiblingsOf(typed, openings, 5);
  assert.equal(gotTyped.length, wantTyped.length);
  gotTyped.forEach((g, i) => assert.ok(g.variation === wantTyped[i].variation && g.at === wantTyped[i].at));
});

test('asked again, nothing is played out again; and diverge reads the same', () => {
  resetPositions();
  const target = all[3];
  siblingsOf(target, openings);
  const walked = positionsStats().walked;
  for (let i = 0; i < 5; i += 1) siblingsOf(target, openings);
  assert.equal(positionsStats().walked, walked, 'the library\'s lines are remembered');
  const d = diverge(all[0].variation, all[1].variation);
  assert.equal(d.at, oldSharedPrefix(all[0].variation.moves, all[1].variation.moves));
  assert.equal(d.aMove, all[0].variation.moves[d.at] ?? null);
  assert.equal(d.sameStart, true);
  assert.equal(diverge(all[0].variation, { moves: ['d4'], startFen: MIDDLE }).sameStart, false);
  // (chess.js itself, to be sure the fixture's lines are what they claim.)
  assert.doesNotThrow(() => { const c = new Chess(); for (const m of all[0].variation.moves) c.move(m); });
});
