// Lets plain Node load the app's source the way Vite does, and keeps the
// tests hermetic.
//
// · The app imports its own modules without file extensions ('./shape', not
//   './shape.js'). Vite resolves that; Node's loader refuses it. A bare
//   relative import is retried with `.js` — nothing else.
// · idb-keyval and the Firebase bootstrap (lib/cloud/app.js) are swapped for
//   in-memory fakes (tests/fakes/), so the real sync engine runs against a
//   simulated Firestore and simulated devices — no network, no browser.
import { registerHooks } from 'node:module';

const fakes = new URL('./fakes/', import.meta.url);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'idb-keyval') return { url: new URL('idb.mjs', fakes).href, shortCircuit: true };
    if (specifier === './app' && context.parentURL?.includes('/src/lib/cloud/')) {
      return { url: new URL('firebase.mjs', fakes).href, shortCircuit: true };
    }
    try {
      return next(specifier, context);
    } catch (err) {
      const relative = /^\.{1,2}\//.test(specifier);
      const hasExt = /\.[cm]?js$/.test(specifier);
      if (err?.code === 'ERR_MODULE_NOT_FOUND' && relative && !hasExt) {
        return next(`${specifier}.js`, context);
      }
      throw err;
    }
  },
});
