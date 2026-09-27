import { cloud } from './app';
import { deviceId } from './sync';

// Which devices sync this account, what version of the app each one runs,
// and when each last synced — so "it didn't show up on my iPad" can be
// answered by looking, not guessing. An iPad left on an old version (an
// app on the home screen is resumed far more often than restarted) looks
// exactly like a sync bug from the outside.
//
// One small document per device, under the account's own data, so it needs
// no new rules. Written after a successful sync; nothing reads it but the
// Account screen.

export const BUILD = import.meta.env?.VITE_BUILD_TIME ?? null;

export function describeDevice() {
  if (typeof navigator === 'undefined') return 'Unknown device';
  const ua = navigator.userAgent ?? '';
  // iPadOS asks for desktop sites, and says "Macintosh" — the touch screen
  // is what gives it away.
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const kind = iPad ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone'
      : /Android/.test(ua) ? 'Android'
        : /Macintosh/.test(ua) ? 'Mac'
          : /Windows/.test(ua) ? 'Windows PC'
            : 'Computer';
  const homeScreen = typeof window !== 'undefined'
    && (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);
  const local = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  return `${kind}${homeScreen ? ' · home-screen app' : ''}${local ? ' · local test copy' : ''}`;
}

let lastWritten = { at: 0, build: null };

export async function recordDevice() {
  // Once every few minutes is plenty; every sync would be a write each time.
  if (lastWritten.build === BUILD && Date.now() - lastWritten.at < 5 * 60 * 1000) return;
  const c = await cloud();
  const uid = c?.authInstance?.currentUser?.uid;
  if (!uid) return;
  const { doc, setDoc, serverTimestamp } = c.firestore;
  const id = await deviceId();
  await setDoc(doc(c.db, 'users', uid, 'devices', id), {
    name: describeDevice(),
    build: BUILD,
    lastSync: serverTimestamp(),
  }, { merge: true });
  lastWritten = { at: Date.now(), build: BUILD };
}

export async function watchDevices(uid, onChange) {
  const c = await cloud();
  if (!c || !uid) return () => {};
  const { collection, onSnapshot } = c.firestore;
  const me = await deviceId();
  return onSnapshot(collection(c.db, 'users', uid, 'devices'), (snap) => {
    onChange(snap.docs.map((d) => ({
      id: d.id,
      me: d.id === me,
      name: d.data().name,
      build: d.data().build ?? null,
      lastSync: d.data().lastSync?.toMillis?.() ?? null,
    })));
  }, () => onChange(null));
}
