// Sending lines to a student, instead of emailing them a JSON file.
//
// A delivery is one document in a shared collection: who it's from, who it's
// for, a note, and the openings/chapters themselves. The student's app
// watches for anything addressed to them, rings the bell, and — when they
// accept — merges it into their repertoire with the same rules that protect
// progress everywhere else in this app. Accepting a chapter you already have
// updates its lines without touching how far along you are on them.
import { cloud } from './app';
import { findByScreenName } from './profile';
import { mergeBackup } from '../backup';
import { folderOf } from '../savedPositions';

// Deliveries are text. Artwork, avatars and photos are stripped rather than
// sent: they're megabytes, they'd need cross-account Storage permissions to
// read, and nobody is waiting on a course cover — they're waiting on the
// moves.
function stripImages(value) {
  if (typeof value === 'string') return value.startsWith('data:') ? null : value;
  if (Array.isArray(value)) return value.map(stripImages);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripImages(v);
    return out;
  }
  return value;
}

// Progress is personal. A coach sending a chapter they've drilled to level 6
// shouldn't hand the student their review schedule, or mark lines the student
// has never seen as learned.
function asFreshLines(openings) {
  return openings.map((o) => ({
    ...o,
    chapters: (o.chapters ?? []).map((c) => ({
      ...c,
      variations: (c.variations ?? []).map((v) => ({ ...v, learned: false, srs: null })),
    })),
  }));
}

// Whose an opening is means something only in the coach's own app: there,
// `ownerId` is the card of the student it was built for. In the student's app
// that card doesn't exist, and an opening owned by a card that doesn't exist
// is hidden everywhere — the Library and practice show only openings with no
// owner. So it leaves as null: in the student's app these are simply theirs,
// the same as a study pack (lib/backup.js). Null rather than left out, so it
// also clears the owner from a copy an earlier delivery left hidden.
const asTheirOwn = (openings) => openings.map((o) => ({ ...o, ownerId: null }));

export function deliveryPayload(openings) {
  return asTheirOwn(asFreshLines(stripImages(openings)));
}

// A short human summary, so the bell can say what arrived without opening it.
export function describePayload(openings) {
  const chapters = openings.reduce((n, o) => n + (o.chapters?.length ?? 0), 0);
  const lines = openings.reduce(
    (n, o) => n + (o.chapters ?? []).reduce((m, c) => m + (c.variations?.length ?? 0), 0), 0,
  );
  const bits = [];
  if (openings.length) bits.push(`${openings.length} opening${openings.length === 1 ? '' : 's'}`);
  if (chapters) bits.push(`${chapters} chapter${chapters === 1 ? '' : 's'}`);
  if (lines) bits.push(`${lines} line${lines === 1 ? '' : 's'}`);
  return bits.join(' · ') || 'nothing';
}

export async function sendLines({ to, from, openings, message }) {
  const c = await cloud();
  const { collection, addDoc, serverTimestamp } = c.firestore;
  const payload = deliveryPayload(openings);
  const doc = {
    toUid: to.uid,
    toName: to.name ?? '',
    fromUid: from.uid,
    fromName: from.screenName ?? '',
    fromRole: from.role ?? 'coach',
    message: (message ?? '').slice(0, 500),
    summary: describePayload(payload),
    openings: payload,
    sentAt: serverTimestamp(),
    readAt: null,
    acceptedAt: null,
    dismissedAt: null,
  };
  const ref = await addDoc(collection(c.db, 'deliveries'), doc);
  return ref.id;
}

// Everything addressed to this account that hasn't been dealt with, live.
export async function watchInbox(uid, onChange) {
  const c = await cloud();
  if (!c) return () => {};
  const { collection, query, where, onSnapshot } = c.firestore;
  // Filter on the server, sort here. A `where` plus an `orderBy` on a
  // different field needs a composite index, which means a deploy step and a
  // cryptic runtime error until someone does it. Nobody has enough deliveries
  // for the sort to be worth that.
  const q = query(collection(c.db, 'deliveries'), where('toUid', '==', uid));
  const at = (d) => (d.sentAt?.toMillis ? d.sentAt.toMillis() : 0);
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => at(b) - at(a));
    onChange(items);
  }, (err) => {
    // Still an empty list for the UI, but said out loud: a refused read looks
    // exactly like "nothing sent to you" otherwise.
    console.warn('[inbox] deliveries unreadable:', err?.code ?? err);
    onChange([]);
  });
}

export async function markRead(id) {
  const c = await cloud();
  const { doc, updateDoc, serverTimestamp } = c.firestore;
  await updateDoc(doc(c.db, 'deliveries', id), { readAt: serverTimestamp() });
}

export async function dismissDelivery(id) {
  const c = await cloud();
  const { doc, updateDoc, serverTimestamp } = c.firestore;
  await updateDoc(doc(c.db, 'deliveries', id), { dismissedAt: serverTimestamp() });
}

// Folds a delivery into the local repertoire. Same merge as Restore and sync:
// new lines arrive, existing ones take the coach's corrections, and the
// student's own progress is never rolled back.
export function applyDelivery(state, delivery) {
  if (isLesson(delivery)) return applyLesson(state, delivery);
  // A lesson from a newer app than this one is never read as lines — there
  // are none in it — and never half-taken: it waits for this app to update.
  if (isAnyLesson(delivery)) return state;
  // The coach's arrangement is the newer one: lines they've since sent to a
  // sub-variation arrive there, once, with the student's progress on them.
  // A delivery sent before deliveryPayload cleared the owner still carries
  // the coach's card id, so it's cleared here as well, on the way in.
  const openings = Array.isArray(delivery.openings) ? asTheirOwn(delivery.openings) : [];
  return mergeBackup(state, { openings }, { structure: 'incoming' });
}

// A lesson is marked taken in a way only an app that knows lessons writes —
// { at, lessons: 1 } rather than a bare time (see lessonTaken). The rules let
// the student write anything to acceptedAt, so this needs nothing new there.
export async function acceptDelivery(id, { lesson = false } = {}) {
  const c = await cloud();
  const { doc, updateDoc, serverTimestamp } = c.firestore;
  const acceptedAt = lesson ? { at: serverTimestamp(), lessons: 1 } : serverTimestamp();
  await updateDoc(doc(c.db, 'deliveries', id), { acceptedAt });
}

// ---------------------------------------------------------------------------
// A lesson: Board Editor positions recycled into a student's lesson, sent on
// to their own app.
//
// It rides the same deliveries collection as lines, as a kind of its own —
// { kind: 'lesson', v: 1, lesson, positions } — so it needs nothing new from
// the Firestore rules: sent as yourself, to someone, in well under 30 fields.
// The student's bell offers "Add to my positions", and the positions go into
// their Board Editor filed under the lesson's name, as their own.
//
// A student's app from before lessons sees a delivery of lines with no lines
// in it. That's what `openings: []` and the summary are for: it shows the
// note, says to update, and applies nothing. It does stamp acceptedAt if
// they press its button — which is why, for a lesson, a bare acceptedAt isn't
// what "taken" means (lessonTaken, below).
// ---------------------------------------------------------------------------

// The most positions one delivery carries. A position is small — a FEN, a
// name, a few arrows — so this keeps a document far under Firestore's 1 MB,
// and a bigger lesson goes as several.
export const LESSON_MAX = 200;

const FEN_RE = /^[pnbrqkPNBRQK1-8]{1,8}(\/[pnbrqkPNBRQK1-8]{1,8}){7}(\s|$)/;
const SQUARE_RE = /^[a-h][1-8]$/;
const ID_RE = /^[A-Za-z0-9_-]{3,64}$/;
// Colours are hex and nothing else. The app only ever draws in hex (the pens
// in lib/shortcuts.js, the marks in lib/marks.js), and the Board Editor puts a
// square's colour straight into a CSS background — where url(…) would have
// the student's browser fetch from wherever the sender liked.
const isColour = (c) => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c);
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// One position as it travels, and as it's taken in at the other end: what's on
// the board and what it's called, checked field by field. Whose it was on the
// coach's side (ownerId), which position it was copied from (recycledFrom) and
// the coach's folder for it don't travel — in the student's app it's simply
// theirs, in the lesson it arrived as. Anything that isn't a position comes
// back null. The id is kept, so sending the same copy again updates the
// student's copy of it instead of adding a second.
export function lessonPosition(p) {
  if (!p || typeof p !== 'object') return null;
  const fen = text(p.fen, 100);
  if (!ID_RE.test(String(p.id ?? '')) || !FEN_RE.test(fen)) return null;
  const arrows = (Array.isArray(p.arrows) ? p.arrows : [])
    .filter((a) => Array.isArray(a) && SQUARE_RE.test(a[0]) && SQUARE_RE.test(a[1]) && isColour(a[2]))
    .slice(0, 64)
    .map(([from, to, colour]) => [from, to, colour]);
  const squares = Object.fromEntries(Object.entries(p.squares && typeof p.squares === 'object' ? p.squares : {})
    .filter(([sq, colour]) => SQUARE_RE.test(sq) && isColour(colour))
    .slice(0, 64));
  const out = {
    id: p.id, name: text(p.name, 120) || 'Position', fen, arrows, squares,
  };
  if (typeof p.createdAt === 'string' && p.createdAt.length <= 40) out.createdAt = p.createdAt;
  if (Number.isFinite(p.updatedAt)) out.updatedAt = p.updatedAt;
  return out;
}

export const lessonName = (name) => text(name, 80) || 'Lesson';

// The lessons this app can take are version 1. One from a newer app (carrying
// solutions as well, say) is shown but waits for this app to update: taken as
// a version 1 it would keep the positions, lose whatever's new, and then count
// as taken — so after updating, the rest would never be offered. Game
// deliveries are held to their version the same way.
export const isAnyLesson = (d) => d?.kind === 'lesson';
export const isLesson = (d) => isAnyLesson(d) && d.v === 1;

// What the bell says. Written for an app from before lessons, which shows it
// as it is — the only thing that app can tell its student.
export function describeLesson(lesson, count) {
  return `A lesson, “${lessonName(lesson)}” · ${count} position${count === 1 ? '' : 's'} — not in your Board Editor? Reload Repertoire Lab to update.`;
}

// The positions in a lesson as it arrived, each checked. They travel as one
// JSON string, the way a game patch does: an arrow is [from, to, colour], and
// Firestore refuses a list inside a list.
export function lessonPositions(delivery) {
  let raw = delivery?.positions;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  return (Array.isArray(raw) ? raw : []).slice(0, LESSON_MAX).map(lessonPosition).filter(Boolean);
}

// The delivery documents for one lesson: one per LESSON_MAX positions, each
// short enough for the rules (fewer than 30 fields) and for Firestore.
// `sentAt` is the server's timestamp, passed in so this stays plain.
export function lessonDocs({
  to, from, lesson, positions, message, sentAt = null,
}) {
  const name = lessonName(lesson);
  const clean = (positions ?? []).map(lessonPosition).filter(Boolean);
  const docs = [];
  for (let i = 0; i < clean.length; i += LESSON_MAX) {
    const part = clean.slice(i, i + LESSON_MAX);
    docs.push({
      kind: 'lesson',
      v: 1,
      toUid: to.uid,
      toName: to.name ?? '',
      fromUid: from.uid,
      fromName: from.screenName ?? from.name ?? '',
      fromRole: from.role ?? 'coach',
      message: (message ?? '').slice(0, 500),
      summary: describeLesson(name, part.length),
      lesson: name,
      positions: JSON.stringify(part),
      openings: [],
      sentAt,
      readAt: null,
      acceptedAt: null,
      dismissedAt: null,
    });
  }
  return docs;
}

export async function sendLesson({
  to, from, lesson, positions, message,
}) {
  const c = await cloud();
  const { collection, addDoc, serverTimestamp } = c.firestore;
  const docs = lessonDocs({
    to, from, lesson, positions, message, sentAt: serverTimestamp(),
  });
  const ids = [];
  for (const d of docs) {
    // eslint-disable-next-line no-await-in-loop
    const ref = await addDoc(collection(c.db, 'deliveries'), d);
    ids.push(ref.id);
  }
  return ids;
}

// The account name a student's card remembers — what SendToStudent sends to.
export const studentAccountName = (student) => String(
  student?.profile?.accountName || student?.profile?.screenName || '',
).trim();

// Where a lesson for a student on the coach's Coaches Corner goes. A card
// linked to the student's account (Link on their page) goes to that account
// itself: the link was made with it, and it stays theirs whatever they call
// it — whereas an account name can be given up and claimed by someone else.
// A card with only an account name on it is looked up by that name, the way
// the Send button on their page does it. Null: there's nowhere to send.
export function lessonRecipient(student) {
  const linked = student?.profile?.linkedUid;
  const name = studentAccountName(student);
  if (typeof linked === 'string' && linked) return { uid: linked, name: name || student.name || '' };
  return name ? { name } : null;
}

export const canSendLesson = (student) => Boolean(lessonRecipient(student));

export async function sendLessonToStudent({
  student, from, lesson, positions, message,
}) {
  const to = lessonRecipient(student);
  if (!to) throw new Error(`${student?.name ?? 'This student'} has no account on their card.`);
  let who = to;
  if (!who.uid) {
    who = await findByScreenName(to.name);
    if (!who) throw new Error(`nobody is using the account name “${to.name}” now. Check it on ${student.name}'s card.`);
  }
  if (who.uid === from.uid) throw new Error(`“${to.name}” is your own account.`);
  await sendLesson({
    to: who, from, lesson, positions, message,
  });
  return who;
}

// Why a send didn't go, in words for the person who pressed it — Firestore's
// own ("Missing or insufficient permissions.") are written for developers.
// It finishes the sentence "It didn't reach Wavy's app: …".
export function sendProblem(err) {
  const code = String(err?.code ?? '');
  const said = String(err?.message ?? '');
  if (code === 'unavailable' || /offline/i.test(said)) return 'this device is offline. Try again once it’s back online.';
  if (code === 'permission-denied' || code === 'unauthenticated' || /permission/i.test(said)) {
    return 'your account wasn’t allowed to send it. Check you’re signed in, then try again.';
  }
  return said || 'something went wrong on the way. Try again.';
}

// When a position last changed on the sender's side: its edit time, or else
// when it was made. It's only ever compared with that same sender's earlier
// stamp on the same position, so the student's clock never comes into it.
const stampOf = (p) => (Number.isFinite(p?.updatedAt) ? p.updatedAt : (Date.parse(p?.createdAt ?? '') || 0));

// What taking a lesson would do here, position by position:
//   add      new to this app
//   update   sent before by the same sender, and changed on their side since
//   skipped  the id of a position here that didn't come from this sender —
//            one of the student's own, or another coach's. Ids aren't secret
//            (every "Copy link" has one), so a lesson can't replace those.
// Anything else is here already, as the sender has it now. A position taken
// in remembers where it came from (`received`): who sent it, the lesson it
// arrived in, and the sender's stamp on it at the time.
export function lessonPlan(savedPositions, delivery) {
  const from = delivery?.fromUid;
  const have = new Map((savedPositions ?? []).map((p) => [p.id, p]));
  const plan = { add: [], update: [], skipped: [] };
  for (const p of lessonPositions(delivery)) {
    const mine = have.get(p.id);
    if (!mine) plan.add.push(p);
    else if (!from || mine.received?.from !== from) plan.skipped.push(p);
    else if (stampOf(p) > (Number(mine.received.stamp) || 0)) plan.update.push({ p, mine });
  }
  return plan;
}

// Takes a lesson in: its positions into this app's Board Editor, filed under
// the lesson's name, as this account's own. One sent before and changed since
// takes the sender's board and name. It follows its lesson — renamed by the
// coach, it moves to the new name with the rest — unless the student has
// filed it somewhere else since, and then it stays where they put it.
export function applyLesson(state, delivery, now = Date.now()) {
  const lesson = lessonName(delivery?.lesson);
  const from = String(delivery?.fromUid ?? '');
  const { add, update } = lessonPlan(state.savedPositions, delivery);
  const received = (p) => ({ from, lesson, stamp: stampOf(p) });
  const incoming = [
    ...add.map((p) => ({
      ...p, folder: lesson, updatedAt: now, received: received(p),
    })),
    ...update.map(({ p, mine }) => {
      const filed = folderOf(mine);
      const folder = filed === mine.received.lesson ? lesson : filed;
      return {
        ...p, ...(folder ? { folder } : {}), updatedAt: now, received: received(p),
      };
    }),
  ];
  if (!incoming.length) return state;
  return mergeBackup(state, { savedPositions: incoming });
}

// The mark acceptDelivery leaves on a lesson: { at, lessons: 1 }. An app from
// before lessons writes a bare time instead, and that doesn't count. A sender
// could write the mark into what they send; all that does is keep their own
// lesson out of the bell, since taking one is always the student's tap.
export const takenByLessonApp = (d) => Boolean(d?.acceptedAt && typeof d.acceptedAt === 'object'
  && d.acceptedAt.lessons >= 1);

// Whether a lesson has been taken. A bare acceptedAt doesn't say so: an app
// from before lessons stamps one while keeping none of the positions, and
// that student, once updated, should find the lesson still waiting. Taken is
//   · taken by an app that knows lessons, on any of the student's devices —
//     the mark above, which the delivery carries to all of them — and it stays
//     taken after the student deletes some of its positions; or
//   · nothing in it that taking it would add or change here: sent twice, or
//     an older copy of a lesson that's since been sent again and taken.
// A lesson sent again after the coach changed it is a new delivery, with no
// mark and changes in it to take, so it waits in the bell.
export function lessonTaken(delivery, savedPositions) {
  if (takenByLessonApp(delivery)) return true;
  if (!lessonPositions(delivery).length) return Boolean(delivery?.acceptedAt); // nothing in it to take
  const { add, update } = lessonPlan(savedPositions, delivery);
  return add.length === 0 && update.length === 0;
}

// ---------------------------------------------------------------------------
// Hand-picking what to send.
//
// The unit a coach thinks in varies: a whole opening this week, one chapter
// the next, three specific lines the week after. So the picker works on ids at
// any level and this turns that selection into the openings to send — an
// opening keeps only its chosen chapters, a chapter only its chosen lines.
// ---------------------------------------------------------------------------

export function subsetOf(openings, chosen) {
  const picked = (id) => chosen.has(id);
  const out = [];
  for (const opening of openings ?? []) {
    const chapters = [];
    for (const chapter of opening.chapters ?? []) {
      const variations = (chapter.variations ?? []).filter((v) => picked(v.id));
      if (variations.length) chapters.push({ ...chapter, variations });
    }
    if (chapters.length) out.push({ ...opening, chapters });
  }
  return out;
}

// Every line under a node, so ticking an opening ticks everything in it and
// the counts underneath stay honest.
export function lineIdsUnder(node) {
  if (node.variations) return node.variations.map((v) => v.id);
  if (node.chapters) return node.chapters.flatMap((c) => (c.variations ?? []).map((v) => v.id));
  return [];
}

// Whole, some, or none — what a parent checkbox should show.
export function tickState(ids, chosen) {
  if (ids.length === 0) return 'none';
  let on = 0;
  for (const id of ids) if (chosen.has(id)) on += 1;
  if (on === 0) return 'none';
  return on === ids.length ? 'all' : 'some';
}

// ---------------------------------------------------------------------------
// Games for a linked student — see lib/cloud/gameLink.js
// ---------------------------------------------------------------------------

// A coach's change to one game, on its way to the student's account. It rides
// the same deliveries collection as lines do — published, working, nothing
// new to switch on — as its own kind. The id is fixed by coach, game and
// revision, so sending the same patch twice (a retry, a reload while offline,
// the coach's other device) writes the same document rather than two.
//
// `openings: []` and a readable summary are for a student whose app hasn't
// updated yet: it shows the note and applies nothing, instead of choking on a
// kind it doesn't know.
export async function sendGamePatch({
  to, from, gameId, rev, resend, patch, summary,
}) {
  const c = await cloud();
  const { doc, setDoc, getDoc, serverTimestamp } = c.firestore;
  const id = `lg_${from.uid}_${gameId}_${rev}`;
  const ref = doc(c.db, 'deliveries', id);
  try {
    await setDoc(ref, {
      kind: 'game',
      v: 1,
      toUid: to.uid,
      toName: to.name ?? '',
      fromUid: from.uid,
      fromName: from.screenName ?? from.name ?? '',
      fromRole: 'coach',
      gameId,
      rev,
      resend: Boolean(resend),
      patch: JSON.stringify(patch),
      summary: `Game: ${summary} — not in your Games? Reload Repertoire Lab to update it.`,
      message: '',
      openings: [],
      sentAt: serverTimestamp(),
      readAt: null,
      acceptedAt: null,
      dismissedAt: null,
    });
    return id;
  } catch (err) {
    if (err?.code === 'permission-denied') {
      // setDoc on an id that already exists is an update, which the sender
      // isn't allowed — so this is also what "already sent" looks like.
      try {
        const snap = await getDoc(ref);
        if (snap.exists()) return id;
      } catch { /* fall through to the real explanation */ }
      throw new Error('Couldn’t send — the Firebase rules published for this project are out of date. Run `npm run deploy:rules`, or paste firebase/firestore.rules into the Firebase console.');
    }
    throw err;
  }
}

// A coach's review of one of the student's own games (lib/cloud/reviews):
// the same kind as a game patch, as version 2 — which a student app from
// before reviews neither shows nor consumes, so it waits for their update.
// The summary is what such an app would show if it ever listed it.
export async function sendGameReview({
  to, from, gameId, rev, body, summary,
}) {
  const c = await cloud();
  const { doc, setDoc, getDoc, serverTimestamp } = c.firestore;
  const id = `lr_${from.uid}_${gameId}_${rev}`;
  const ref = doc(c.db, 'deliveries', id);
  try {
    await setDoc(ref, {
      kind: 'game',
      v: 2,
      toUid: to.uid,
      toName: to.name ?? '',
      fromUid: from.uid,
      fromName: from.screenName ?? from.name ?? '',
      fromRole: 'coach',
      gameId,
      rev,
      review: body,
      summary: `Review of your game ${summary} — update Repertoire Lab to read it.`,
      message: '',
      openings: [],
      sentAt: serverTimestamp(),
      readAt: null,
      acceptedAt: null,
      dismissedAt: null,
    });
    return id;
  } catch (err) {
    if (err?.code === 'permission-denied') {
      try {
        const snap = await getDoc(ref);
        if (snap.exists()) return id;
      } catch { /* fall through to the real explanation */ }
      throw new Error('Couldn’t send — the Firebase rules published for this project are out of date. Run `npm run deploy:rules`, or paste firebase/firestore.rules into the Firebase console.');
    }
    // Too big, or malformed: sending it again won't change that.
    if (err?.code === 'invalid-argument') {
      const e = new Error('This review is too big to send.');
      e.permanent = true;
      throw e;
    }
    throw err;
  }
}

// Older versions of a review the student hasn't picked up yet: superseded by
// the one just sent, so at most one per game waits for them.
export async function withdrawOlderReviews(fromUid, gameId, keepRev) {
  const c = await cloud();
  if (!c) return;
  const {
    collection, query, where, getDocs, deleteDoc,
  } = c.firestore;
  const snap = await getDocs(query(
    collection(c.db, 'deliveries'),
    where('fromUid', '==', fromUid), where('kind', '==', 'game'), where('gameId', '==', gameId),
  ));
  await Promise.allSettled(snap.docs
    .filter((d) => d.data().v === 2 && d.data().rev < keepRev)
    .map((d) => deleteDoc(d.ref)));
}

// Games not yet picked up by the student, withdrawn — the coach removed the
// game from their card before it arrived. The sender may delete their own
// deliveries; anything already applied is past recalling, and stays.
export async function withdrawGameDeliveries(fromUid, gameId) {
  const c = await cloud();
  if (!c) return;
  const {
    collection, query, where, getDocs, deleteDoc,
  } = c.firestore;
  // Equality filters only, so Firestore answers from its automatic indexes —
  // no composite index to deploy — and only this game's deliveries come back,
  // not every opening this coach has ever sent.
  const filters = [where('fromUid', '==', fromUid), where('kind', '==', 'game')];
  if (gameId != null) filters.push(where('gameId', '==', gameId));
  const snap = await getDocs(query(collection(c.db, 'deliveries'), ...filters));
  await Promise.allSettled(snap.docs.map((d) => deleteDoc(d.ref)));
}

// Whether a delivery is a coach's game this student has, in effect, already
// agreed to take: sent by a coach they're linked to right now, or one they
// tapped "Add to my Games" on, on this device. Anything else — a stranger who
// knows their account name — waits in the inbox for them to decide.
//
// The delivery's own acceptedAt is deliberately NOT consent: the sender
// writes the delivery, and nothing stops them writing acceptedAt into it
// themselves.
export function eligibleGameDelivery(d, activeCoachUids, consentedIds = new Set()) {
  return d.kind === 'game' && d.v === 1 && !d.dismissedAt
    && (activeCoachUids.has(d.fromUid) || consentedIds.has(d.id));
}
