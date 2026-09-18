// Screen names: the thing a coach types instead of a JSON file.
//
// A name is a global claim, so it lives in its own collection keyed by the
// lowercased name — that key IS the uniqueness guarantee, since two accounts
// can't create the same document id. The rules make sure a claim always
// points at the account making it.
import { cloud } from './app';

export const SCREEN_NAME_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/i;

export function screenNameProblem(name) {
  const n = (name ?? '').trim();
  if (!n) return 'Pick a screen name.';
  if (n.length < 3) return 'At least 3 characters.';
  if (n.length > 24) return 'At most 24 characters.';
  if (!SCREEN_NAME_RE.test(n)) return 'Letters, numbers, hyphens and underscores only.';
  return null;
}

const key = (name) => name.trim().toLowerCase();

export async function loadProfile(uid) {
  const c = await cloud();
  const { doc, getDoc } = c.firestore;
  const snap = await getDoc(doc(c.db, 'users', uid, 'singletons', 'profile'));
  return snap.exists() ? snap.data() : null;
}

export async function findByScreenName(name) {
  const c = await cloud();
  const { doc, getDoc } = c.firestore;
  const snap = await getDoc(doc(c.db, 'screenNames', key(name)));
  return snap.exists() ? snap.data() : null; // { uid, name, role }
}

// Claims the name and records it on the account. Run as a transaction so two
// people racing for the same name can't both win.
export async function claimScreenName(uid, name, { role = 'student', displayName = '' } = {}) {
  const problem = screenNameProblem(name);
  if (problem) throw new Error(problem);
  const c = await cloud();
  const { doc, runTransaction } = c.firestore;
  const wanted = key(name);
  const nameRef = doc(c.db, 'screenNames', wanted);
  const profileRef = doc(c.db, 'users', uid, 'singletons', 'profile');

  await runTransaction(c.db, async (tx) => {
    const existing = await tx.get(nameRef);
    if (existing.exists() && existing.data().uid !== uid) {
      throw new Error(`“${name.trim()}” is taken — try another.`);
    }
    const profile = await tx.get(profileRef);
    const previous = profile.exists() ? profile.data().screenNameKey : null;
    tx.set(nameRef, { uid, name: name.trim(), role, displayName });
    tx.set(profileRef, {
      uid, screenName: name.trim(), screenNameKey: wanted, role, displayName,
    }, { merge: true });
    // Let go of the old name so someone else can have it.
    if (previous && previous !== wanted) tx.delete(doc(c.db, 'screenNames', previous));
  });

  return { uid, screenName: name.trim(), screenNameKey: wanted, role, displayName };
}

export async function setRole(uid, role) {
  const c = await cloud();
  const { doc, setDoc, getDoc } = c.firestore;
  const profileRef = doc(c.db, 'users', uid, 'singletons', 'profile');
  await setDoc(profileRef, { role }, { merge: true });
  // The directory entry carries the role too, so a student can see that the
  // person sending them lines calls themselves a coach.
  const profile = await getDoc(profileRef);
  const k = profile.data()?.screenNameKey;
  if (k) await setDoc(doc(c.db, 'screenNames', k), { role }, { merge: true });
}
