import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// In dev, tear down any worker that's still controlling this origin. The
// guard below only stops a NEW registration — it can't evict one that a
// production build (or `vite preview`) left registered on this same
// localhost port earlier, and that worker keeps serving its cached bundle
// to the dev server forever. The symptom is brutal to diagnose: source
// edits, restarts and hard refreshes all appear to do nothing, because the
// page being tested is a months-old build the worker is still handing out.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.().then((regs) => {
    if (regs.length === 0) return;
    Promise.all(regs.map((r) => r.unregister()))
      .then(() => caches?.keys?.().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))))
      // Only now is the page genuinely being served by Vite; one reload
      // swaps the stale bundle for the real one.
      .then(() => window.location.reload())
      .catch(() => { /* nothing we can do; dev just stays stale */ });
  }).catch(() => { /* service workers unavailable */ });
}

// Offline support (production only — interferes with dev hot reload).
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      // updateViaCache 'none': the worker script itself must never come from
      // the HTTP cache, or a new deploy can go unnoticed for a day.
      // Whether this page started under a worker at all. The very first
      // visit has none, and the worker taking control then is not an update.
      const hadController = Boolean(navigator.serviceWorker.controller);
      // A new worker asks every open page whether it looks after its own
      // updates; one that doesn't answer is an old build, and gets reloaded.
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'sw-updated') event.source?.postMessage?.({ type: 'update-handled' });
      });
      await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      const reg = await navigator.serviceWorker.ready;
      reg.update?.(); // pick up a new build on this visit, not the next one

      // An app added to the home screen is hardly ever started fresh: iOS
      // keeps it suspended, and bringing it back doesn't reload the page. So
      // a new build — a sync fix, say — could sit unused on an iPad for days
      // while the old code kept running. Check again every time the app comes
      // back to the front, and once a new build has taken over, say so (see
      // UpdateBar in App.jsx). The library is saved as it changes, so a
      // reload costs nothing but where you were on screen.
      //
      // Once one has, the next time the app comes back to the front it simply
      // reloads onto it — the Reload bar alone left it to chance, and a device
      // on an old build can undo another's changes. Not in the middle of
      // something: a dialog open, a field being typed in, a practice session.
      // Then the bar stays up and it's your call.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        if (window.__repertoireUpdateReady && quietMoment()) window.location.reload();
        else reg.update?.().catch(() => {});
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;
        window.__repertoireUpdateReady = true;
        window.dispatchEvent(new Event('repertoire-update-ready'));
      });
      // The build pins the app shell; this reports anything else the page
      // actually loaded — the engine and OCR payloads once they've been used.
      const send = () => {
        const worker = navigator.serviceWorker.controller ?? reg.active;
        if (!worker) return;
        const urls = performance.getEntriesByType('resource')
          .map((e) => e.name)
          .filter((name) => name.startsWith(window.location.origin))
          .concat([window.location.origin + '/']);
        worker.postMessage({ type: 'cache-urls', urls: [...new Set(urls)] });
      };
      send();
      // Anything loaded lazily afterwards (engine wasm, OCR data, board pieces)
      // gets picked up on the next pass.
      setTimeout(send, 8000);
    } catch { /* offline, or service workers unavailable */ }
  });
}

function quietMoment() {
  if (document.querySelector('.modal-overlay')) return false;
  const el = document.activeElement;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return false;
  return !window.location.pathname.startsWith('/practice');
}
