// Coach/student links: a student's real account, opened to their coach —
// their actual games (including one they typed in themselves after an OTB
// round), repertoire, and ratings, live — instead of the coach's own manual
// notes about them staying the only thing a coach ever sees.
//
// A coach opens a link by account name and it's live immediately — no
// approval step, so adding a student who already has their own account is
// as fast as typing their name. The one protection left on the student's
// side is that they can always end it. The link's id is fixed to
// `${coachUid}_${studentUid}`, so there's exactly one per pair. Firestore's
// rules are what actually grant the read access; this file only ever asks
// for it, it doesn't enforce it.
import { cloud } from './app';
import { findByScreenName } from './profile';
import { fromCloud, decodeFromStore } from './shape';

const linkId = (coachUid, studentUid) => `${coachUid}_${studentUid}`;

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

// Opens the link and hands back what's needed to seed a roster entry for
// them in one step: their directory record, plus (best-effort) the profile —
// USCF/FIDE/chess.com/lichess IDs, rating, avatar — off their own "My games"
// section, so the coach isn't looking at a blank card. A student with
// nothing synced yet just comes back with an empty seed, same as adding
// someone by hand.
export async function addLinkedStudent(coach, studentAccountName) {
  const who = await findByScreenName(studentAccountName);
  if (!who) {
    throw new Error(`Nobody is using “${studentAccountName.trim()}”. It's the account name in their Settings → Account.`);
  }
  if (who.uid === coach.uid) throw new Error('That’s your own account name.');
  const c = await cloud();
  const {
    doc, setDoc, getDoc, deleteDoc, serverTimestamp,
  } = c.firestore;
  const id = linkId(coach.uid, who.uid);

  // setDoc on a document that already exists is an UPDATE as far as the
  // rules are concerned, and they deliberately allow a link to be created or
  // deleted but never edited in place. So a leftover link document for this
  // pair — the same student added a second time after their card was
  // removed, or one left over from the approval-era flow — would make every
  // later attempt fail, even with the rules published. Reading first turns
  // that into: already linked, done; anything else of ours, cleared and
  // replaced.
  const at = doc(c.db, 'links', id);
  let existing = null;
  try {
    const snap = await getDoc(at);
    existing = snap.exists() ? snap.data() : null;
  } catch {
    existing = null; // can't read it — let the write below say why
  }
  const alreadyLinked = existing?.status === 'active' && existing?.coachUid === coach.uid;

  if (!alreadyLinked) {
    try {
      if (existing && existing.coachUid === coach.uid) await deleteDoc(at);
      await setDoc(at, {
        coachUid: coach.uid,
        coachName: coach.screenName ?? '',
        studentUid: who.uid,
        studentName: who.name ?? '',
        status: 'active',
        linkedAt: serverTimestamp(),
      });
    } catch (err) {
      // Firestore denies anything a rule doesn't explicitly allow, and a
      // collection nobody has published rules for is denied whole. The raw
      // message for that is "Missing or insufficient permissions", which
      // reads as "you're not allowed" when it actually means "this half of
      // the app was never switched on" — see the note at the top of
      // firebase/firestore.rules.
      if (err?.code === 'permission-denied') {
        throw new Error('Firebase refused that. The link rules haven’t been published to this project yet — run `npm run deploy:rules`, or paste firebase/firestore.rules into the Firebase console.');
      }
      throw err;
    }
  }

  let seed = { profile: null, avatar: null };
  try {
    const account = await loadLinkedAccount(who.uid);
    const self = (account.players ?? []).find((pl) => (pl.kind ?? 'self') === 'self');
    if (self) seed = { profile: self.profile ?? null, avatar: self.avatar ?? null };
  } catch {
    // Their account exists but nothing's synced from it yet, or the read
    // raced the write above. The link still stands either way — the coach's
    // page can always pull their games in once there's something there to
    // pull.
  }
  return { id, student: who, seed };
}

// Every link this account is the coach on, live — so a roster can show which
// students are linked.
export async function watchCoachLinks(uid, onChange) {
  const c = await cloud();
  if (!c) return () => {};
  const { collection, query, where, onSnapshot } = c.firestore;
  const q = query(collection(c.db, 'links'), where('coachUid', '==', uid));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => {
    // Still an empty list to the UI, but not a silent one: a denied read looks
    // exactly like "no links yet" otherwise, which is how unpublished rules
    // hid for a week.
    console.warn('[links] coach links unreadable:', err?.code ?? err);
    onChange([]);
  });
}

// Every coach who currently has this account linked — what a student's
// inbox shows, purely so they know who can see them. There's no approval
// step to act on; ending a link is the only control they have.
export async function watchStudentLinks(uid, onChange) {
  const c = await cloud();
  if (!c) return () => {};
  const { collection, query, where, onSnapshot } = c.firestore;
  const q = query(collection(c.db, 'links'), where('studentUid', '==', uid));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.warn('[links] student links unreadable:', err?.code ?? err);
    onChange([]);
  });
}

// Either side can end a link at any time — the coach dropping a student, or
// the student cutting a coach off.
export async function endLink(id) {
  const c = await cloud();
  const { doc, deleteDoc } = c.firestore;
  await deleteDoc(doc(c.db, 'links', id));
}
