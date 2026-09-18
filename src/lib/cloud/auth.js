// Email and password, and nothing else — no provider buttons, no magic links.
// Sign in once per device and stay signed in.
import { cloud } from './app';

// Firebase's error codes are precise and unreadable. These are the ones a
// person can actually hit, said plainly; anything unrecognised falls back to
// the raw message rather than a shrug, so an unexpected failure is still
// diagnosable from a screenshot.
const MESSAGES = {
  'auth/invalid-email': 'That doesn’t look like an email address.',
  'auth/missing-password': 'Enter your password.',
  'auth/weak-password': 'That password is too short — use at least six characters.',
  'auth/email-already-in-use': 'There’s already an account with that email. Try signing in instead.',
  'auth/invalid-credential': 'That email and password don’t match an account.',
  'auth/wrong-password': 'That password doesn’t match that email.',
  'auth/user-not-found': 'No account with that email yet — create one below.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/network-request-failed': 'No connection. Your work is saved on this device and will sync when you’re back online.',
};

export function authMessage(err) {
  return MESSAGES[err?.code] || err?.message || 'Something went wrong.';
}

export async function signUp(email, password) {
  const c = await cloud();
  const { createUserWithEmailAndPassword } = c.auth;
  const cred = await createUserWithEmailAndPassword(c.authInstance, email.trim(), password);
  return cred.user;
}

export async function signIn(email, password) {
  const c = await cloud();
  const { signInWithEmailAndPassword } = c.auth;
  const cred = await signInWithEmailAndPassword(c.authInstance, email.trim(), password);
  return cred.user;
}

export async function signOutNow() {
  const c = await cloud();
  await c.auth.signOut(c.authInstance);
}

export async function sendReset(email) {
  const c = await cloud();
  await c.auth.sendPasswordResetEmail(c.authInstance, email.trim());
}

// Calls back with the user (or null) as soon as Firebase has restored the
// saved session, and on every change after.
export async function watchAuth(onChange) {
  const c = await cloud();
  if (!c) { onChange(null); return () => {}; }
  return c.auth.onAuthStateChanged(c.authInstance, onChange);
}
