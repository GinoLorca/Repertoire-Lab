import React, {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { useStore } from '../../store';
import { cloudConfigured } from './config';
import { watchAuth, signOutNow } from './auth';
import { syncNow, readMeta, forgetMeta, watchRemoteChanges } from './sync';
import { hashOf } from './shape';
import { foldInFlight } from './merge3';
import { watchInbox, eligibleGameDelivery } from './share';
import { watchStudentLinks } from './links';

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
  const timer = useRef(null);
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
    watchAuth((u) => {
      setUser(u);
      setReady(true);
      if (u) readMeta(u.uid).then((m) => setLastSync(m.lastSync ?? null));
    }).then((fn) => { stop = fn; });
    return () => stop();
  }, []);

  const run = useCallback(async () => {
    if (!cloudConfigured) return;
    // Signed in before this device's library finished loading: nothing to
    // sync yet. The quiet timer runs it once the library is there.
    if (!stateRef.current) return;
    if (running.current) { rerun.current = true; return; }
    running.current = true;
    setStatus('syncing');
    setDetail(null);
    try {
      const started = stateRef.current;
      const result = await syncNow(started, { onProgress: setDetail, inbound: inbound.current });
      if (result.offline) {
        // Not an error: nothing was lost, nothing was written, and the
        // 'online' listener below syncs the moment there's signal.
        setStatus('idle');
        setDetail('Offline — your work is saved on this device and syncs when you’re back online.');
        return;
      }
      // A sync takes a second or two, and the app doesn't stop while it runs:
      // a move played, a note typed, a game saved in that window is in the
      // store but not in `result.state`, which was merged from the state as
      // it was when the sync began. Hydrating with the result straight would
      // quietly throw that work away. So when anything moved underneath, it's
      // merged once more — the sync's result against what's here now, with
      // the state the sync started from as the common ancestor — and the
      // newer local work goes out on the next sync.
      const now = stateRef.current;
      const next = foldInFlight(started, now, result.state);
      // Only touch the store if the merge actually changed something —
      // hydrating with an identical state would restart every view for
      // nothing, mid-practice included.
      const before = syncableHash(now);
      const after = syncableHash(next);
      if (before !== after) dispatch({ type: 'hydrate', state: next });
      // Nothing to show, but the state must still carry this sync's
      // generation: it's what entitles the NEXT sync to read "missing here"
      // as "deleted here" (see syncOnce). Set on its own, so no view restarts.
      else if (next.syncGen !== now.syncGen) dispatch({ type: 'setSyncGen', syncGen: next.syncGen });
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
    } finally {
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
    run();
    // Both directions. Coming back to the app picks up anything that happened
    // elsewhere; leaving it pushes what you just did, so putting a tablet down
    // mid-session and walking to a desktop works the way you'd expect rather
    // than waiting for the quiet timer that never got to finish.
    const onVisible = () => run();
    document.addEventListener('visibilitychange', onVisible);
    // Back online: whatever was saved on this device while offline goes up.
    window.addEventListener('online', onVisible);
    let stopWatching = () => {};
    watchRemoteChanges(user.uid, () => run()).then((fn) => { stopWatching = fn; });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
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

  useEffect(() => {
    if (!user || !state) return undefined;
    const h = syncableHash(state);
    if (h === lastHash.current) return undefined; // nothing of substance changed
    clearTimeout(timer.current);
    timer.current = setTimeout(run, QUIET_MS);
    return () => clearTimeout(timer.current);
  }, [state, user, run]);

  const signOutEverywhere = useCallback(async () => {
    // One last push, so work done since the last sync isn't stranded on a
    // device you're signing out of — and if a sync is already under way, it
    // finishes first, rather than completing half-signed-out.
    try { await run(); } catch { /* offline, or already failing — sign out anyway */ }
    for (let i = 0; i < 200 && running.current; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 100));
    }
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
    // What a linked coach just added or corrected, for the "Gino added a
    // game" note. Cleared by whoever shows it.
    coachApplied,
    clearCoachApplied: () => setCoachApplied([]),
    acceptGameDelivery,
    isGameConsented: (id) => consented.current.has(id),
  };
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
