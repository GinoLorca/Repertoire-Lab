// The Capture Calculator (src/lib/captureCalc.js, src/components/CaptureCalc.jsx).
//
// The cases are Chess Arcade's and this app's together: a copy, in the repo,
// of the calculator's shared cases (test-kits/chess-arcade/calc/cases.json),
// so both apps count, word and judge every one of them alike. Then how the
// calculator's own moves behave (follow / replace / step / keep), its card as
// it renders (the count hidden and shown), and its key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  calcLine, calcCount, calcStart, calcPlay, calcStep, calcKeep, calcFollow, moveWhat, movePoints, moveLabel,
  startText, balanceText, tookText, promotedText, statusText, verdictText, CALC_VALUES,
  calcMarksAt, calcDraw, drawTarget, drawingsHere, applyDrawing, calcKeepMarks, calcNodeAt,
  evalSide, evalNumber, evalText, evalShare, evalVersusCount,
} from '../src/lib/captureCalc.js';
import { setMarksAt } from '../src/lib/reviewEdit.js';
import { reviewOnBoard, marksWith } from '../src/lib/reviewOnBoard.js';
import { sideToMove } from '../src/lib/startPos.js';
import { makeTree, mainLineFrom, findNode, nodePath } from '../src/lib/moveTree.js';
import { shortcutMap, shortcutKey, keyToken, SHORTCUTS } from '../src/lib/shortcuts.js';
import { isReviewPenKey } from '../src/lib/arrowProfiles.js';

const { cases, values } = JSON.parse(readFileSync(new URL('./fixtures/captureCalc.cases.json', import.meta.url), 'utf8'));

test('the piece values are the user\'s: pawn 1, knight 3, bishop 3, rook 5, queen 9', () => {
  assert.deepEqual(CALC_VALUES, { p: 1, n: 3, b: 3, r: 5, q: 9 });
  assert.deepEqual(values, CALC_VALUES);
});

test('the shared cases cover what the calculator has to get right', () => {
  const ids = cases.map((c) => c.id);
  for (const id of [
    'simple-trade', 'winning-a-piece', 'losing-the-exchange', 'even-multi-capture', 'recapture-available',
    'pinned-cant-recapture', 'en-passant', 'promotion-quiet', 'promotion-with-capture', 'underpromotion',
    'checkmate-in-line', 'step-back-mid-sequence', 'castling-with-check',
  ]) assert.ok(ids.includes(id), `case ${id}`);
  assert.equal(new Set(ids).size, ids.length, 'case ids are unique');
});

// Every case, field by field: what both apps must show for the board at `at`.
for (const c of cases) {
  test(`case ${c.id}: ${c.title}`, () => {
    const e = c.expect;
    const line = calcLine(c.fen, c.moves);
    assert.ok(line, 'the start loads');
    assert.equal(line.moves.length, c.moves.length, 'every move is legal');
    const at = c.at ?? c.moves.length;
    const count = calcCount(line, at);
    const you = c.you ?? null;

    const events = line.moves.slice(0, at).map((m) => ({
      label: m.label,
      san: m.san,
      side: m.color,
      took: m.captured,
      promo: m.promotion,
      points: m.points,
      text: moveWhat(m),
      pointsText: movePoints(m),
    }));
    assert.deepEqual(events, e.events, 'the moves up to the board');
    assert.deepEqual(line.moves.slice(at).map((m) => m.label), e.later, 'the moves after it');
    assert.equal(count.white, e.white, 'White\'s points');
    assert.equal(count.black, e.black, 'Black\'s points');
    assert.equal(count.balance, e.balance, 'the balance');
    assert.deepEqual(count.took.w, e.whiteTook, 'what White took');
    assert.deepEqual(count.took.b, e.blackTook, 'what Black took');
    assert.deepEqual(count.promoted.w, e.whitePromo, 'what White promoted to');
    assert.deepEqual(count.promoted.b, e.blackPromo, 'what Black promoted to');
    assert.equal(count.turn, e.toMove, 'the side to move');
    assert.equal(count.status.kind, e.status, 'the status');
    assert.equal(count.status.square ?? null, e.square, 'the square still open');

    const lines = {
      start: startText(null, sideToMove(c.fen)),
      balance: balanceText(count.balance, you),
      whiteTook: tookText('w', count, you),
      blackTook: tookText('b', count, you),
      whitePromo: promotedText('w', count, you),
      blackPromo: promotedText('b', count, you),
      status: statusText(count),
      verdict: verdictText(count),
    };
    assert.deepEqual(lines, e.lines, 'the words');
  });
}

test('the start line names the move before it when the board knows it', () => {
  const fen = 'r1bq1rk1/pppnbppp/4p3/3pP3/3P4/3B1N2/PPP2PPP/RNBQ1RK1 w - - 0 15';
  // 14...Nd7 is Black's move 13 of a game from the start: index 27.
  assert.equal(moveLabel(27, undefined, 'Nd7'), '14...Nd7');
  assert.equal(moveLabel(28, undefined, 'Bxh7+'), '15. Bxh7+');
  assert.equal(startText('14...Nd7', sideToMove(fen)), 'Start: after 14...Nd7, White to move');
  assert.equal(startText(null, 'b'), 'Start: this position, Black to move');
});

test('"(you)" goes after your colour however the side is given, never in the verdict', () => {
  assert.equal(balanceText(2, 'white'), 'White (you) +2');
  assert.equal(balanceText(2, 'black'), 'White +2');
  assert.equal(balanceText(-3, 'b'), 'Black (you) +3');
  assert.equal(balanceText(0, 'white'), 'Even');
  const c = cases.find((x) => x.id === 'looks-good-loses');
  const count = calcCount(calcLine(c.fen, c.moves));
  assert.equal(tookText('b', count, 'black'), 'Black (you) took: bishop (3)');
  assert.equal(verdictText(count), 'Black comes out ahead by 2.');
});

test('stepping along the line: the count at every point, the status as it goes', () => {
  const c = cases.find((x) => x.id === 'checkmate-in-line');
  const line = calcLine(c.fen, c.moves);
  const seen = [0, 1, 2, 3, 4, 5].map((at) => {
    const k = calcCount(line, at);
    return [k.balance, k.status.kind];
  });
  // 5.Nxe5 (dxe5 is there), 5...Bxd1 (Kxd1 / Nxd1), 6.Bxf7+ (the king can't
  // take: Ne5 guards f7), 6...Ke7, 7.Nd5#.
  assert.deepEqual(seen, [[0, 'none'], [1, 'open'], [-8, 'open'], [-7, 'done'], [-7, 'done'], [-7, 'mate']]);
  // Past either end is the end.
  assert.equal(calcCount(line, 99).at, 5);
  assert.equal(calcCount(line, -4).at, 0);
});

test('a line that goes wrong stops at the first move that can\'t be played', () => {
  const line = calcLine('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e4', 'Ke2', 'e5']);
  assert.deepEqual(line.moves.map((m) => m.san), ['e4']);
  assert.equal(calcLine('not a position', ['e4']), null);
});

// ---------- The calculator's own moves ----------

test('a move played is added; the same next move is followed; another replaces the rest', () => {
  let c = calcStart({ anchorId: 'n1', anchorFen: 'x', startLabel: '14...Nd7' });
  assert.deepEqual([c.sans, c.at, c.anchorId, c.startLabel], [[], 0, 'n1', '14...Nd7']);
  c = calcPlay(c, 'Bxh7+');
  c = calcPlay(c, 'Kxh7');
  c = calcPlay(c, 'Ng5+');
  assert.deepEqual([c.sans, c.at], [['Bxh7+', 'Kxh7', 'Ng5+'], 3]);
  c = calcStep(c, 1);
  assert.deepEqual([c.sans, c.at], [['Bxh7+', 'Kxh7', 'Ng5+'], 1], 'stepping back keeps the rest');
  assert.equal(calcPlay(c, 'Kxh7').sans.length, 3, 'the same move is followed');
  assert.equal(calcPlay(c, 'Kxh7').at, 2);
  const other = calcPlay(c, 'Kh8');
  assert.deepEqual([other.sans, other.at], [['Bxh7+', 'Kh8'], 2], 'a different move replaces the rest');
  assert.equal(calcStep(c, 99).at, 3);
  assert.equal(calcStep(c, -1).at, 0);
  assert.equal(calcPlay(null, 'e4'), null);
});

test('Keep as a side line: from where it started, following moves already there', () => {
  const game = makeTree(['e4', 'e5', 'Nf3', 'Nc6']);
  const anchor = mainLineFrom(game)[1].id; // after 1...e5
  const { tree, ids } = calcKeep(game, anchor, ['Nf3', 'd6', 'd4']);
  assert.equal(ids.length, 3);
  assert.equal(ids[0], mainLineFrom(game)[2].id, 'the game\'s own Nf3 is followed, not doubled');
  assert.deepEqual(mainLineFrom(tree).map((n) => n.san), ['e4', 'e5', 'Nf3', 'Nc6'], 'the game stays the main line');
  assert.deepEqual(nodePath(tree, ids[2]).map((n) => n.san), ['e4', 'e5', 'Nf3', 'd6', 'd4']);
  assert.equal(findNode(tree, mainLineFrom(game)[2].id).children.length, 2, 'd6 is a side line after 2.Nf3');
  // The tree it was given is left as it was.
  assert.equal(findNode(game, mainLineFrom(game)[2].id).children.length, 1);
});

test('following the board\'s tree: → at the end of the moves plays the line\'s next one; nothing new, nothing to keep', () => {
  const game = makeTree(['e4', 'e5', 'Nf3', 'Nc6']);
  const anchor = mainLineFrom(game)[1].id;
  let f = calcFollow(game, anchor, []);
  assert.equal(f.all, true, 'no moves: nothing new');
  assert.equal(f.end.id, anchor);
  assert.equal(f.end.children[0].san, 'Nf3', 'the line\'s next move');
  f = calcFollow(game, anchor, ['Nf3', 'Nc6']);
  assert.equal(f.all, true, 'the game\'s own moves: nothing new to keep');
  assert.deepEqual(f.nodes.map((n) => n.san), ['Nf3', 'Nc6']);
  assert.equal(f.end.children.length, 0, 'the end of the game');
  f = calcFollow(game, anchor, ['Nf3', 'd6', 'd4']);
  assert.equal(f.all, false, 'd6 is new');
  assert.deepEqual(f.nodes.map((n) => n.san), ['Nf3']);
  assert.equal(f.end, null, 'off the tree: no next move to follow');
  assert.equal(calcFollow(game, 'gone', ['Nf3']).all, false);
});

// ---------- The key ----------

test('V turns it on and off: X is still Flip the board, and V is no pen letter', () => {
  const map = shortcutMap({});
  assert.equal(map[keyToken({ key: 'v', code: 'KeyV' })], 'captureCalc');
  assert.equal(map[keyToken({ key: 'V', code: 'KeyV', shiftKey: true })], 'captureCalc');
  assert.equal(map.x, 'flipBoard');
  for (const profile of ['default', 'review', 'sequential', 'strategic']) assert.equal(isReviewPenKey(profile, 'v'), false);
  // No other key's default is V.
  assert.deepEqual(SHORTCUTS.filter((s) => s.default === 'v').map((s) => s.id), ['captureCalc']);
});

test('a key you already gave V to keeps it: the calculator\'s new default never takes it over', () => {
  // A pen held on V (Settings > Keyboard, before this update): V draws blue, the calculator has no key.
  let settings = { shortcuts: { penBlue: 'v' } };
  assert.equal(shortcutMap(settings).v, 'penBlue');
  assert.equal(shortcutKey(settings, 'penBlue'), 'v');
  assert.equal(shortcutKey(settings, 'captureCalc'), '', 'shown as no key (-) in Settings > Keyboard, where one can be given it');
  assert.equal(Object.values(shortcutMap(settings)).includes('captureCalc'), false);
  // The evaluation bar moved to V: V is the evaluation bar, and B (its old key) does nothing.
  settings = { shortcuts: { toggleEvalBar: 'V' } };
  assert.equal(shortcutMap(settings).v, 'toggleEvalBar');
  assert.equal(shortcutKey(settings, 'captureCalc'), '');
  // Given a key of its own, the calculator has it, beside the other's V.
  settings = { shortcuts: { toggleEvalBar: 'v', captureCalc: 'g' } };
  assert.equal(shortcutMap(settings).v, 'toggleEvalBar');
  assert.equal(shortcutMap(settings).g, 'captureCalc');
  // Nobody else on V: the calculator's V, and every other default as it was.
  settings = { shortcuts: { penBlue: 'q' } };
  assert.equal(shortcutMap(settings).v, 'captureCalc');
  assert.equal(shortcutMap(settings).q, 'penBlue');
  for (const s of SHORTCUTS) if (s.id !== 'penBlue') assert.equal(shortcutKey(settings, s.id), s.default, s.id);
  // A key you set beats any default it lands on, not just V (X, Flip the board, here).
  settings = { shortcuts: { penGreen: 'x' } };
  assert.equal(shortcutMap(settings).x, 'penGreen');
  assert.equal(shortcutKey(settings, 'flipBoard'), '');
});

// ---------- The card ----------

const { transformSync } = createRequire(import.meta.resolve('vite/package.json'))('esbuild');
registerHooks({
  load(url, context, next) {
    if (!url.endsWith('.jsx')) return next(url, context);
    const { code } = transformSync(readFileSync(fileURLToPath(url), 'utf8'), { loader: 'jsx', format: 'esm', jsx: 'transform' });
    return { format: 'module', source: code, shortCircuit: true };
  },
});
const { default: CaptureCalc, readHideCount, writeHideCount } = await import('../src/components/CaptureCalc.jsx');

const card = (id, props = {}) => {
  const c = cases.find((x) => x.id === id);
  const line = calcLine(c.fen, c.moves);
  const count = calcCount(line, c.at ?? c.moves.length);
  return renderToStaticMarkup(React.createElement(CaptureCalc, {
    line, count, start: startText(null, sideToMove(c.fen)), keyName: 'V', onKeep: () => {}, ...props,
  }));
};
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '\'').replace(/\s+/g, ' ').trim();

test('the card: start, moves with what they took, balance, bar, what changed hands, status and verdict', () => {
  const html = card('looks-good-loses');
  const t = text(html);
  assert.match(t, /^Capture Calculator Done Start: this position, White to move/);
  assert.match(t, /15\. Bxh7\+ takes a pawn \+1/);
  assert.match(t, /15\.\.\.Kxh7 takes a bishop \+3/);
  assert.match(t, /Black \+2 White Black/, 'the balance, then the bar\'s two sides');
  assert.match(text(card('looks-good-loses', { you: 'white' })), /Black \+2 White \(you\) Black/, '(you) on your side of the bar');
  assert.match(t, /White took: pawn \(1\) Black took: bishop \(3\)/);
  assert.match(t, /Trades finished\. Black comes out ahead by 2\./);
  assert.match(t, /Hide the count Keep as a side line$/);
  assert.match(html, /class="calc-balance" aria-live="polite"/);
  assert.match(html, /class="calc-bar-fill b" style="left:50%;width:10%"/, 'Black +2: a fifth of Black\'s half');
  assert.match(html, /title="Turn off the Capture Calculator \(V\)"/);
  assert.match(html, /aria-label="Capture Calculator"/);
});

test('the card: (you), the board\'s point in the line, and the moves after it', () => {
  const t = text(card('looks-good-loses-you-black', { you: 'black' }));
  assert.match(t, /Black \(you\) \+2/);
  assert.match(t, /Black \(you\) took: bishop \(3\)/);
  assert.match(t, /Black comes out ahead by 2\./);
  const html = card('step-back-mid-sequence');
  assert.equal((html.match(/calc-move current/g) ?? []).length, 1);
  assert.match(html, /aria-current="step"[^>]*>.{0,80}5\.\.\.Bxd1/);
  assert.equal((html.match(/calc-move[^"]* ahead/g) ?? []).length, 3, 'three moves after the board, quieter');
  assert.match(text(html), /Not finished: White can take back on d1\./);
  assert.doesNotMatch(text(html), /comes out ahead/);
});

test('Hide the count: the moves and the status stay; points, balance, bar, what changed hands and verdict go', () => {
  const t = text(card('looks-good-loses', { hidden: true }));
  assert.match(t, /15\. Bxh7\+ takes a pawn 15\.\.\.Kxh7 takes a bishop/);
  assert.match(t, /Count hidden: work it out in your head first\./);
  assert.match(t, /Trades finished\./);
  assert.match(t, /Show the count/);
  for (const gone of ['+1', '+3', 'Black +2', 'took:', 'comes out ahead', 'Hide the count']) assert.ok(!t.includes(gone), gone);
  assert.doesNotMatch(card('looks-good-loses', { hidden: true }), /calc-bar/);
  // Promotions too.
  assert.doesNotMatch(text(card('promotion-quiet', { hidden: true })), /promoted|\+8/);
  assert.match(text(card('promotion-quiet')), /White took: nothing White promoted: queen \(\+8\) Black took: nothing/, 'each side\'s promotion after what it took');
});

test('the card before a move, before a capture, and where nothing can be kept', () => {
  const none = text(card('no-captures-yet'));
  assert.match(none, /No captures yet\./);
  assert.doesNotMatch(none, /took:/);
  assert.match(none, /Even/);
  const start = text(card('step-back-to-start'));
  assert.match(start, /No captures yet\./);
  const empty = renderToStaticMarkup(React.createElement(CaptureCalc, {
    line: calcLine('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', []),
    count: calcCount(calcLine('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [])),
    start: 'Start: this position, White to move',
    onKeep: () => {},
  }));
  assert.match(text(empty), /Play moves for both sides on the board\./);
  assert.doesNotMatch(empty, /Keep as a side line/, 'nothing to keep yet');
  assert.doesNotMatch(card('simple-trade', { onKeep: null }), /Keep as a side line/);
  assert.match(text(card('checkmate-in-line')), /Checkmate\. The count doesn’t matter now\./);
});

test('Hide the count is remembered on this device, and a browser that refuses storage is fine', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    assert.equal(readHideCount(), false);
    writeHideCount(true);
    assert.equal(readHideCount(), true);
    assert.deepEqual([...store.keys()], ['rl.captureCalc.hideCount']);
    writeHideCount(false);
    assert.equal(readHideCount(), false);
    globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
    assert.equal(readHideCount(), false);
    writeHideCount(true);
  } finally {
    delete globalThis.localStorage;
  }
});

// ---------- What's drawn while it's on ----------
// The analysis board sends every drawing change through drawingsHere +
// applyDrawing (src/views/AnalysisView.jsx updateMarks / clearMarks), so
// these are the board's own rules: the calculator first, a saved game's Game
// Review never while it's on — above all a student's game, whose review is
// sent to the student.

const GREEN = '#15781B';
const arrow = (f, t) => (m) => ({ ...m, arrows: [...m.arrows, [f, t, GREEN]] });
const arrowsOf = (m) => (m?.arrows ?? []).map((a) => a[0] + a[1]);
// React's setters, run on plain values: an updater is applied at once.
const box = (v) => {
  const b = { v, calls: 0 };
  b.set = (u) => { b.calls += 1; b.v = typeof u === 'function' ? u(b.v) : u; };
  return b;
};
// A made-up French: 8...O-O is ply 16; 9.Re1 is ply 17.
const FRENCH = 'e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5 c3 Nc6 Ngf3 Be7 O-O O-O Re1 f6 exf6 Nxf6'.split(' ');
const fenAfter = (n) => calcLine('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', FRENCH.slice(0, n)).fens[n];

test('where a drawing goes: the calculator first, whatever the game\'s Game Review holds there', () => {
  const calc = calcStart({ anchorId: 'n16', anchorFen: fenAfter(16) });
  for (const ref of [0, 16, [12, 'd3h7']]) {
    assert.equal(drawTarget(calc, ref), 'calc', `calculator on, review ref ${JSON.stringify(ref)}`);
    assert.equal(drawTarget(null, ref), 'review', `calculator off, review ref ${JSON.stringify(ref)}`);
  }
  assert.equal(drawTarget(null, null), 'board');
  assert.equal(drawTarget(calc, null), 'calc');
});

test('while it\'s on, nothing drawn reaches a student\'s Game Review: arrows, squares, Clear', () => {
  // A student's own game, its review already holding an arrow at 8...O-O.
  const fen = fenAfter(16);
  const reviewAn = setMarksAt('', 16, { arrows: [['c1', 'h6', GREEN]], squares: {} });
  const r0 = reviewOnBoard({ tree: makeTree(FRENCH), moves: FRENCH, records: { an: reviewAn } });
  const node16 = mainLineFrom(r0.tree)[15].id;
  assert.deepEqual(arrowsOf(r0.drawn[node16]), ['c1h6'], 'the review has its arrow');
  const review = box(reviewAn);
  const sent = [];
  const io = (calcBox, ann) => ({
    fen,
    annotations: ann.v,
    setCalc: calcBox.set,
    setAnnotations: ann.set,
    // What the board does with it: write the record (and, on a student's
    // game, send it a few seconds later).
    writeReviewMarks: (ref, next) => { sent.push(ref); review.set((an) => setMarksAt(an, ref, next)); },
  });
  const calc = box(calcStart({ anchorId: node16, anchorFen: fen }));
  const ann = box({});
  // Even handed the move's review ref (the board passes null while it's on).
  for (const ref of [16, null]) {
    const here = drawingsHere({
      calc: calc.v, fen, annotations: ann.v, reviewRef: ref, reviewDrawn: r0.drawn[node16], join: marksWith,
    });
    assert.equal(here.to, 'calc');
    assert.equal(here.reviewRef, null);
    assert.deepEqual(arrowsOf(here.editable), arrowsOf(calc.v.marks[fen]), 'the drag preview and Clear see its copy only');
    assert.equal(applyDrawing(here, { ...io(calc, ann), fn: arrow('d3', 'h7') }), 'calc');
    assert.equal(applyDrawing(here, { ...io(calc, ann), fn: (m) => ({ ...m, squares: { ...m.squares, h7: GREEN } }) }), 'calc');
  }
  assert.deepEqual(arrowsOf(calc.v.marks[fen]), ['d3h7', 'd3h7']);
  assert.equal(calc.v.marks[fen].squares.h7, GREEN);
  // Clear (and the click on the board that clears) is a change like any other.
  const cleared = drawingsHere({ calc: calc.v, fen, annotations: ann.v, reviewRef: 16 });
  applyDrawing(cleared, { ...io(calc, ann), fn: () => ({ arrows: [], squares: {} }) });
  assert.deepEqual(calc.v.marks[fen], { arrows: [], squares: {} });
  assert.deepEqual(sent, [], 'no write to the Game Review');
  assert.equal(review.v, reviewAn, 'the review record is exactly as it was');
  assert.equal(review.calls, 0);
  assert.deepEqual(ann.v, {}, 'and nothing on the board\'s own drawings either');
  // Off again: a drawing on the game's move goes into its Game Review, as before.
  const off = drawingsHere({
    calc: null, fen, annotations: ann.v, reviewRef: 16, reviewDrawn: r0.drawn[node16], join: marksWith,
  });
  assert.equal(off.to, 'review');
  assert.deepEqual(arrowsOf(off.editable), ['c1h6'], 'the review\'s drawn arrows are part of the set changed');
  applyDrawing(off, { ...io(calc, ann), fn: arrow('d3', 'h7') });
  assert.deepEqual(sent, [16]);
  const r1 = reviewOnBoard({ tree: makeTree(FRENCH), moves: FRENCH, records: { an: review.v } });
  assert.deepEqual(arrowsOf(r1.drawn[mainLineFrom(r1.tree)[15].id]), ['c1h6', 'd3h7']);
});

test('your drawings show in the calculator, and Keep as a side line adds to them (never replaces)', () => {
  // verify-rl's case: a2-a4 and h2-h4 drawn at 9.Re1; the calculator, from
  // 8...O-O, follows 9.Re1, plays 9...a6, steps back, draws b2-b4, keeps.
  const at16 = fenAfter(16);
  const at17 = fenAfter(17);
  const game = makeTree(FRENCH);
  const node16 = mainLineFrom(game)[15].id;
  const ann = box({ [at17]: { arrows: [['a2', 'a4', GREEN], ['h2', 'h4', GREEN]], squares: {} } });
  let calc = calcStart({ anchorId: node16, anchorFen: at16 });
  calc = calcPlay(calc, 'Re1');
  calc = calcPlay(calc, 'a6');
  calc = calcStep(calc, 1);
  const line = calcLine(calc.anchorFen, calc.sans);
  assert.equal(line.fens[1], at17, 'the calculator\'s 9.Re1 is the game\'s position');
  assert.deepEqual(arrowsOf(calcMarksAt(calc, at17, ann.v)), ['a2a4', 'h2h4'], 'your two arrows show');
  assert.deepEqual(arrowsOf(drawingsHere({ calc, fen: at17, annotations: ann.v }).marks), ['a2a4', 'h2h4']);
  const c = box(calc);
  applyDrawing(drawingsHere({ calc: c.v, fen: at17, annotations: ann.v }), {
    fen: at17, annotations: ann.v, fn: arrow('b2', 'b4'), setCalc: c.set, setAnnotations: ann.set, writeReviewMarks: () => assert.fail('no review'),
  });
  assert.deepEqual(arrowsOf(c.v.marks[at17]), ['a2a4', 'h2h4', 'b2b4'], 'drawn onto them');
  assert.deepEqual(arrowsOf(ann.v[at17]), ['a2a4', 'h2h4'], 'the board\'s own untouched while it\'s on');
  // Keep: all three at 9.Re1.
  const kept = calcKeepMarks(ann.v, c.v, line.fens);
  assert.deepEqual(arrowsOf(kept[at17]), ['a2a4', 'h2h4', 'b2b4']);
  // Turned off instead: the board's own as they were.
  assert.deepEqual(arrowsOf(ann.v[at17]), ['a2a4', 'h2h4']);
});

test('Keep as a side line\'s drawings: the kept line\'s positions only; added to yours, never taken away', () => {
  const at16 = fenAfter(16);
  const at17 = fenAfter(17);
  let calc = calcStart({ anchorId: 'n16', anchorFen: at16 });
  calc = calcPlay(calc, 'Bxh7+');
  const h7 = calcLine(at16, ['Bxh7+']).fens[1];
  calc = calcDraw(calc, h7, {}, arrow('g8', 'h7'));
  calc = calcStep(calc, 0);
  calc = calcPlay(calc, 'Re1'); // replaces Bxh7+: its drawing isn't on the kept line
  calc = calcDraw(calc, at16, {}, () => ({ arrows: [], squares: {} })); // the start cleared
  const ann = {
    [at16]: { arrows: [['a2', 'a3', GREEN]], squares: {} },
    [at17]: { arrows: [['h2', 'h3', GREEN]], squares: {} },
    other: { arrows: [['b1', 'c3', GREEN]], squares: {} },
  };
  calc = calcStep(calc, 1);
  calc = calcDraw(calc, at17, ann, (m) => ({
    arrows: [...m.arrows.filter((a) => a[0] !== 'h2'), ['g2', 'g4', '#882020']], squares: { g4: '#882020' },
  }));
  const line = calcLine(calc.anchorFen, calc.sans);
  const kept = calcKeepMarks(ann, calc, line.fens);
  assert.deepEqual(arrowsOf(kept[at16]), ['a2a3'], 'cleared in the calculator (scratch): yours stay when kept');
  assert.deepEqual(arrowsOf(kept[at17]), ['g2g4', 'h2h3'], 'one taken off in it stays yours; the new one is added');
  assert.equal(kept[at17].squares.g4, '#882020');
  // The same arrow in both: one arrow, in the calculator's colour.
  const twice = calcKeepMarks({ f: { arrows: [['a2', 'a4', GREEN]], squares: { a4: GREEN } } },
    { marks: { f: { arrows: [['a2', 'a4', '#882020']], squares: { a4: '#882020' } } } }, ['f']);
  assert.deepEqual(twice.f, { arrows: [['a2', 'a4', '#882020']], squares: { a4: '#882020' } });
  // Never drawn on in it: yours as they were.
  assert.deepEqual(calcKeepMarks(ann, calcStart({ anchorFen: at16 }), line.fens), ann);
  assert.equal(kept[h7], undefined, 'drawn on a move replaced since: not kept');
  assert.deepEqual(arrowsOf(kept.other), ['b1c3'], 'elsewhere: untouched');
  assert.deepEqual(arrowsOf(ann[at16]), ['a2a3'], 'the drawings it was given are left as they were');
  assert.deepEqual(calcKeepMarks(ann, null, line.fens), ann);
});

test('outside the calculator the board\'s own drawings work as before', () => {
  const fen = fenAfter(16);
  const ann = box({ [fen]: { arrows: [['a2', 'a4', GREEN]], squares: {} } });
  const here = drawingsHere({ calc: null, fen, annotations: ann.v, reviewRef: null });
  assert.deepEqual([here.to, arrowsOf(here.editable), here.reviewRef], ['board', ['a2a4'], null]);
  assert.equal(applyDrawing(here, {
    fen, annotations: ann.v, fn: arrow('h2', 'h4'), setCalc: () => assert.fail('no calculator'), setAnnotations: ann.set, writeReviewMarks: () => assert.fail('no review'),
  }), 'board');
  assert.deepEqual(arrowsOf(ann.v[fen]), ['a2a4', 'h2h4']);
  // A position with nothing drawn: empty, never undefined.
  assert.deepEqual(drawingsHere({ fen: 'x' }).editable, { arrows: [], squares: {} });
  assert.deepEqual(calcMarksAt(calcStart({ anchorFen: 'x' }), 'x', {}), { arrows: [], squares: {} });
  assert.equal(calcDraw(null, 'x', {}, arrow('a2', 'a4')), null, 'turned off meanwhile: nothing');
});

test('the tree\'s move the calculator stands on: its start, then the game\'s moves while it follows them', () => {
  const game = makeTree(FRENCH);
  const main = mainLineFrom(game);
  let calc = calcStart({ anchorId: main[15].id, anchorFen: fenAfter(16) });
  assert.equal(calcNodeAt(game, calc), main[15].id, 'at its start: the move it was turned on at');
  calc = calcPlay(calcPlay(calc, 'Re1'), 'f6');
  assert.equal(calcNodeAt(game, calc), main[17].id, 'following the game: the game\'s 9...f6');
  assert.equal(calcNodeAt(game, calc, 1), main[16].id);
  calc = calcPlay(calcStep(calc, 1), 'a6');
  assert.equal(calcNodeAt(game, calc), null, 'off the game: a position only it has');
  assert.equal(calcNodeAt(game, null), null);
});

// ---------------------------------------------------------------------------
// The engine's view, under the count: who stands better, and where that and
// the count part ways.
// ---------------------------------------------------------------------------
const cp = (value) => ({ type: 'cp', value });
const mate = (value) => ({ type: 'mate', value });

test('the engine\'s score in words, as a number and as a share of the bar', () => {
  assert.equal(evalSide(null), null);
  assert.equal(evalSide(cp(20)), null, 'a fifth of a pawn: nobody is better');
  assert.equal(evalSide(cp(-29)), null);
  assert.equal(evalSide(cp(30)), 'w');
  assert.equal(evalSide(cp(-140)), 'b');
  assert.equal(evalSide(mate(-3)), 'b');
  assert.equal(evalText(cp(10)), 'About even');
  assert.equal(evalText(cp(60)), 'White is a little better');
  assert.equal(evalText(cp(-140)), 'Black is better');
  assert.equal(evalText(cp(-140), 'black'), 'Black (you) is better');
  assert.equal(evalText(cp(520)), 'White is winning');
  assert.equal(evalText(mate(-3)), 'Black mates in 3');
  assert.equal(evalText({ ...mate(1), over: true }), 'White has checkmated');
  assert.equal(evalText(null), '');
  assert.equal(evalNumber(cp(140)), '+1.4');
  assert.equal(evalNumber(cp(-60)), '\u22120.6');
  assert.equal(evalNumber(cp(3)), '0.0');
  assert.equal(evalNumber(mate(-3)), 'M3');
  assert.equal(evalShare(null), 50);
  assert.equal(evalShare(cp(0)), 50);
  assert.ok(evalShare(cp(150)) > 55 && evalShare(cp(150)) < 80);
  assert.ok(Math.abs(evalShare(cp(150)) + evalShare(cp(-150)) - 100) < 1e-9, 'the same either way');
  assert.equal(evalShare(mate(2)), 97);
  assert.equal(evalShare(mate(-2)), 3);
});

test('where the count and the engine part ways, the card says so; where they agree, it says nothing', () => {
  assert.equal(evalVersusCount(2, cp(-140)), 'White is up 2 in material, but Black has the better position.');
  assert.equal(evalVersusCount(2, cp(-140), 'white'), 'White (you) is up 2 in material, but Black has the better position.');
  assert.equal(evalVersusCount(-3, cp(10)), 'Black is up 3 in material, but the position is about even.');
  assert.equal(evalVersusCount(0, cp(220)), 'The count is even, but White has the better position.');
  assert.equal(evalVersusCount(-1, mate(4)), 'Black is up 1 in material, but White has the better position.');
  assert.equal(evalVersusCount(2, cp(180)), null, 'ahead, and better');
  assert.equal(evalVersusCount(0, cp(5)), null, 'even, and even');
  assert.equal(evalVersusCount(2, null), null, 'no score yet');
});

test('the card shows the engine\'s view under the count, and hides it with the count', () => {
  const c = cases.find((x) => x.id === 'looks-good-loses');
  const line = calcLine(c.fen, c.moves);
  const draw = (extra = {}) => renderToStaticMarkup(React.createElement(CaptureCalc, {
    line, count: calcCount(line, c.moves.length), start: 'Start: this position', ...extra,
  }));
  const none = draw();
  assert.ok(!none.includes('calc-eval'), 'no engine given: the card as it was');
  const waiting = draw({ engine: { now: null, before: null } });
  assert.ok(waiting.includes('calc-eval') && waiting.includes('working it out'));
  const html = draw({ engine: { now: cp(-140), before: cp(30) } });
  assert.ok(html.includes('Black is better'), html);
  assert.ok(html.includes('\u22121.4'));
  assert.ok(html.includes('calc-bar-eval'));
  assert.ok(/calc-bar-fill b/.test(html.slice(html.indexOf('calc-bar-eval'))), 'the bar leans Black\'s way');
  assert.ok(html.includes('Before these moves: White is a little better (+0.3).'), html);
  // Whoever the count favours here, an engine that prefers the other side is said to disagree — and one that agrees isn't.
  const bal = calcCount(line, c.moves.length).balance;
  assert.notEqual(bal, 0, 'this case ends with one side ahead');
  const against = draw({ engine: { now: cp(bal > 0 ? -140 : 140), before: cp(0) } });
  assert.ok(against.includes(`but ${bal > 0 ? 'Black' : 'White'} has the better position`), against);
  assert.ok(!draw({ engine: { now: cp(bal > 0 ? 140 : -140), before: cp(0) } }).includes('has the better position'));
  assert.ok(draw({ engine: { now: cp(2), before: cp(2) } }).includes('Before these moves: about even (0.0).'));
  const hidden = draw({ engine: { now: cp(-140), before: cp(30) }, hidden: true });
  assert.ok(!hidden.includes('calc-eval'), 'Hide the count hides the engine\'s view too');
  // At the start there is no "before" to set it against.
  const start = renderToStaticMarkup(React.createElement(CaptureCalc, {
    line, count: calcCount(line, 0), start: 'Start', engine: { now: cp(30), before: cp(30) },
  }));
  assert.ok(start.includes('White is a little better') && !start.includes('Before these moves'));
  assert.ok(!start.includes('has the better position'), 'nothing has changed hands yet: no count to set it against');
});
