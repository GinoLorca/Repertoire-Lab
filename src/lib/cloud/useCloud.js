import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { cloudConfigured } from './config';
import { watchAuth, signOutNow } from './auth';
import { syncNow, readMeta, forgetMeta } from './sync';
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
      const sent = result.written || result.deleted || result.uploaded
        ? `Sent ${result.written} change${result.written === 1 ? '' : 's'}`
        : 'Up to date';
      // Pictures not travelling is worth saying out loud — but as a footnote
      // to a sync that worked, not as a failure. The lines are what matter.
      setDetail(result.storageUnavailable
        ? `${sent} · pictures stay on this device (Storage isn’t set up)`
        : sent);
    } catch (err) {
      setStatus('error');
      setDetail(err?.message ?? 'Sync failed');
    } finally {
      running.current = false;
    }
  }, [dispatch]);

  // Sync when signing in, when the app comes back to the front, and a few
  // quiet seconds after anything changes.
  useEffect(() => {
    if (!user) return undefined;
    run();
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
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
