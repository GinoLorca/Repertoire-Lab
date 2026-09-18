import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { cloudConfigured } from './config';
import { watchAuth, signOutNow } from './auth';
import { syncNow, readMeta, forgetMeta, watchRemoteChanges } from './sync';
import { hashOf } from './shape';

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

export function useCloud() {
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
  const timer = useRef(null);

  useEffect(() => {
    if (!cloudConfigured) return undefined;
    let stop = () => {};
    watchAuth((u) => { setUser(u); setReady(true); }).then((fn) => { stop = fn; });
    readMeta().then((m) => setLastSync(m.lastSync ?? null));
    return () => stop();
  }, []);

  const run = useCallback(async () => {
    if (running.current || !cloudConfigured) return;
    running.current = true;
    setStatus('syncing');
    setDetail(null);
    try {
      const result = await syncNow(stateRef.current, { onProgress: setDetail });
      // Only touch the store if the merge actually changed something —
      // hydrating with an identical state would restart every view for
      // nothing, mid-practice included.
      const before = syncableHash(stateRef.current);
      const after = syncableHash(result.state);
      if (before !== after) dispatch({ type: 'hydrate', state: result.state });
      lastHash.current = after;
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
    let stopWatching = () => {};
    watchRemoteChanges(user.uid, () => run()).then((fn) => { stopWatching = fn; });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      stopWatching();
    };
  }, [user, run]);

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
    // device you're signing out of.
    try { await run(); } catch { /* offline, or already failing — sign out anyway */ }
    await signOutNow();
    await forgetMeta();
    lastHash.current = null;
    setLastSync(null);
  }, [run]);

  return {
    configured: cloudConfigured, ready, user, status, detail, lastSync, sync: run, signOut: signOutEverywhere,
  };
}
