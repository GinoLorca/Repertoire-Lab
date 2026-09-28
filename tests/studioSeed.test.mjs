// Where Studio starts on a saved game: from the store, and — for a linked
// student's own game — in the coach's review of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedFor } from '../src/lib/studioSeed.js';
import { hashesOf } from '../src/lib/cloud/gameLink.js';
import { notesOnNodes, gameLineOf } from '../src/lib/moveTree.js';
import { parseDoc, serializeDoc, docFromGame } from '../src/lib/analysisDoc.js';

const moves = ['d4', 'd5', 'Nc3', 'Nf6', 'Bf4'];
const S = 'studentUid1';
const card = (games, extra = {}) => ({ id: 'card1', kind: 'student', name: 'Parker', profile: { linkedUid: S }, games, ...extra });

test('the coach’s own game, or one typed for a student, edits the game’s own fields', () => {
  const g = { id: 'g1', moves, comments: { 1: 'Solid.' }, badges: { 4: 'good' } };
  const seed = seedFor([{ id: 'me', kind: 'self', name: 'Me', games: [g] }], { playerId: 'me', gameId: 'g1' });
  assert.equal(seed.reviewMode, false);
  assert.equal(seed.linked, false);
  assert.deepEqual(seed.fields.comments, { 1: 'Solid.' });
  const typed = { ...g, link: { uid: S, base: {} } }; // no origin: the coach typed it in
  assert.equal(seedFor([card([typed])], { playerId: 'card1', gameId: 'g1' }).reviewMode, false);
});

test('a linked student’s own game opens the coach’s review, with the student’s notes beside it', () => {
  // The student's copy said "My idea" at move 1; the coach, before reviews
  // existed, wrote "Coach: fine" at move 3 on their copy — which never went.
  const student = { id: 'g2', moves, comments: { 1: 'My idea' } };
  const mirror = {
    ...student,
    comments: { 1: 'My idea', 3: 'Coach: fine' },
    link: { uid: S, origin: 'student', base: hashesOf(student) },
  };
  const seed = seedFor([card([mirror])], { playerId: 'card1', gameId: 'g2' });
  assert.equal(seed.reviewMode, true);
  assert.equal(seed.linked, true);
  const line = gameLineOf(seed.tree, moves.length);
  // The coach's earlier note starts the review; the student's is theirs, shown beside it.
  assert.equal(seed.notes[line[3].id], 'Coach: fine');
  assert.equal(seed.notes[line[1].id], undefined);
  assert.equal(seed.theirNotes[line[1].id], 'My idea');
  // A saved review wins over that, and comes back whole.
  const review = docFromGame({ moves, comments: { 2: 'Reviewed.' } });
  const seeded = seedFor([card([{ ...mirror, review: { body: serializeDoc(review) } }])], { playerId: 'card1', gameId: 'g2' });
  const l2 = gameLineOf(seeded.tree, moves.length);
  assert.equal(seeded.notes[l2[2].id], 'Reviewed.');
  assert.equal(parseDoc(seeded.body).moves.length, moves.length);
  assert.equal(Object.keys(notesOnNodes(parseDoc(seeded.body).tree).notes).length, 1);
});

test('a card that isn’t linked to the student’s account keeps editing the game itself', () => {
  const g = { id: 'g3', moves, link: { uid: 'someoneElse', origin: 'student', base: {} } };
  assert.equal(seedFor([card([g])], { playerId: 'card1', gameId: 'g3' }).reviewMode, false);
  assert.equal(seedFor([card([g], { profile: {} })], { playerId: 'card1', gameId: 'g3' }).reviewMode, false);
  assert.equal(seedFor([card([])], { playerId: 'card1', gameId: 'nope' }), null);
});
