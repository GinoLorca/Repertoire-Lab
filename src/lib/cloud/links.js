// Coach/student links: a student's real account, opened to their coach —
// their actual games (including one they typed in themselves after an OTB
// round) and repertoire, live — instead of the coach's own manual notes
// about them staying the only thing a coach ever sees.
//
// A link starts when a coach requests it by screen name (the same directory
// the delivery inbox uses) and only takes effect once the student approves
// it from their own inbox. The link's id is fixed to
// `${coachUid}_${studentUid}`, so there's exactly one per pair — asking again
// after a decline just reopens that same document rather than piling up a
// second request. Firestore's rules are what actually grant the read access;
// this file only ever asks for it, it doesn't enforce it.
import { cloud } from './app';
import { findByScreenName } from './profile';
import { fromCloud, decodeFromStore } from './shape';

const linkId = (coachUid, studentUid) => `${coachUid}_${studentUid}`;

export async function requestLink(coach, studentScreenName) {
  const who = await findByScreenName(studentScreenName);
  if (!who) {
    throw new Error(`Nobody is using “${studentScreenName.trim()}”. It's the name in their Settings → Account.`);
  }
  if (who.uid === coach.uid) throw new Error('That’s your own screen name.');
  const c = await cloud();
  const { doc, setDoc, serverTimestamp } = c.firestore;
  const id = linkId(coach.uid, who.uid);
  await setDoc(doc(c.db, 'links', id), {
    coachUid: coach.uid,
    coachName: coach.screenName ?? '',
    studentUid: who.uid,
    studentName: who.name ?? '',
    status: 'pending',
    requestedAt: serverTimestamp(),
    respondedAt: null,
  });
  return { id, student: who };
}

// Every link this account is the coach on — pending and active alike, so a
// roster can show a status next to each student.
export async function watchCoachLinks(uid, onChange) {
  const c = await cloud();
  if (!c) return () => {};
  const { collection, query, where, onSnapshot } = c.firestore;
  const q = query(collection(c.db, 'links'), where('coachUid', '==', uid));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, () => onChange([]));
}

// Every link this account is the student on — what the inbox shows.
export async function watchStudentLinks(uid, onChange) {
  const c = await cloud();
  if (!c) return () => {};
  const { collection, query, where, onSnapshot } = c.firestore;
  const q = query(collection(c.db, 'links'), where('studentUid', '==', uid));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, () => onChange([]));
}

export async function approveLink(id) {
  const c = await cloud();
  const { doc, updateDoc, serverTimestamp } = c.firestore;
  await updateDoc(doc(c.db, 'links', id), { status: 'active', respondedAt: serverTimestamp() });
}

// Declining a pending request and revoking an active one are the same move —
// the link just stops existing. Either the coach or the student can do it.
export async function endLink(id) {
  const c = await cloud();
  const { doc, deleteDoc } = c.firestore;
  await deleteDoc(doc(c.db, 'links', id));
}

// The student's real account, read straight from their own collections —
// exactly what the rules let an active link see. Artwork and photos are left
// out, the same way a delivery leaves them out: they're megabytes, and
// nobody linking a student is waiting on a course cover.
export async function loadLinkedAccount(studentUid) {
  const c = await cloud();
  const { collection, doc, getDocs, getDoc } = c.firestore;
  const readAll = async (name) => {
    const snap = await getDocs(collection(c.db, 'users', studentUid, name));
    return snap.docs.map((d) => decodeFromStore(d.data()));
  };
  const readOne = async (name, id) => {
    const snap = await getDoc(doc(c.db, 'users', studentUid, name, id));
    return snap.exists() ? decodeFromStore(snap.data()) : null;
  };
  const [openings, chapters, players, labEntries, lists] = await Promise.all([
    readAll('openings'), readAll('chapters'), readAll('players'), readAll('labEntries'),
    readOne('singletons', 'lists'),
  ]);
  return fromCloud({
    openings, chapters, players, labEntries, lists: lists ?? {},
  }, async () => null);
}
