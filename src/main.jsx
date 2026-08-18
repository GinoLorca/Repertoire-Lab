import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// Offline support (production only — interferes with dev hot reload).
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      // updateViaCache 'none': the worker script itself must never come from
      // the HTTP cache, or a new deploy can go unnoticed for a day.
      await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      const reg = await navigator.serviceWorker.ready;
      reg.update?.(); // pick up a new build on this visit, not the next one
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
