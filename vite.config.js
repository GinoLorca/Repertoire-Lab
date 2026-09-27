import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // When this build was made — shown in Settings → Account, and next to each
  // device there, so an iPad still on an older version is easy to spot.
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5199,
    // Local development has no Netlify functions, so US Chess ratings go
    // through this instead (see lib/ratings.js). Production uses
    // netlify/functions/uscf.mjs.
    proxy: {
      '/uscf-api': {
        target: 'https://ratings-api.uschess.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/uscf-api/, '/api/v1/members'),
      },
    },
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
