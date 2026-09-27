// Lets plain Node load the app's source the way Vite does.
//
// The app imports its own modules without file extensions ('./shape', not
// './shape.js'). Vite resolves that; Node's ES module loader refuses it. This
// hook retries a bare relative import with `.js` — nothing else — so the
// tests can load the real sync engine instead of a copy of it.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
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
