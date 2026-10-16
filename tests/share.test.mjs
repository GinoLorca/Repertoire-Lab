// What travels through the deliveries collection — src/lib/cloud/share.js:
// consent for games, whose an opening is, and lessons of Board Editor positions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibleGameDelivery, deliveryPayload, applyDelivery,
  lessonPosition, lessonPositions, lessonDocs, applyLesson, lessonTaken, isLesson, isAnyLesson, LESSON_MAX,
  lessonPlan, takenByLessonApp, lessonRecipient, canSendLesson, sendLessonToStudent, acceptDelivery, sendProblem,
} from '../src/lib/cloud/share.js';
import { recycledCopy, groupPositions, renameFolder } from '../src/lib/savedPositions.js';
import { server, resetServer } from './fakes/firebase.mjs';
import { mergeBackup } from '../src/lib/backup.js';

const d = (extra = {}) => ({ id: 'd1', kind: 'game', v: 1, fromUid: 'x', ...extra });

test('a game from a linked coach applies on its own', () => {
  assert.equal(eligibleGameDelivery(d({ fromUid: 'coach' }), new Set(['coach'])), true);
});

test('a stranger can\'t make their own game count as accepted', () => {
  assert.equal(eligibleGameDelivery(d({ acceptedAt: { seconds: 1 } }), new Set()), false);
});

test('a game the student accepted on this device applies', () => {
  assert.equal(eligibleGameDelivery(d(), new Set(), new Set(['d1'])), true);
});

test('dismissed, unknown kinds and future versions never apply', () => {
  assert.equal(eligibleGameDelivery(d({ fromUid: 'coach', dismissedAt: 1 }), new Set(['coach'])), false);
  assert.equal(eligibleGameDelivery(d({ fromUid: 'coach', kind: 'lines' }), new Set(['coach'])), false);
  assert.equal(eligibleGameDelivery(d({ fromUid: 'coach', v: 2 }), new Set(['coach'])), false);
});

// ---------------------------------------------------------------------------
// Whose an opening is travels no further than the coach's own app.
// ---------------------------------------------------------------------------
const built = (extra = {}) => ({
  id: 'o1', name: 'Jobava', ownerId: 'card-wavy', chapters: [{ id: 'c1', name: 'Main', variations: [{ id: 'v1', name: 'A', moves: ['d4'], learned: true }] }], ...extra,
});

test('an opening built for a student leaves without the coach\'s card id on it', () => {
  const [sent] = deliveryPayload([built()]);
  assert.equal(sent.ownerId ?? null, null);
  assert.equal(sent.chapters[0].variations[0].learned, false, 'and still without the coach\'s progress');
});

test('one that was sent with an owner still lands in the student\'s own repertoire', () => {
  // Deliveries sent before the fix are still sitting in inboxes, owner and all.
  const st = applyDelivery({ openings: [], players: [] }, { openings: [built()] });
  assert.equal(st.openings[0].ownerId ?? null, null);
  // …and accepting again brings back one an earlier accept left hidden.
  const hidden = { openings: [built()], players: [] };
  const healed = applyDelivery(hidden, { openings: deliveryPayload([built()]) });
  assert.equal(healed.openings.length, 1);
  assert.equal(healed.openings[0].ownerId ?? null, null);
});

// ---------------------------------------------------------------------------
// Lessons: recycled Board Editor positions, sent on to a student's app.
// ---------------------------------------------------------------------------

const FEN = '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1';
const coach = { uid: 'coach1', screenName: 'gino', role: 'coach' };
const wavy = { uid: 'wavy1', name: 'wavy-jr' };
// The coach's copy in Wavy's Lesson 4, as Recycle makes it — at a fixed
// moment (1000), so a later edit on the coach's side (updatedAt) is later.
const copyFor = (id = 'cp1', extra = {}) => recycledCopy({
  id: 'luc', name: 'Lucena', fen: FEN, folder: 'Rook endgames', arrows: [['c1', 'c4', '#15781B']], squares: { b7: '#882020' }, ...extra,
}, {
  ownerId: 'card-wavy', folder: 'Lesson 4', id, now: 1000,
});
// …and the same copy after the coach edits it in the Board Editor.
const editedFor = (id, at, extra = {}) => ({ ...copyFor(id, extra), updatedAt: at });
const lessonFor = (positions, extra = {}) => ({
  id: 'd1', ...lessonDocs({ to: wavy, from: coach, lesson: 'Lesson 4', positions })[0], ...extra,
});
const studentState = (savedPositions = []) => ({
  openings: [], players: [], categories: [], playlists: [], labEntries: [], savedPositions,
});

test('a lesson leaves without the coach\'s owner, source or folder on its positions', () => {
  const [doc] = lessonDocs({ to: wavy, from: coach, lesson: ' Lesson 4 ', positions: [copyFor()] });
  assert.equal(typeof doc.positions, 'string', 'one string: Firestore takes no arrow lists inside a list');
  const [p] = lessonPositions(doc);
  assert.equal(p.id, 'cp1', 'the copy\'s own id travels');
  assert.equal('ownerId' in p, false);
  assert.equal('recycledFrom' in p, false);
  assert.equal('folder' in p, false);
  assert.deepEqual(p.arrows, [['c1', 'c4', '#15781B']]);
  assert.equal(doc.kind, 'lesson');
  assert.equal(doc.v, 1);
  assert.equal(doc.lesson, 'Lesson 4');
  assert.deepEqual(doc.openings, [], 'an app from before lessons finds no lines in it');
  assert.equal(doc.summary, 'A lesson, “Lesson 4” · 1 position — not in your Board Editor? Reload Repertoire Lab to update.');
  assert.equal(isLesson(doc), true);
});

test('a lesson document passes the deliveries rules as they are published', () => {
  // firebase/firestore.rules: sent as yourself, to someone, fewer than 30 fields.
  const [doc] = lessonDocs({ to: wavy, from: coach, lesson: 'Lesson 4', positions: [copyFor()] });
  assert.equal(doc.fromUid, coach.uid);
  assert.equal(typeof doc.toUid, 'string');
  assert.ok(Object.keys(doc).length < 30, `${Object.keys(doc).length} fields`);
  for (const k of ['readAt', 'acceptedAt', 'dismissedAt']) assert.equal(doc[k], null);
});

test('a big lesson goes as several deliveries of at most LESSON_MAX positions', () => {
  const many = Array.from({ length: LESSON_MAX + 5 }, (_, i) => copyFor(`cp${String(i).padStart(3, '0')}`));
  const docs = lessonDocs({ to: wavy, from: coach, lesson: 'Lesson 4', positions: many });
  assert.deepEqual(docs.map((d) => lessonPositions(d).length), [LESSON_MAX, 5]);
  assert.equal(new Set(docs.flatMap((d) => lessonPositions(d).map((p) => p.id))).size, LESSON_MAX + 5, 'none lost, none twice');
  assert.deepEqual(lessonDocs({ to: wavy, from: coach, lesson: 'Empty', positions: [] }), [], 'nothing to send: nothing sent');
});

test('only a real position is let in: shape checked, junk dropped', () => {
  assert.deepEqual(lessonPositions({ positions: '{not json' }), []);
  assert.deepEqual(lessonPositions({ positions: 42 }), []);
  assert.deepEqual(lessonPositions({}), []);
  assert.equal(lessonPosition({ id: 'cp1', name: 'x', fen: 'not a fen' }), null);
  assert.equal(lessonPosition({ id: '../x', name: 'x', fen: FEN }), null, 'an id that can\'t be an address');
  assert.equal(lessonPosition(null), null);
  const p = lessonPosition({
    id: 'cp1', fen: FEN, name: '', arrows: [['c1', 'c4', '#fff'], ['z9', 'c4', '#fff'], 'junk'], squares: { b7: '#fff', q9: '#fff', c3: 7 }, ownerId: 'x', evil: '<script>',
  });
  assert.deepEqual(p, {
    id: 'cp1', name: 'Position', fen: FEN, arrows: [['c1', 'c4', '#fff']], squares: { b7: '#fff' },
  });
});

test('taking a lesson files its positions under the lesson\'s name, as the student\'s own', () => {
  const mine = { id: 'own1', name: 'My own', fen: FEN, folder: 'Openings' };
  const st = applyDelivery(studentState([mine]), lessonFor([copyFor('cp1'), copyFor('cp2', { name: 'Philidor' })]));
  assert.deepEqual(groupPositions(st.savedPositions).map((g) => `${g.folder}:${g.items.map((p) => p.id).join(',')}`), [
    'Lesson 4:cp1,cp2', 'Openings:own1',
  ]);
  for (const p of st.savedPositions) assert.equal(p.ownerId ?? null, null);
  assert.equal(st.savedPositions.find((p) => p.id === 'cp2').name, 'Philidor');
  assert.deepEqual(st.openings, [], 'no lines arrive with it');
});

test('a lesson sent again updates the student\'s copies instead of adding more', () => {
  const first = applyLesson(studentState(), lessonFor([copyFor('cp1')]), 1);
  // The student files it somewhere of their own; the coach then fixes the arrow and sends again.
  const moved = { ...first, savedPositions: first.savedPositions.map((p) => ({ ...p, folder: 'Endgames' })) };
  const again = lessonFor([editedFor('cp1', 5000, { arrows: [['c1', 'c8', '#15781B']] }), copyFor('cp2')], { id: 'd2' });
  const st = applyLesson(moved, again, 2);
  assert.equal(st.savedPositions.length, 2, 'cp1 once, and the new cp2');
  const cp1 = st.savedPositions.find((p) => p.id === 'cp1');
  assert.deepEqual(cp1.arrows, [['c1', 'c8', '#15781B']], 'the coach\'s board');
  assert.equal(cp1.folder, 'Endgames', 'where the student filed it');
  assert.equal(cp1.updatedAt, 2, 'an edit, as far as their own sync is concerned');
  assert.equal(st.savedPositions.find((p) => p.id === 'cp2').folder, 'Lesson 4');
});

test('a lesson is taken once its positions are all here as sent — a bare acceptedAt doesn\'t count', () => {
  const d = lessonFor([copyFor('cp1'), copyFor('cp2')]);
  assert.equal(lessonTaken(d, []), false);
  // An app from before lessons pressed its button: acceptedAt set, nothing kept.
  assert.equal(lessonTaken({ ...d, acceptedAt: { seconds: 1, nanoseconds: 0 } }, []), false);
  const half = applyDelivery(studentState(), lessonFor([copyFor('cp1')]));
  assert.equal(lessonTaken(d, half.savedPositions), false, 'half of it');
  // And a lesson really taken is taken by applying it.
  assert.equal(lessonTaken(d, applyDelivery(studentState(), d).savedPositions), true);
});

test('taken on one of the student\'s devices is taken on all of them, even after deleting a position', () => {
  const d = lessonFor([copyFor('cp1'), copyFor('cp2')]);
  const st = applyDelivery(studentState(), d);
  // Accepted on the phone: the mark only an app that knows lessons leaves.
  const marked = { ...d, acceptedAt: { at: { seconds: 9 }, lessons: 1 } };
  assert.equal(takenByLessonApp(marked), true);
  assert.equal(takenByLessonApp({ ...d, acceptedAt: { seconds: 9, nanoseconds: 0 } }), false, 'a bare time is an old app\'s');
  // cp2 deleted on the phone, synced to the iPad: the lesson doesn't come back to the iPad's bell.
  const iPad = st.savedPositions.filter((p) => p.id !== 'cp2');
  assert.equal(lessonTaken(marked, iPad), true);
  assert.equal(lessonTaken(d, iPad), false, 'without the mark it would have');
});

test('the coach changes a position and sends it again: it waits in the bell, and taking it updates the board', () => {
  const d1 = { ...lessonFor([copyFor('cp1')]), acceptedAt: { lessons: 1 } };
  const st = applyDelivery(studentState(), d1);
  assert.equal(lessonTaken(d1, st.savedPositions), true);
  // Same id, new arrow — an edit-only re-send.
  const d2 = lessonFor([editedFor('cp1', 5000, { arrows: [['c1', 'c8', '#15781B']] })], { id: 'd2' });
  assert.equal(lessonTaken(d2, st.savedPositions), false, 'the change is something to take');
  const plan = lessonPlan(st.savedPositions, d2);
  assert.deepEqual([plan.add.length, plan.update.length, plan.skipped.length], [0, 1, 0]);
  // Taken on a device whose clock runs far behind the coach's: still up to date afterwards.
  const after = applyLesson(st, d2, 1);
  assert.equal(after.savedPositions.length, 1, 'updated, not added again');
  assert.deepEqual(after.savedPositions[0].arrows, [['c1', 'c8', '#15781B']]);
  assert.equal(lessonTaken(d2, after.savedPositions), true);
  // The older delivery has nothing in it to take now — it can't roll the board back.
  assert.equal(lessonTaken({ ...d1, acceptedAt: null }, after.savedPositions), true);
  assert.equal(applyLesson(after, d1, 2), after, 'and applying it anyway changes nothing');
  // Sent again with no change at all: nothing to take, so nothing in the bell.
  assert.equal(lessonTaken(lessonFor([editedFor('cp1', 5000, { arrows: [['c1', 'c8', '#15781B']] })], { id: 'd3' }), after.savedPositions), true);
});

test('a lesson the coach renamed and sent again stays one lesson, except what the student refiled', () => {
  const W = 'card-wavy';
  const a = copyFor('aaa1');
  const b = copyFor('bbb2');
  const st = applyLesson(studentState(), lessonFor([a, b]), 1);
  // The coach renames Wavy's Lesson 4 (which re-dates its positions) and adds a third.
  const renamed = renameFolder([a, b], 'Lesson 4', 'Rook endings', 5000, W);
  const again = lessonFor([...renamed, copyFor('ccc3')], { id: 'd2', lesson: 'Rook endings' });
  const shape = (list) => groupPositions(list).map((g) => `${g.folder}:${g.items.map((p) => p.id).join(',')}`);
  assert.deepEqual(shape(applyLesson(st, again, 2).savedPositions), ['Rook endings:aaa1,bbb2,ccc3']);
  // bbb2 filed by the student somewhere of their own stays there.
  const refiled = { ...st, savedPositions: st.savedPositions.map((p) => (p.id === 'bbb2' ? { ...p, folder: 'Mine' } : p)) };
  assert.deepEqual(shape(applyLesson(refiled, again, 2).savedPositions), ['Mine:bbb2', 'Rook endings:aaa1,ccc3']);
});

test('a lesson can\'t replace a position that didn\'t come from whoever sent it', () => {
  const mine = {
    id: 'own12', name: 'My own', fen: FEN, arrows: [], squares: {}, folder: 'Openings',
  };
  // Ids aren't secret — every Copy link has one — so a stranger can name one of the student's.
  const evil = lessonFor([{ ...copyFor('own12'), name: 'Not yours', updatedAt: 9e12 }, copyFor('new99')], { fromUid: 'stranger' });
  const plan = lessonPlan([mine], evil);
  assert.deepEqual([plan.add.map((p) => p.id), plan.skipped.map((p) => p.id)], [['new99'], ['own12']]);
  const st = applyDelivery(studentState([mine]), evil);
  assert.deepEqual(st.savedPositions.find((p) => p.id === 'own12'), mine, 'theirs, exactly as it was');
  assert.ok(st.savedPositions.some((p) => p.id === 'new99'));
  // …and a position that came from one coach can't be replaced by another.
  const fromCoach = applyDelivery(studentState(), lessonFor([copyFor('cp1')]));
  const other = lessonFor([editedFor('cp1', 9e12, { name: 'Other coach' })], { id: 'd2', fromUid: 'coach2' });
  assert.equal(applyDelivery(fromCoach, other), fromCoach);
  assert.equal(fromCoach.savedPositions[0].received.from, coach.uid, 'it remembers who sent it');
});

test('colours are hex only: a url() square or arrow colour is dropped', () => {
  const p = lessonPosition({
    id: 'cp1',
    fen: FEN,
    name: 'x',
    squares: { b7: 'url(//evil.example/p.gif) #0000', c3: '#2ecc71' },
    arrows: [['c1', 'c4', 'url(//evil.example/a.gif) red'], ['d1', 'd4', '#e5534b'], ['e1', 'e4', 'red']],
  });
  assert.deepEqual(p.squares, { c3: '#2ecc71' });
  assert.deepEqual(p.arrows, [['d1', 'd4', '#e5534b']]);
});

test('a lesson from a newer app waits for this one to update: not taken as lines, not half-taken', () => {
  const v2 = { ...lessonFor([copyFor('cp1')]), v: 2 };
  assert.equal(isLesson(v2), false);
  assert.equal(isAnyLesson(v2), true);
  const before = studentState([{ id: 'own1', name: 'Mine', fen: FEN }]);
  assert.equal(applyDelivery(before, v2), before);
});

test('a lesson goes to the account a linked card was linked with, not whoever has its name now', async () => {
  resetServer();
  const linked = { name: 'Wavy', profile: { linkedUid: 'wavy1', accountName: 'wavy-jr' } };
  const named = { name: 'Bo', profile: { accountName: 'bo-chess' } };
  assert.deepEqual(lessonRecipient(linked), { uid: 'wavy1', name: 'wavy-jr' });
  assert.deepEqual(lessonRecipient(named), { name: 'bo-chess' });
  assert.equal(lessonRecipient({ name: 'Cy', profile: {} }), null);
  assert.equal(canSendLesson({ name: 'Cy' }), false);
  // Wavy renamed their account and someone else took the old name.
  server.set('screenNames/wavy-jr', { uid: 'stranger', name: 'wavy-jr' });
  server.set('screenNames/bo-chess', { uid: 'bo1', name: 'bo-chess' });
  await sendLessonToStudent({
    student: linked, from: coach, lesson: 'Lesson 4', positions: [copyFor('cp1')],
  });
  await sendLessonToStudent({
    student: named, from: coach, lesson: 'Lesson 1', positions: [copyFor('cp2')],
  });
  const sent = [...server.entries()].filter(([path]) => path.startsWith('deliveries/'));
  assert.deepEqual(sent.map(([, doc]) => [doc.toUid, doc.lesson]), [['wavy1', 'Lesson 4'], ['bo1', 'Lesson 1']]);
  // The student takes it: the mark goes on the delivery, for every one of their devices.
  await acceptDelivery(sent[0][0].split('/')[1], { lesson: true });
  assert.equal(takenByLessonApp(server.get(sent[0][0])), true);
  await assert.rejects(sendLessonToStudent({
    student: { name: 'Me', profile: { linkedUid: coach.uid } }, from: coach, lesson: 'x', positions: [copyFor()],
  }), /your own account/);
});

test('a send that didn\'t go says why in plain words', () => {
  assert.match(sendProblem({ code: 'unavailable', message: 'Failed to get document because the client is offline.' }), /offline\. Try again/);
  assert.match(sendProblem({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }), /signed in/);
  assert.equal(sendProblem(new Error('nobody is using the account name “x” now.')), 'nobody is using the account name “x” now.');
  assert.match(sendProblem(null), /Try again/);
});

test('an app from before lessons takes one in without harm: no lines, nothing changed', () => {
  // What applyDelivery did before lessons existed, for any kind it didn't know.
  const before = studentState([{ id: 'own1', name: 'Mine', fen: FEN }]);
  const d = lessonFor([copyFor('cp1')]);
  const old = mergeBackup(before, { openings: d.openings ?? [] }, { structure: 'incoming' });
  assert.deepEqual(old.savedPositions, before.savedPositions);
  assert.deepEqual(old.openings, []);
  // …and once that student updates, the lesson is still waiting for them.
  assert.equal(lessonTaken({ ...d, acceptedAt: { seconds: 1 } }, old.savedPositions), false);
});
