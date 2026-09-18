// Firebase, configured from the environment.
//
// These values are not secrets. A web Firebase config ships inside the bundle
// by definition — anyone can read it out of the JavaScript. What actually
// protects your data is Authentication plus the Firestore and Storage rules,
// which only ever let a signed-in account touch documents under its own uid.
// They live in env vars anyway so the repo doesn't carry one project's
// identity, and so a second deployment can point somewhere else.
//
// With no config, every cloud feature stays switched off and the app behaves
// exactly as it did before any of this existed: local-only, Backup/Restore,
// no account. That's deliberate — sync is an addition, never a requirement.
const env = import.meta.env ?? {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const cloudConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);
