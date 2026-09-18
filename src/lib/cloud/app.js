// Firebase, loaded only if it's actually going to be used.
//
// The SDK is around half a megabyte. This app opens offline, on a phone, and
// most of the time nobody has signed in — so it's a dynamic import behind a
// promise rather than part of the main bundle. Vite splits it out on its own
// and the service worker never has to cache it for someone who doesn't sync.
import { firebaseConfig, cloudConfigured } from './config';

let ready = null;

export function cloud() {
  if (!cloudConfigured) return Promise.resolve(null);
  if (!ready) {
    ready = (async () => {
      const [{ initializeApp }, auth, firestore, storage] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore'),
        import('firebase/storage'),
      ]);
      const app = initializeApp(firebaseConfig);
      // Local persistence: signing in on a device keeps you signed in, which
      // is the whole point — this is an app you open on a phone between
      // lessons, not a bank.
      const authInstance = auth.initializeAuth(app, {
        persistence: auth.browserLocalPersistence,
      });
      // Firestore's own offline cache, so a move made on a plane is queued
      // and sent when there's signal again rather than lost or blocking.
      const db = firestore.initializeFirestore(app, {
        localCache: firestore.persistentLocalCache({
          tabManager: firestore.persistentMultipleTabManager(),
        }),
      });
      return { app, auth, authInstance, firestore, db, storage, storageInstance: storage.getStorage(app) };
    })().catch((err) => {
      ready = null; // a failed init shouldn't poison every later attempt
      throw err;
    });
  }
  return ready;
}

export { cloudConfigured };
