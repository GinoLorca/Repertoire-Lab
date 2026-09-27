// Offline support.
//
// The app has to open on the subway, so the whole shell is pinned during
// install: the list below is written at build time by scripts/precache.mjs,
// which knows the content-hashed filenames this file can't. Nothing waits for
// the page to report what it loaded any more — one online visit is enough, and
// the visit after that is served from cache before the network is even tried.
//
// Stockfish and Tesseract are deliberately not in that list. They're tens of
// megabytes, only some screens need them, and one failed download during
// install would leave the app with no offline shell at all. They're cached the
// first time they're actually used instead.
const CACHE = 'repertoire-lab-__CACHE_VERSION__';
const PRECACHE = __PRECACHE_URLS__;

// One entry failing must not throw away the rest, so add them individually
// rather than with cache.addAll.
async function cacheAll(urls) {
  const cache = await caches.open(CACHE);
  const missed = [];
  await Promise.all(urls.map(async (url) => {
    try {
      const res = await fetch(url, { cache: 'reload' });
      if ((res.ok && !wrongType(url, res)) || res.type === 'opaque') await cache.put(url, res);
      else missed.push(url);
    } catch { missed.push(url); /* offline or missing — skip it */ }
  }));
  return missed;
}

// The host answers any unknown address with the app's page, status 200 —
// so a script from an older build that no longer exists comes back as HTML.
// Cached under the script's name, it would break that import for good.
function wrongType(url, res) {
  const path = new URL(url, self.location.origin).pathname;
  if (path === '/' || path.endsWith('.html')) return false;
  return (res.headers.get('content-type') || '').includes('text/html');
}

// The page and its own code must all arrive, or this build doesn't install
// and the one that works stays — activating deletes the old cache, and an
// install half-done on a bad connection would leave nothing to open offline.
const ESSENTIAL = (url) => url === '/' || url === '/index.html' || /^\/assets\/index-[^/]+\.(js|css)$/.test(url);

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAll(PRECACHE).then((missed) => {
    if (missed.some(ESSENTIAL)) throw new Error(`install incomplete: ${missed.filter(ESSENTIAL).join(', ')}`);
    return self.skipWaiting();
  }));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
  // Not part of activating: a page reloaded while this worker is still
  // activating asks it for the page, and that request waits for activation
  // to finish — which would be waiting for the reload. They'd wait on each
  // other forever, with the app frozen.
  moveOldPagesOver();
});

// A page already open keeps running the code it loaded, and an app on an
// iPad's home screen is resumed far more often than it's started — so an
// old build could go on running, and syncing, for days after a new one was
// out. Builds from now on reload themselves at a quiet moment (main.jsx) and
// say so when asked. A page that doesn't answer is running a build from
// before that, and is moved onto this one now.
const answered = new Set();
async function moveOldPagesOver() {
  try {
    // Asked only once this worker is active and in charge of the pages.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const pages = await self.clients.matchAll({ type: 'window' });
    if (!pages.length) return;
    pages.forEach((page) => page.postMessage({ type: 'sw-updated' }));
    await new Promise((resolve) => setTimeout(resolve, 2000));
    for (const page of pages) {
      if (answered.has(page.id) || typeof page.navigate !== 'function') continue;
      // Not awaited: it settles only once the page has loaded again.
      page.navigate(page.url).catch(() => { /* not ours to reload */ });
    }
  } catch { /* nothing here is worth failing over */ }
}

// The page still reports what it loaded — that catches anything the build list
// missed, and the big engine files once they've been used.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data?.type === 'update-handled' && event.source) answered.add(event.source.id);
  if (data?.type === 'cache-urls' && Array.isArray(data.urls)) {
    event.waitUntil(cacheAll(data.urls));
  }
});

// Refresh a cached entry in the background, so being offline costs nothing and
// being online still picks up a new deploy.
function revalidate(request, cache) {
  fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
  }).catch(() => { /* offline: keep what we have */ });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Rating lookups are live data — a cached answer would freeze someone's
  // rating at whatever it was the first time it was fetched.
  if (url.pathname.startsWith('/.netlify/')) return;

  // Opening the app: answer from cache first and check for a new build in the
  // background. Waiting on the network here is what made it hang with no
  // signal — a phone with one bar is slower to fail than to succeed.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = (await cache.match('/index.html')) || (await cache.match('/'));
      if (hit) {
        revalidate(new Request('/index.html'), cache);
        return hit;
      }
      try {
        const res = await fetch(event.request);
        cache.put('/index.html', res.clone());
        cache.put('/', res.clone());
        return res;
      } catch {
        return Response.error();
      }
    })());
    return;
  }

  // Everything else: cache first (hashed filenames make this safe), and fill
  // the cache as things are requested.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(event.request);
    if (hit) return hit;
    try {
      const res = await fetch(event.request);
      if (res.ok && !wrongType(event.request.url, res)) cache.put(event.request, res.clone());
      return res;
    } catch (err) {
      // A range request for a cached whole file (audio) can land here.
      const fallback = await cache.match(event.request, { ignoreSearch: true });
      if (fallback) return fallback;
      throw err;
    }
  })());
});
