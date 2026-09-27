// Sending lines to a student, instead of emailing them a JSON file.
//
// A delivery is one document in a shared collection: who it's from, who it's
// for, a note, and the openings/chapters themselves. The student's app
// watches for anything addressed to them, rings the bell, and — when they
// accept — merges it into their repertoire with the same rules that protect
// progress everywhere else in this app. Accepting a chapter you already have
// updates its lines without touching how far along you are on them.
import { cloud } from './app';
import { mergeBackup } from '../backup';

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

export function deliveryPayload(openings) {
  return asFreshLines(stripImages(openings));
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
  // The coach's arrangement is the newer one: lines they've since sent to a
  // sub-variation arrive there, once, with the student's progress on them.
  return mergeBackup(state, { openings: delivery.openings ?? [] }, { structure: 'incoming' });
}

export async function acceptDelivery(id) {
  const c = await cloud();
  const { doc, updateDoc, serverTimestamp } = c.firestore;
  await updateDoc(doc(c.db, 'deliveries', id), { acceptedAt: serverTimestamp() });
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
