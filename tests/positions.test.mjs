// The positions a line passes through, worked out once (lib/positions) — and
// held to the code it replaced: each caller playing the moves out itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';

const {
  positionsOf, hasPositions, allCached, warmPositions, prunePositions, positionsStats, resetPositions, lineItem, fen4,
} = await import('../src/lib/positions.js');
const { lineFens } = await import('../src/lib/pgn.js');
const {
  libraryItems, warmLibrary, requestWarm, onWarmed, flushWarm,
} = await import('../src/lib/positionsWarm.js');

// As lib/repertoire's buildPositionIndex and lib/games' classifyGame walked a line.
function oldTrail(moves, startFen) {
  let chess;
  try { chess = new Chess(startFen || undefined); } catch { chess = new Chess(); }
  const out = [chess.fen().split(' ').slice(0, 4).join(' ')];
  for (const m of moves ?? []) {
    try { chess.move(m); } catch { break; }
    out.push(chess.fen().split(' ').slice(0, 4).join(' '));
  }
  return out;
}

const RUY = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O'];
const EP = ['e4', 'a6', 'e5', 'd5', 'exd6', 'cxd6', 'd4', 'Nf6'];          // an en passant square that counts, and one that doesn't
const MIDDLE = 'r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2QK2R w KQ - 0 8';

test('the same positions the moves were played out to before', () => {
  resetPositions();
  for (const [moves, start] of [[RUY], [EP], [[]], [['d4', 'd5', 'c4']], [['O-O', 'cxd4', 'exd4'], MIDDLE]]) {
    const p = positionsOf(moves, start);
    assert.deepEqual(p.keys, oldTrail(moves, start));
    assert.equal(p.keys.length, moves.length + 1, 'every move played');
    assert.equal(fen4(p.last), p.keys[p.keys.length - 1], 'the last position, in full');
  }
  assert.equal(positionsOf(RUY).last, lineFens(RUY).at(-1), 'the thumbnail’s position');
});

test('a move that can’t be played ends the line there, as it did', () => {
  resetPositions();
  const bad = ['e4', 'e5', 'Ke3', 'Nc6'];
  assert.deepEqual(positionsOf(bad).keys, oldTrail(bad));
  assert.equal(positionsOf(bad).keys.length, 3);
  assert.equal(positionsOf(bad).last, lineFens(bad).at(-1));
  assert.deepEqual(positionsOf(['e4', undefined, 'Nf3']).keys, oldTrail(['e4', undefined, 'Nf3']));
  assert.deepEqual(positionsOf(null).keys, oldTrail([]), 'nothing to play');
  assert.deepEqual(positionsOf(['e4'], 'not a position').keys, oldTrail(['e4'], 'not a position'), 'a start that won’t load: the normal one');
  // Two lists that only read alike are two lines.
  assert.notDeepEqual(positionsOf(['e4 e5']).keys, positionsOf(['e4', 'e5']).keys);
});

test('played out once: the same line again — in another array, after a sync — costs nothing', () => {
  resetPositions();
  const a = positionsOf(RUY);
  assert.equal(positionsStats().walked, 1);
  assert.equal(positionsOf([...RUY]), a, 'a copy of the list: the same answer, not worked out again');
  assert.equal(positionsOf(JSON.parse(JSON.stringify(RUY))), a);
  assert.equal(positionsStats().walked, 1);
  positionsOf(RUY.slice(0, 6));
  positionsOf(RUY, MIDDLE);
  assert.equal(positionsStats().walked, 3, 'other moves, or another start: another line');
});

test('asking whether a line is done never does it', () => {
  resetPositions();
  const copy = [...RUY];
  assert.equal(hasPositions(RUY), false);
  assert.equal(positionsStats().walked, 0);
  positionsOf(RUY);
  assert.equal(hasPositions(RUY), true);
  assert.equal(hasPositions(copy), true, 'by what it says, not which array says it');
  assert.equal(allCached([{ moves: RUY }, { moves: copy }]), true);
  assert.equal(allCached([{ moves: RUY }, { moves: EP }]), false);
  assert.equal(positionsStats().walked, 1);
  assert.deepEqual(lineItem({ moves: RUY, startFen: null, name: 'x' }), { moves: RUY, startFen: undefined });
  assert.deepEqual(lineItem({ moves: EP, startFen: MIDDLE }), { moves: EP, startFen: MIDDLE });
});

test('worked through a slice at a time', () => {
  resetPositions();
  const items = Array.from({ length: 30 }, (_, i) => ({ moves: RUY.slice(0, (i % 15) + 1) }));
  // No time at all still gets one done, so it always finishes.
  let at = warmPositions(items, { from: 0, budgetMs: 0 });
  assert.equal(at, 1);
  assert.equal(positionsStats().walked, 1);
  let calls = 1;
  while (at < items.length) { at = warmPositions(items, { from: at, budgetMs: 0 }); calls += 1; }
  assert.equal(positionsStats().walked, 15, 'each distinct line once');
  assert.ok(calls <= 16, `the ones already done are passed over in the same slice (${calls} slices)`);
  assert.equal(allCached(items), true);
  assert.equal(warmPositions(items, { from: 0, budgetMs: 0 }), items.length, 'nothing left: straight to the end');
});

test('lines no longer in the library are forgotten, once there are clearly too many', () => {
  resetPositions();
  const live = [{ moves: RUY }, { moves: EP }];
  for (const it of live) positionsOf(it.moves);
  for (let i = 0; i < 1500; i += 1) positionsOf(['e4'], `gone-${i}`);
  assert.equal(prunePositions(live), 0, 'a little extra is left alone');
  for (let i = 1500; i < 2100; i += 1) positionsOf(['e4'], `gone-${i}`);
  assert.equal(positionsStats().size, 2102);
  assert.equal(prunePositions(live), 2100);
  assert.equal(positionsStats().size, 2);
  assert.equal(allCached(live), true, 'what the library has is kept');
  assert.equal(hasPositions(['e4'], 'gone-7'), false);
});

test('the library is made ready in the background: your lines, then students’, then games', () => {
  resetPositions();
  const v = (moves, startFen) => ({ id: moves.join(''), moves, ...(startFen ? { startFen } : {}) });
  const state = {
    openings: [
      { id: 's', ownerId: 'p1', chapters: [{ id: 'c', variations: [v(['c4', 'e5'])] }] },
      { id: 'm', ownerId: null, chapters: [{ id: 'c', variations: [v(RUY), v(['O-O'], MIDDLE)] }] },
    ],
    players: [{ id: 'p1', games: [{ id: 'g', moves: EP, startFen: MIDDLE }] }, { id: 'p2' }],
  };
  const items = libraryItems(state);
  assert.deepEqual(items.map((it) => it.moves.join(' ')), [RUY.join(' '), 'O-O', 'c4 e5', EP.join(' ')]);
  assert.equal(items[1].startFen, MIDDLE, 'a line set up from a position starts there');
  assert.equal(items[3].startFen, undefined, 'a game is named from the normal start, as it always was');
  warmLibrary(state);
  let told = 0;
  const stop = onWarmed(() => { told += 1; });
  flushWarm();
  assert.equal(allCached(items), true);
  assert.equal(positionsStats().walked, 4);
  assert.ok(told >= 1, 'a screen waiting is told');
  // A screen asking for what's already there asks for nothing.
  const before = positionsStats().walked;
  requestWarm(items);
  flushWarm();
  assert.equal(positionsStats().walked, before);
  // …and for what isn't, gets it.
  const more = [{ moves: ['d4', 'Nf6', 'c4', 'g6'] }];
  requestWarm(more);
  flushWarm();
  assert.equal(allCached(more), true);
  stop();
  assert.deepEqual(libraryItems(null), []);
});

// ---------- playing a move the short way (chess.js's own two steps, without its report) ----------
const { quickPlay, setQuickPlay, QUICK_PROBES } = await import('../src/lib/positions.js');

// Random legal games, long enough to reach checks, captures, castling and the odd promotion.
function randomGame(plies, seed, startFen) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const c = startFen ? new Chess(startFen) : new Chess();
  const out = [];
  for (let i = 0; i < plies; i += 1) {
    const ms = c.moves();
    if (!ms.length) break;
    // Captures, checks, castling and promotions more often than chance would have them.
    const sharp = ms.filter((m) => /[x+#=O]/.test(m));
    const m = sharp.length && rnd() < 0.45 ? sharp[Math.floor(rnd() * sharp.length)] : ms[Math.floor(rnd() * ms.length)];
    c.move(m); out.push(m);
  }
  return out;
}

test('the short way is in use here, and its own check plays every line to the end', () => {
  resetPositions();
  setQuickPlay(null);
  positionsOf(RUY);
  assert.equal(quickPlay(), true, 'chess.js as installed passes the check');
  for (const [moves, start] of QUICK_PROBES) {
    assert.equal(oldTrail(moves, start).length, moves.length + 1, `a probe that can be played: ${moves.join(' ')}`);
    assert.deepEqual(positionsOf(moves, start).keys, oldTrail(moves, start));
  }
  const kinds = QUICK_PROBES.flatMap(([m]) => m).join(' ');
  for (const need of ['O-O', 'O-O-O', '=Q', '+', 'x']) assert.ok(kinds.includes(need), `a probe with ${need}`);
});

test('the short way and the long way reach the same positions, move for move', () => {
  const ENDGAMES = ['8/P6k/8/8/8/8/6Kp/8 w - - 0 1', '4k3/1P4pp/8/8/8/8/pp4PP/4K3 w - - 0 1', 'r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R w KQkq - 6 8'];
  let plies = 0; let promotions = 0; let castles = 0; let enPassant = 0;
  for (let i = 0; i < 260; i += 1) {
    const start = i % 4 === 3 ? ENDGAMES[(i >> 2) % ENDGAMES.length] : undefined;
    const moves = randomGame(i % 4 === 3 ? 60 : 110, 7919 * (i + 1), start);
    resetPositions(); setQuickPlay(true);
    const quickly = positionsOf(moves, start);
    resetPositions(); setQuickPlay(false);
    const slowly = positionsOf(moves, start);
    assert.deepEqual(quickly.keys, slowly.keys, `game ${i}`);
    assert.equal(quickly.last, slowly.last, `game ${i}: the last position, in full`);
    assert.deepEqual(slowly.keys, oldTrail(moves, start), `game ${i}: as it was before`);
    assert.equal(quickly.keys.length, moves.length + 1);
    plies += moves.length;
    promotions += moves.filter((m) => m.includes('=')).length;
    castles += moves.filter((m) => m.startsWith('O-O')).length;
    enPassant += quickly.keys.filter((k) => !k.endsWith(' -')).length;
  }
  assert.ok(plies > 15000 && promotions > 20 && castles > 50 && enPassant > 5,
    `enough of everything: ${plies} moves, ${promotions} promotions, ${castles} castlings, ${enPassant} en passant squares`);
  // What a file or a hand can put in a line: decorations, loose notation, a null move, things that aren't moves.
  for (const [moves, start] of [
    [['e4!', 'e5?', 'Nf3!!', 'Nc6?!', 'Bb5+', 'a6']],            // decorated (the + isn't a check)
    [['e2e4', 'e7e5', 'Ng1f3', 'b8c6', 'Bf1-b5']],              // long and loose notation
    [['Nf3', 'Nf6', 'Nc3', 'Nc6', 'Nge2']],                      // a knight that isn't there
    [['e4', '--', 'd4', 'e5']],                                  // a null move
    [['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', '--']],                   // …and one with nothing wrong, later
    [['f3', 'e5', 'g4', 'Qh4#', '--', 'e4']],                    // …and after mate
    [['e4', null, 'd4']], [['e4', 42]], [[{ from: 'e2', to: 'e4' }, 'e5']], [['0-0']], [['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', '0-0', 'Nf6']],
    [['e8=Q'], '4k3/1P4pp/8/8/8/8/pp4PP/4K3 w - - 0 1'], [['b8=N+', 'Kd8', 'Nc6+'], '4k3/1P4pp/8/8/8/8/pp4PP/4K3 w - - 0 1'],
  ]) {
    resetPositions(); setQuickPlay(true);
    const quickly = positionsOf(moves, start);
    resetPositions(); setQuickPlay(false);
    const slowly = positionsOf(moves, start);
    assert.deepEqual(quickly, slowly, JSON.stringify(moves));
    assert.deepEqual(slowly.keys, oldTrail(moves, start), `as before: ${JSON.stringify(moves)}`);
  }
  resetPositions(); setQuickPlay(null);
});

test('a few missing lines are worked out on the spot; a whole library is left for the background', async () => {
  const { settleSmall } = await import('../src/lib/positions.js');
  resetPositions();
  const lines = Array.from({ length: 12 }, (_, i) => ({ moves: RUY.slice(0, i + 2) }));
  assert.equal(settleSmall(lines, 8), false, 'more than a few: not now');
  assert.equal(positionsStats().walked, 0, '…and none of them worked out by asking');
  assert.equal(settleSmall(lines.slice(0, 8), 8), true, 'a few: done there and then');
  assert.equal(positionsStats().walked, 8);
  assert.equal(allCached(lines.slice(0, 8)), true);
  assert.equal(settleSmall(lines, 8), true, 'what’s left is now few enough');
  assert.equal(positionsStats().walked, 12);
  assert.equal(settleSmall(lines, 0), true, 'nothing missing asks for nothing');
  assert.equal(settleSmall([], 0), true);
  assert.equal(settleSmall([{ moves: EP }], 0), false, 'none allowed: one missing waits');
  assert.equal(positionsStats().walked, 12);
});

test('a line only passing through — a board being explored — is not kept for good', async () => {
  const { positionsOnce } = await import('../src/lib/positions.js');
  resetPositions();
  positionsOf(RUY);                                             // in the library
  assert.equal(positionsOnce(RUY), positionsOf(RUY), 'a library line is found, not worked out again');
  assert.equal(positionsStats().walked, 1);
  const tried = positionsOnce(EP);
  assert.deepEqual(tried.keys, oldTrail(EP));
  assert.equal(positionsOnce([...EP]), tried, 'asked again on the next redraw: there');
  assert.equal(positionsStats().walked, 2);
  assert.equal(positionsStats().size, 1, 'the library’s lines only');
  assert.equal(hasPositions(EP), false, 'not counted as the library’s');
  // Hours of exploring: only the most recent are held.
  for (let i = 0; i < 300; i += 1) positionsOnce(['e4'], `tried-${i}`);
  assert.equal(positionsStats().size, 1);
  assert.equal(positionsStats().passing, 64);
  const before = positionsStats().walked;
  positionsOnce(['e4'], 'tried-299');
  positionsOnce(['e4'], 'tried-240');
  assert.equal(positionsStats().walked, before, 'recent ones cost nothing');
  positionsOnce(['e4'], 'tried-3');
  assert.equal(positionsStats().walked, before + 1, 'an old one is worked out again');
});
