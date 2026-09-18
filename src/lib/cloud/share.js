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
  }, () => onChange([]));
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
  return mergeBackup(state, { openings: delivery.openings ?? [] });
}

export async function acceptDelivery(id) {
  const c = await cloud();
  const { doc, updateDoc, serverTimestamp } = c.firestore;
  await updateDoc(doc(c.db, 'deliveries', id), { acceptedAt: serverTimestamp() });
}
