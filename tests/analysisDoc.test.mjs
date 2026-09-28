// A game's analysis as one document — what a coach's review is kept and sent
// as — and its way back into a game's own fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  docFromGame, gameFieldsFromDoc, diffGameFields, sanitizeDoc, parseDoc, serializeDoc, docIsEmpty, docBytes,
} from '../src/lib/analysisDoc.js';
import {
  makeTree, addMove, mainLineFrom, notesOnNodes, gameLineOf, hasVariations,
} from '../src/lib/moveTree.js';

const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'];
const fen2 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

test('a game’s own fields and the document agree both ways, variation notes included', () => {
  // A saved tree with a variation after 1...e5 (2.Nc3), a note on it.
  let t = makeTree(moves);
  const e5 = gameLineOf(t, 2)[1];
  const r = addMove(t, e5.id, 'Nc3');
  t = r.tree;
  const withNote = JSON.parse(JSON.stringify(t));
  const findIn = (n, id) => (n.id === id ? n : n.children.map((c) => findIn(c, id)).find(Boolean));
  findIn(withNote, r.nodeId).note = 'The Vienna is fine too.';
  const game = {
    moves,
    comments: { '-1': 'A clean Ruy.', 2: 'Develops and attacks e5.' },
    badges: { 4: 'good' },
    annotations: { [fen2]: { arrows: [['g1', 'f3', '#2ecc71']], squares: {} }, empty: { arrows: [], squares: {} } },
    tree: withNote,
    variationHighlights: { [r.nodeId]: 'green' },
  };
  const doc = docFromGame(game);
  const { notes, badges } = notesOnNodes(doc.tree);
  const line = gameLineOf(doc.tree, moves.length);
  assert.equal(notes.root, 'A clean Ruy.');
  assert.equal(notes[line[2].id], 'Develops and attacks e5.');
  assert.equal(badges[line[4].id], 'good');
  assert.equal(notes[r.nodeId], 'The Vienna is fine too.');
  assert.deepEqual(Object.keys(doc.annotations), [fen2]); // the empty one pruned

  const back = gameFieldsFromDoc(doc);
  assert.deepEqual(back.comments, { 2: 'Develops and attacks e5.', [-1]: 'A clean Ruy.' });
  assert.deepEqual(back.badges, { 4: 'good' });
  assert.ok(back.tree, 'kept: it has a variation');
  // Notes on the game line stay in comments, not on the saved tree's nodes.
  assert.equal(notesOnNodes(back.tree).notes[r.nodeId], 'The Vienna is fine too.');
  assert.equal(Object.keys(notesOnNodes(back.tree).notes).length, 1);
});

test('a plain game with only move notes saves no tree', () => {
  const doc = docFromGame({ moves, comments: { 0: 'Best by test.' } });
  const f = gameFieldsFromDoc(doc);
  assert.equal(f.tree, undefined);
  assert.deepEqual(f.comments, { 0: 'Best by test.' });
});

test('a save writes only what changed since the board opened', () => {
  const before = { comments: { 0: 'a', 1: 'b' }, badges: { 2: 'good' }, annotations: {} };
  const after = { comments: { 0: 'a', 1: 'b!' }, badges: {}, annotations: { [fen2]: { arrows: [], squares: { e4: '#fff' } } } };
  const d = diffGameFields(before, after);
  assert.deepEqual(d.set.comments, { 1: 'b!' });
  assert.deepEqual(d.del.badges, ['2']);
  assert.ok(d.set.annotations[fen2]);
  assert.equal(d.tree, undefined);
  assert.equal(diffGameFields(before, before).changes, 0);
});

test('a corrected game keeps the old analysis as a variation', () => {
  const doc = docFromGame({ moves, comments: { 3: 'Main line.' } });
  const json = serializeDoc(doc);
  const corrected = ['e4', 'e5', 'Nf3', 'd6'];
  const again = sanitizeDoc({ ...JSON.parse(json), moves: corrected });
  assert.deepEqual(mainLineFrom(again.tree).map((n) => n.san), corrected);
  assert.ok(hasVariations(again.tree));
  assert.ok(Object.values(notesOnNodes(again.tree).notes).includes('Main line.'));
});

test('a document from another account is rebuilt, never trusted', () => {
  const raw = {
    moves: ['e4', 'e5', 'Ke3', 'Nf6'], // stops at the illegal move
    startFen: undefined,
    tree: {
      id: '__proto__',
      note: 'x'.repeat(9000),
      badge: 'not-a-badge',
      evil: { __x__: 1 },
      children: [
        { id: '__x__', san: 'e4', note: 7, children: [{ id: 'n2', san: 'c5', children: [] }, { id: 'n3', san: 'e5', badge: 'good', children: [] }] },
        { id: 'n4', san: 'Nf9', children: [] },
      ],
    },
    annotations: { '': { arrows: [['e2', 'e4', 'red']] }, __a__: {}, [fen2]: { arrows: [['e9', 'e4', '#000'], ['g1', 'f3', '#2ecc71']], squares: { zz: '#fff', e4: 'javascript:1' } } },
    variationHighlights: { n2: 'green', ghost: 'blue', n3: 'purple' },
    extra: 'dropped',
  };
  const doc = sanitizeDoc(raw);
  assert.deepEqual(doc.moves, ['e4', 'e5']);
  assert.equal(doc.tree.id, 'root');
  assert.equal(doc.tree.note.length, 5000);
  assert.equal(doc.tree.badge, undefined);
  assert.equal(doc.evil, undefined);
  assert.equal(doc.extra, undefined);
  const e4 = doc.tree.children.find((c) => c.san === 'e4');
  assert.match(e4.id, /^[A-Za-z0-9]/); // "__x__" replaced
  assert.equal(e4.note, undefined); // not a string
  assert.equal(doc.tree.children.some((c) => c.san === 'Nf9'), false);
  assert.deepEqual(Object.keys(doc.annotations), [fen2]);
  assert.deepEqual(doc.annotations[fen2], { arrows: [['g1', 'f3', '#2ecc71']], squares: {} });
  assert.deepEqual(doc.variationHighlights, { n2: 'green' });
  // Nothing in it has a key Firestore would refuse.
  const keys = [];
  const walk = (v) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); } };
  walk(doc);
  assert.ok(keys.every((k) => k !== '' && !/^__.*__$/.test(k)));
  assert.equal(parseDoc('{not json'), null);
  assert.equal(parseDoc(serializeDoc(doc)).moves.length, 2);
});

test('empty and size', () => {
  assert.ok(docIsEmpty(docFromGame({ moves })));
  assert.ok(!docIsEmpty(docFromGame({ moves, badges: { 0: 'good' } })));
  assert.equal(docBytes('♘'), 3);
});
