// Before & After moments — src/lib/moments.js — and how they ride along with
// a game's analysis (lib/analysisDoc) and to a linked student (lib/cloud/gameLink).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanMoments, nodeAt, canFollow, canBeBetter, movesBetween, fenAt, momentMarks, boardChange,
  materialLabel, carryMarks, canCarry, inGameOrder, MAX_MOMENTS, placeLabel, defaultTitle, movesText,
  scoreText, slotScore, swing, presentSteps, presentPlan, planStart,
} from '../src/lib/moments.js';
import {
  docFromGame, gameFieldsFromDoc, diffGameFields, sanitizeDoc, serializeDoc, parseDoc, docIsEmpty,
} from '../src/lib/analysisDoc.js';
import { makeTree, addMove, removeNode, keepMainLineOnly } from '../src/lib/moveTree.js';
import {
  getPath, setPath, ph, parsePatch, buildPatch, stableStringify,
} from '../src/lib/cloud/gameLink.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5'];

// The game, with 6.Nxe5 answered — and a Better line after 3...Nc6: 4.Bb5.
function gameTree() {
  let t = makeTree(moves);
  const nc6 = nodeAt(t, moves.slice(0, 4));
  t = addMove(t, nc6.id, 'Bb5').tree;
  return t;
}
const moment = {
  id: 'k1',
  title: '4.Bc4 lets …Nd4 in',
  note: 'The knight on d4 is the start of it.',
  before: moves.slice(0, 4),
  after: moves,
  better: [...moves.slice(0, 4), 'Bb5'],
  evals: { before: { type: 'cp', value: 30 }, after: { type: 'cp', value: -250 }, better: { type: 'cp', value: 35 } },
};

test('places are found by the moves that lead there, exactly', () => {
  const t = gameTree();
  assert.equal(nodeAt(t, []).id, 'root');
  assert.equal(nodeAt(t, moves.slice(0, 2)).san, 'e5');
  assert.equal(nodeAt(t, [...moves.slice(0, 4), 'Bb5']).san, 'Bb5');
  // A move the tree doesn't have is no place at all — not the one before it.
  assert.equal(nodeAt(t, [...moves.slice(0, 4), 'Bb3']), null);
});

test('an After carries on from the Before; a Better does too, but off the way to the After', () => {
  const m = { before: moves.slice(0, 4), after: moves };
  assert.ok(canFollow(m.before, m.after));
  assert.ok(!canFollow(m.before, m.before)); // the same place isn't after it
  assert.ok(!canFollow(m.after, m.before)); // nor is an earlier one
  assert.ok(canBeBetter(m, [...moves.slice(0, 4), 'Bb5']));
  assert.ok(!canBeBetter(m, moves.slice(0, 6))); // on the way to the After
  assert.ok(!canBeBetter(m, [...moves, 'Qxg2'])); // past it
  assert.ok(!canBeBetter(m, ['d4'])); // not from the Before at all
  assert.deepEqual(movesBetween(m.before, m.after), ['Bc4', 'Nd4', 'Nxe5', 'Qg5']);
  assert.deepEqual(movesBetween(m.after, m.before), []);
});

test('a list from anywhere is rebuilt from what’s allowed, in game order', () => {
  const t = gameTree();
  const early = { id: 'k0', before: [], after: moves.slice(0, 2) };
  const out = cleanMoments([
    moment,
    early,
    { ...moment, id: 'k1' }, // the same id twice: the second gets a fresh one
    { id: 'bad1', before: moves, after: moves.slice(0, 2) }, // After before the Before
    { id: 'bad2', before: [], after: ['d4'] }, // a move the tree doesn't have
    { id: 'bad3', before: 'e4', after: moves }, // not a list
    { id: 'bad4', before: [], after: [42] },
    null,
    'nonsense',
    { id: '__proto__', before: [], after: ['e4'], title: 'x'.repeat(500), note: 7, evals: { before: { type: 'cp', value: 1.5 }, after: { type: 'mate', value: -3 } } },
  ], t);
  // In game order (by the Before, then the After); ties keep their order.
  assert.deepEqual(out.map((m) => m.id), ['m4', 'k0', 'k1', 'm3']);
  const odd = out.find((m) => m.after.length === 1);
  assert.equal(odd.title.length, 120);
  assert.equal(odd.note, undefined);
  assert.deepEqual(odd.evals, { after: { type: 'mate', value: -3 } }); // 1.5 isn't a centipawn count
  assert.deepEqual(out.find((m) => m.id === 'k1'), moment); // a good one comes back exactly
  assert.equal(new Set(out.map((m) => m.id)).size, out.length);
});

test('a Better that’s gone, or never was one, leaves its moment standing without it', () => {
  const t = gameTree();
  const [noBetter] = cleanMoments([{ ...moment, better: moves.slice(0, 6) }], t);
  assert.equal(noBetter.better, undefined);
  assert.equal(noBetter.evals.better, undefined);
  const [gone] = cleanMoments([moment], keepMainLineOnly(t));
  assert.equal(gone.better, undefined);
  assert.deepEqual(gone.after, moves);
});

test('taking a move out takes the moments standing on it', () => {
  const t = gameTree();
  const nd4 = nodeAt(t, moves.slice(0, 6));
  assert.deepEqual(cleanMoments([moment], removeNode(t, nd4.id)), []);
  assert.equal(cleanMoments([], t).length, 0);
  assert.deepEqual(cleanMoments('x', t), []);
  assert.deepEqual(cleanMoments([moment], null), []);
});

test('no more than the most there can be', () => {
  const t = gameTree();
  const many = Array.from({ length: 50 }, (_, i) => ({ id: `z${i}`, before: [], after: moves.slice(0, 1 + (i % 8)) }));
  assert.equal(cleanMoments(many, t).length, MAX_MOMENTS);
});

test('game order: by the Before, then the After', () => {
  const list = [{ before: ['e4'], after: ['e4', 'e5', 'Nf3'] }, { before: [], after: ['e4', 'e5'] }, { before: ['e4'], after: ['e4', 'e5'] }];
  assert.deepEqual(inGameOrder(list).map((m) => `${m.before.length}/${m.after.length}`), ['0/2', '1/2', '1/3']);
});

test('the move list knows which moves are a Before, an After or a Better, and of which moment', () => {
  const t = gameTree();
  const marks = momentMarks(t, [moment]);
  assert.deepEqual(marks[nodeAt(t, moves.slice(0, 4)).id], [{ role: 'before', n: 1 }]);
  assert.deepEqual(marks[nodeAt(t, moves).id], [{ role: 'after', n: 1 }]);
  assert.deepEqual(marks[nodeAt(t, [...moves.slice(0, 4), 'Bb5']).id], [{ role: 'better', n: 1 }]);
  assert.equal(Object.keys(marks).length, 3);
  // One move can be one moment's After and the next one's Before.
  const chained = momentMarks(t, [
    { before: moves.slice(0, 2), after: moves.slice(0, 4) },
    { before: moves.slice(0, 4), after: moves.slice(0, 6) },
  ]);
  assert.deepEqual(chained[nodeAt(t, moves.slice(0, 4)).id], [{ role: 'after', n: 1 }, { role: 'before', n: 2 }]);
  // The start isn't a move in the list.
  assert.equal(momentMarks(t, [{ before: [], after: ['e4'] }]).root, undefined);
});

test('saying where a moment is, the way a book numbers moves', () => {
  assert.equal(placeLabel([], START), 'Start');
  assert.equal(placeLabel(moves.slice(0, 4), START), '2…Nc6');
  assert.equal(placeLabel(moves.slice(0, 5), START), '3.Bc4');
  assert.equal(defaultTitle(moment, START), '3.Bc4');
  assert.equal(movesText(moment.before, moment.after, START), '3.Bc4 Nd4 4.Nxe5 Qg5');
  assert.equal(movesText(['e4'], moves, START), '1…e5 2.Nf3 Nc6 3.Bc4 Nd4 4.Nxe5 Qg5');
  assert.equal(movesText([], moves, START, { max: 5 }), '1.e4 e5 2.Nf3 … 4…Qg5');
  assert.equal(movesText([], moves.slice(0, 7), START, { max: 5 }), '1.e4 e5 2.Nf3 … 4.Nxe5');
  // From a set-up position with Black to move on move 12.
  const set = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 12';
  assert.equal(placeLabel(['Nf6'], set), '12…Nf6');
  assert.equal(defaultTitle({ before: [], after: ['Nf6', 'Nc3'] }, set), '12…Nf6');
});

test('scores, short, and which way they went for the side to move', () => {
  assert.equal(scoreText({ type: 'cp', value: 30 }), '+0.3');
  assert.equal(scoreText({ type: 'cp', value: -184 }), '−1.8');
  assert.equal(scoreText({ type: 'cp', value: 2 }), '0.0');
  assert.equal(scoreText({ type: 'mate', value: 3 }), '#3');
  assert.equal(scoreText({ type: 'mate', value: -2 }), '#−2');
  assert.equal(scoreText(null), '…');
  // A place that's already checkmate says so, scored or not.
  assert.equal(slotScore({ before: [], after: ['f3', 'e5', 'g4', 'Qh4#'] }, 'after', START), 'Mate');
  assert.equal(slotScore(moment, 'before', START), '+0.3');
  assert.equal(slotScore({ before: [], after: ['e4'] }, 'after', START), '…');
  // At 2…Nc6 it's White to move: +0.3 → −2.5 went badly for White.
  assert.deepEqual(swing(moment, START), { delta: -280, tone: 'worse' });
  assert.equal(swing(moment, START, 'better').tone, 'same');
  // Black to move at the Before: White's score going up is worse for Black.
  const black = { before: ['e4'], after: ['e4', 'e5', 'Nf3'], evals: { before: { type: 'cp', value: 20 }, after: { type: 'cp', value: 150 } } };
  assert.equal(swing(black, START).tone, 'worse');
  assert.equal(swing({ ...black, evals: { before: black.evals.before } }, START), null);
  const mated = { ...black, evals: { before: { type: 'cp', value: 20 }, after: { type: 'mate', value: -4 } } };
  assert.equal(swing(mated, START).tone, 'better');
});

test('what changed: the ghosts, what arrived, and the material', () => {
  const before = fenAt(START, moves.slice(0, 4));
  const after = fenAt(START, moves);
  const ch = boardChange(before, after);
  // The bishop left f1, the knights left f3 and c6, the e5 pawn was taken, the queen left d8.
  assert.deepEqual(ch.left.map((x) => `${x.piece}@${x.square}`), ['bN@c6', 'bQ@d8', 'bP@e5', 'wB@f1', 'wN@f3']);
  assert.deepEqual(ch.arrived.map((x) => `${x.piece}@${x.square}`), ['wB@c4', 'bN@d4', 'wN@e5', 'bQ@g5']);
  assert.deepEqual(ch.material, { from: 0, to: 1 });
  assert.equal(materialLabel(0), 'Material even');
  assert.equal(materialLabel(1), 'White +1');
  assert.equal(materialLabel(-3), 'Black +3');
  assert.equal(fenAt(START, ['e4', 'e4']), null);
});

test('carrying marks forward adds the Before’s to the After’s, which keep their own', () => {
  const a = 'A';
  const b = 'B';
  const annotations = {
    [a]: { arrows: [['d4', 'e6', '#2ecc71'], ['c3', 'd5', '#e5534b']], squares: { d5: 'rgba(229, 83, 75, 0.5)', f7: 'x' } },
    [b]: { arrows: [['c3', 'd5', '#3b9cff']], squares: { f7: 'y' } },
  };
  assert.ok(canCarry(annotations, a, b));
  const out = carryMarks(annotations, a, b);
  assert.deepEqual(out[b].arrows, [['c3', 'd5', '#3b9cff'], ['d4', 'e6', '#2ecc71']]);
  assert.deepEqual(out[b].squares, { d5: 'rgba(229, 83, 75, 0.5)', f7: 'y' });
  assert.deepEqual(out[a], annotations[a]); // the Before's own stay as they were
  assert.ok(!canCarry(out, a, b)); // nothing more to bring
  assert.ok(!canCarry({}, a, b));
  assert.deepEqual(carryMarks({}, a, b)[b], { arrows: [], squares: {} });
});

// ---------- In a game's analysis ----------

const game = () => ({ moves, comments: { 3: 'Fine.' }, badges: {}, tree: gameTree(), moments: [moment] });

test('a game’s moments go into its document and back into its own fields', () => {
  const doc = docFromGame(game());
  assert.deepEqual(doc.moments, [moment]);
  assert.ok(!docIsEmpty({ ...doc, tree: makeTree(moves), moments: [{ before: [], after: ['e4'] }] }));
  const fields = gameFieldsFromDoc(doc);
  assert.deepEqual(fields.moments, [moment]);
  assert.ok(fields.tree); // the Better lives in a variation, so the tree is kept
  // A game without any: no `moments` key at all, so its document is exactly
  // what it always was.
  const plain = docFromGame({ moves, comments: { 3: 'Fine.' } });
  assert.equal('moments' in plain, false);
  assert.equal(gameFieldsFromDoc(plain).moments, undefined);
});

test('a moment on the game line alone needs no tree kept', () => {
  const m = { id: 'k9', before: moves.slice(0, 2), after: moves.slice(0, 6) };
  const fields = gameFieldsFromDoc(docFromGame({ moves, moments: [m] }));
  assert.equal(fields.tree, undefined);
  assert.deepEqual(fields.moments, [m]);
  // …and finds its places again in the trunk rebuilt from the moves.
  assert.deepEqual(docFromGame({ moves, ...fields }).moments, [m]);
});

test('a save writes the moments with the tree they point into', () => {
  const before = gameFieldsFromDoc(docFromGame({ ...game(), moments: [] }));
  const after = gameFieldsFromDoc(docFromGame(game()));
  const diff = diffGameFields(before, after);
  assert.deepEqual(diff.tree.moments, [moment]);
  assert.equal(diffGameFields(after, after).tree, undefined);
  // Taking the last one away writes that too.
  assert.equal(diffGameFields(after, before).tree.moments, null);
});

test('a review sent to a student keeps its moments; one from elsewhere is checked like the rest', () => {
  const doc = docFromGame(game());
  const back = parseDoc(serializeDoc(doc));
  assert.deepEqual(back.moments, [moment]);
  const hostile = sanitizeDoc({
    ...JSON.parse(serializeDoc(doc)),
    moments: [moment, { id: 'x', before: [], after: ['e4', 'Ke7'] }, { before: { length: 3 }, after: [] }],
  });
  assert.deepEqual(hostile.moments, [moment]);
  assert.equal('moments' in sanitizeDoc({ moves, tree: {}, moments: 'lots' }), false);
});

// ---------- To a linked student ----------

test('a game without moments shares its tree exactly as before — nothing to re-send', () => {
  const g = { tree: gameTree(), variationHighlights: { x: 'green' } };
  assert.equal(ph(getPath(g, 'tree')), ph({ tree: g.tree, variationHighlights: g.variationHighlights }));
  assert.equal(getPath({}, 'tree'), undefined);
  assert.equal(getPath({ moments: [] }, 'tree'), undefined);
});

test('moments travel with the tree to the student and land there whole', () => {
  const coach = { id: 'abc123', moves, tree: gameTree(), moments: [moment], link: { uid: 's', base: {} } };
  const unit = getPath(coach, 'tree');
  assert.deepEqual(unit.moments, [moment]);
  const { patch } = buildPatch(coach);
  const parsed = parsePatch(JSON.stringify(patch));
  assert.ok(parsed);
  const student = setPath({ id: 'abc123', moves }, 'tree', parsed.set.tree);
  assert.deepEqual(student.moments, [moment]);
  assert.equal(ph(getPath(student, 'tree')), ph(unit));
  // A moment-only game (no variations) is a unit too, and clearing it clears them.
  const only = { moves, moments: [{ before: [], after: ['e4'] }] };
  assert.equal(getPath(only, 'tree').tree, null);
  assert.equal(setPath(student, 'tree', null).moments, undefined);
  assert.equal(setPath(student, 'tree', { tree: null, variationHighlights: null }).moments, undefined);
  // Something that isn't a list of them is refused.
  const bad = JSON.stringify({ from: { tree: '∅' }, set: { tree: { tree: null, moments: 'all of them' } } });
  assert.equal(parsePatch(bad), null);
  assert.equal(stableStringify(getPath(only, 'tree')).includes('"moments"'), true);
});

test('presenting: the Before, the moves played one by one, the After, then the Better', () => {
  // 2…Nc6 → 4…Qg5: four moves between, so three are played before the After lands.
  const steps = presentSteps(moment);
  assert.deepEqual(steps.map((x) => x.kind), ['before', 'play', 'play', 'play', 'after', 'better']);
  assert.deepEqual(steps.filter((x) => x.kind === 'play').map((x) => x.i), [1, 2, 3]);
  // Without the cover, straight to the After.
  assert.deepEqual(presentSteps(moment, { cover: false }).map((x) => x.kind), ['after', 'better']);
  // One move on: nothing to replay.
  assert.deepEqual(presentSteps({ before: [], after: ['e4'] }).map((x) => x.kind), ['before', 'after']);
  const plan = presentPlan([{ before: [], after: ['e4'] }, moment]);
  assert.equal(plan.length, 8);
  assert.deepEqual([plan[0].index, plan[2].index], [0, 1]);
  assert.equal(planStart(plan, 1), 2);
  assert.equal(planStart(plan, 5), 0);
});
