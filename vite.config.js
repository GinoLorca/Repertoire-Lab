import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5199,
  },
  build: {
    rollupOptions: {
      output: {
        // Firebase into one predictably-named chunk. It's already a dynamic
        // import (nothing loads it until someone signs in), but the offline
        // precache walks dist and would otherwise pin ~900KB of SDK onto
        // every device — including the phones of people who never sync.
        // Naming it is what lets scripts/precache.mjs leave it out; the
        // service worker still caches it at runtime once it's been fetched.
        manualChunks(id) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'firebase';
          }
          return undefined;
        },
      },
    },
  },
});
