import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useStore } from '../../store';
import { cloudConfigured } from './config';
import { watchAuth, signOutNow } from './auth';
import { syncNow, readMeta, forgetMeta, watchRemoteChanges } from './sync';
import { hashOf } from './shape';
import { watchInbox, eligibleGameDelivery } from './share';
import { watchStudentLinks } from './links';
import { recordDevice } from './devices';

// What sync cares about. The analysis draft is excluded on purpose (it's the
// board in front of you on this device) and so is anything else that isn't
// part of the record.
const syncableHash = (state) => hashOf(JSON.stringify({
  openings: state?.openings, players: state?.players, categories: state?.categories,
  playlists: state?.playlists, labEntries: state?.labEntries,
  savedPositions: state?.savedPositions, settings: state?.settings,
}));

// Long enough that a practice session's rapid-fire updates settle into one
// sync rather than twenty, short enough that walking to the iPad is slower.
const QUIET_MS = 6000;
// …but never more than this after the first unsynced change, however busy
// things stay.
const MAX_WAIT_MS = 20000;
// A sync that hasn't finished by now is given up on. One await that never
// settles — iOS froze the app mid-sync and the connection it was waiting on
// never came back — used to leave every later sync a no-op until a reload.
const SYNC_DEADLINE_MS = 90000;
// After a failure, try again after these pauses (then every five minutes)
// while the app is on screen. It used to wait for the next edit or app
// switch, which on a Mac window left open could be hours.
const RETRY_MS = [5000, 15000, 30000, 60000, 120000, 300000];
// Clicking back into a Mac window that never left the screen syncs too, but
// not more often than this.
const FOCUS_GAP_MS = 30000;

// The sync engine: one per app, mounted at the top by CloudProvider below.
//
// It used to live inside the Settings → Account screen, which meant every
// automatic trigger — the quiet timer after an edit, the app coming back to
// the front, another device's pulse — only ran while that one screen was
// open. Anywhere else in the app nothing synced at all. Now it runs for the
// whole life of the app, and the Account screen just reads its status.
function useCloudEngine() {
  const { state, dispatch } = useStore();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!cloudConfigured);
  const [status, setStatus] = useState('idle'); // idle | syncing | error
  const [detail, setDetail] = useState(null);
  const [lastSync, setLastSync] = useState(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const lastHash = useRef(null);
  const running = useRef(false);
  // A sync asked for while one is running isn't dropped: it runs as soon as
  // the current one finishes. Without this, a coach's game arriving mid-sync
  // waited for the next unrelated trigger to be noticed.
  const rerun = useRef(false);
  const lastRunAt = useRef(0);
  const failures = useRef(0);
  const retryTimer = useRef(null);
  const firstDirtyAt = useRef(0);
  // Games a linked coach has sent that this device hasn't applied yet —
  // handed to syncNow, which applies them inside the sync.
  const inbound = useRef([]);
  const [coachApplied, setCoachApplied] = useState([]);
  // Game deliveries the student said yes to from the inbox, on this device —
  // the only consent that counts for a sender they aren't linked to. Kept in
  // localStorage so a yes survives a reload before the sync gets to it.
  const consented = useRef(readConsented());
  const refreshInbound = useRef(() => {});

  useEffect(() => {
    if (!cloudConfigured) return undefined;
    let stop = () => {};
    let cancelled = false;
    let started = false;
    let again = null;
    // Firebase is loaded on demand, and the first launch after an update has
    // to fetch it. If that fails (no signal, one bar), nothing used to try
    // again: that whole session never synced. Now it retries.
    const start = () => {
      if (started || cancelled) return;
      started = true;
      watchAuth((u) => {
        setUser(u);
        setReady(true);
        if (u) remember(WAS_SIGNED_IN, '1');
        if (u) readMeta(u.uid).then((m) => setLastSync(m.lastSync ?? null));
      }).then((fn) => { if (cancelled) fn(); else stop = fn; }).catch(() => {
        started = false;
        setStatus('error');
        setDetail('Couldn’t load sync — trying again when there’s signal.');
        clearTimeout(again);
        again = setTimeout(start, 15000);
      });
    };
    start();
    const onBack = () => { if (document.visibilityState === 'visible') start(); };
    window.addEventListener('online', start);
    document.addEventListener('visibilitychange', onBack);
    return () => {
      cancelled = true;
      clearTimeout(again);
      window.removeEventListener('online', start);
      document.removeEventListener('visibilitychange', onBack);
      stop();
    };
  }, []);

  const run = useCallback(async () => {
    if (!cloudConfigured) return;
    // Signed in before this device's library finished loading: nothing to
    // sync yet. The quiet timer runs it once the library is there.
    if (!stateRef.current) return;
    if (running.current) { rerun.current = true; return; }
    running.current = true;
    lastRunAt.current = Date.now();
    clearTimeout(retryTimer.current);
    // Try again later, backing off: a failure, or no connection to the server.
    const retryLater = () => {
      const wait = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)];
      failures.current += 1;
      retryTimer.current = setTimeout(() => {
        // Off screen, the app coming back to the front syncs anyway.
        if (document.visibilityState !== 'hidden') run();
      }, wait);
    };
    setStatus('syncing');
    setDetail(null);
    let deadline;
    try {
      const started = stateRef.current;
      // Past the deadline the sync is left to finish (or not) on its own;
      // anything it does is safe to repeat, and its result is ignored.
      const result = await Promise.race([
        syncNow(started, { onProgress: setDetail, inbound: inbound.current }),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Sync took too long — trying again shortly.')), SYNC_DEADLINE_MS);
        }),
      ]);
      if (result.offline) {
        // Not an error: nothing was lost, nothing was written, and it syncs
        // the moment there's signal — the 'online' event below, or the retry,
        // since a connection to the server can drop while the device
        // stays online.
        setStatus('idle');
        setDetail('Offline — your work is saved on this device and syncs when you’re back online.');
        retryLater();
        return;
      }
      failures.current = 0;
      firstDirtyAt.current = 0;
      recordDevice().catch(() => { /* only a label */ });
      // A sync takes a second or two, and the app doesn't stop while it runs:
      // a move played, a note typed, a game saved in that window is in the
      // store but not in `result.state`, which was merged from the state as
      // it was when the sync began. Hydrating with the result straight would
      // quietly throw that work away. So when anything moved underneath, it's
      // merged once more — the sync's result against what's here now, with
      // the state the sync started from as the common ancestor — and the
      // newer local work goes out on the next sync.
      // The fold happens in the reducer, against the state as it actually is
      // when this lands: read from here, an edit dispatched a moment earlier
      // but not yet rendered could be missed and then overwritten by the
      // hydrate queued behind it.
      dispatch({ type: 'syncResult', started, synced: result.state });
      // What the cloud now holds, not what's on screen: if local work was
      // folded in above, the hashes differ and the quiet timer sends it.
      lastHash.current = syncableHash(result.state);
      const arrived = (result.coachApplied ?? []).filter((o) => o.outcome === 'inserted' || o.outcome === 'applied');
      if (arrived.length) setCoachApplied(arrived);
      setLastSync(result.at);
      setStatus('idle');
      // Both halves of the round trip, because "Sent 1 change" alone can't
      // tell you whether this device saw the other one's work.
      const sent = result.written || result.deleted
        ? `got ${result.received} · sent ${result.written}`
        : `got ${result.received} · up to date`;
      // Pictures travel with everything else now (see cloud/blobs.js), so
      // there's nothing to say unless one genuinely couldn't — a scoresheet
      // photo too big for a document, most likely. Said as a footnote to a
      // sync that worked, not as a failure: the lines are what matter.
      const stuck = (result.imagesTooBig ?? 0) + (result.imagesSkipped ?? 0);
      setDetail(stuck
        ? `${sent} · ${stuck} picture${stuck === 1 ? '' : 's'} too big to sync — still here`
        : sent);
    } catch (err) {
      setStatus('error');
      setDetail(err?.message ?? 'Sync failed');
      retryLater();
    } finally {
      clearTimeout(deadline);
      running.current = false;
      if (rerun.current) {
        rerun.current = false;
        setTimeout(() => run(), 0);
      }
    }
  }, [dispatch]);

  // Four ways a sync starts, and only one of them involves a person:
  //   · signing in
  //   · the app coming back to the front
  //   · a few quiet seconds after you change something here
  //   · another device saying it changed something (the listener below)
  //
  // That last one is what makes this feel like it should: finish a line on a
  // tablet and the desktop updates itself while you're still holding the
  // tablet. Without it a window sitting open would never hear about anything.
  useEffect(() => {
    if (!user) return undefined;
    const launched = Date.now();
    run();
    // Both directions. Coming back to the app picks up anything that happened
    // elsewhere; leaving it pushes what you just did, so putting a tablet down
    // mid-session and walking to a desktop works the way you'd expect rather
    // than waiting for the quiet timer that never got to finish. Leaving only
    // syncs when there's something here to send: every sync reads the whole
    // library, and doing it on the way out as well as on the way back doubled
    // that on a plan with a daily read allowance.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        run();
        if (listenerDead) attach(deadSince);
      } else if (stateRef.current && syncableHash(stateRef.current) !== lastHash.current) {
        run();
      }
    };
    // A Mac window can stay on screen while you work in another app, so
    // coming back to it isn't a visibility change.
    const onFocus = () => { if (Date.now() - lastRunAt.current > FOCUS_GAP_MS) run(); };
    // Back online: whatever was saved on this device while offline goes up.
    const onOnline = () => { run(); if (listenerDead) attach(deadSince); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    // Another device's "I changed something". Firestore drops a listener for
    // good after an error, so a dead one is attached again: after a pause,
    // or sooner when the app comes back or the connection does.
    let stopWatching = () => {};
    let cancelled = false;
    let listenerDead = false;
    let deadSince = 0;
    let reattach = null;
    const attach = (since) => {
      clearTimeout(reattach);
      listenerDead = false;
      const died = () => {
        if (cancelled || listenerDead) return;
        listenerDead = true;
        deadSince = Date.now();
        stopWatching();
        stopWatching = () => {};
        reattach = setTimeout(() => attach(deadSince), 60000);
      };
      watchRemoteChanges(user.uid, () => run(), { since, onError: died })
        .then((fn) => { if (cancelled) fn(); else stopWatching = fn; })
        .catch(died);
    };
    attach(launched);
    return () => {
      cancelled = true;
      clearTimeout(reattach);
      clearTimeout(retryTimer.current);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      stopWatching();
    };
  }, [user, run]);

  // The student's side of linked games. Two listeners — which coaches have
  // an active link to this account, and what's been delivered to it — and
  // any game delivery from one of those coaches (or accepted by hand) that
  // this device hasn't seen yet starts a sync, which applies it.
  useEffect(() => {
    if (!user) return undefined;
    let coaches = new Set();
    let items = [];
    const refresh = () => {
      const eligible = items.filter((d) => eligibleGameDelivery(d, coaches, consented.current));
      const known = new Set(inbound.current.map((d) => d.id));
      inbound.current = eligible;
      if (eligible.some((d) => !known.has(d.id))) run();
    };
    let stopLinks = () => {};
    let stopInbox = () => {};
    watchStudentLinks(user.uid, (links) => {
      coaches = new Set(links.filter((l) => l.status === 'active').map((l) => l.coachUid));
      refresh();
    }).then((fn) => { stopLinks = fn; });
    watchInbox(user.uid, (list) => { items = list; refresh(); }).then((fn) => { stopInbox = fn; });
    refreshInbound.current = refresh;
    return () => {
      stopLinks(); stopInbox(); inbound.current = []; refreshInbound.current = () => {};
    };
  }, [user, run]);

  // "Add to my Games" on a game from someone the student isn't linked to.
  const acceptGameDelivery = useCallback((id) => {
    consented.current = new Set(consented.current).add(id);
    writeConsented(consented.current);
    refreshInbound.current();
  }, []);

  // Keyed on what sync cares about, not the whole state: stepping through
  // moves on the analysis board changes the state on every move, and used
  // to restart the countdown each time, so a line saved just before could
  // wait as long as you kept studying.
  const syncable = useMemo(() => (user && state ? syncableHash(state) : null), [user, state]);
  useEffect(() => {
    if (!syncable) return undefined;
    if (syncable === lastHash.current) { firstDirtyAt.current = 0; return undefined; }
    if (!firstDirtyAt.current) firstDirtyAt.current = Date.now();
    const wait = Math.max(0, Math.min(QUIET_MS, firstDirtyAt.current + MAX_WAIT_MS - Date.now()));
    const t = setTimeout(run, wait);
    return () => clearTimeout(t);
  }, [syncable, run]);

  const signOutEverywhere = useCallback(async () => {
    // One last push, so work done since the last sync isn't stranded on a
    // device you're signing out of — and if a sync is already under way, it
    // finishes first, rather than completing half-signed-out.
    try { await run(); } catch { /* offline, or already failing — sign out anyway */ }
    for (let i = 0; i < 200 && running.current; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 100));
    }
    remember(WAS_SIGNED_IN, null); // on purpose: nothing to warn about
    await signOutNow();
    await forgetMeta();
    lastHash.current = null;
    setLastSync(null);
  }, [run]);

  return {
    configured: cloudConfigured,
    ready,
    user,
    status,
    detail,
    lastSync,
    sync: run,
    signOut: signOutEverywhere,
    // Something to flag outside Settings, where nobody would otherwise see
    // it: signed out without choosing to (a password changed on another
    // device ends the session here), or sync failing again after a retry.
    attention: (ready && !user && recall(WAS_SIGNED_IN) === '1') ? 'signed-out'
      : (user && status === 'error' && failures.current >= 2) ? 'error' : null,
    // What a linked coach just added or corrected, for the "Gino added a
    // game" note. Cleared by whoever shows it.
    coachApplied,
    clearCoachApplied: () => setCoachApplied([]),
    acceptGameDelivery,
    isGameConsented: (id) => consented.current.has(id),
  };
}

const WAS_SIGNED_IN = 'repertoire-lab-was-signed-in';
function remember(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* private mode */ }
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

const CONSENT_KEY = 'repertoire-lab-accepted-games';
function readConsented() {
  try { return new Set(JSON.parse(localStorage.getItem(CONSENT_KEY) ?? '[]')); } catch { return new Set(); }
}
function writeConsented(set) {
  // Only the most recent hundred: an applied delivery is deleted, so old ids
  // are dead weight.
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify([...set].slice(-100))); } catch { /* private mode */ }
}

const CloudContext = createContext(null);

// Mount once, inside StoreProvider, around the whole app.
export function CloudProvider({ children }) {
  const cloud = useCloudEngine();
  return React.createElement(CloudContext.Provider, { value: cloud }, children);
}

const OFF = {
  configured: false,
  ready: true,
  user: null,
  status: 'idle',
  detail: null,
  lastSync: null,
  sync: async () => {},
  signOut: async () => {},
  coachApplied: [],
  clearCoachApplied: () => {},
  acceptGameDelivery: () => {},
  isGameConsented: () => false,
};

// What any screen reads: sign-in state and how the last sync went. Outside a
// CloudProvider (a test harness, say) it reads as "not configured" rather
// than throwing.
export function useCloud() {
  return useContext(CloudContext) ?? OFF;
}
