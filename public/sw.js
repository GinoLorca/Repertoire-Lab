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
  await Promise.all(urls.map(async (url) => {
    try {
      const res = await fetch(url, { cache: 'reload' });
      if (res.ok || res.type === 'opaque') await cache.put(url, res);
    } catch { /* offline or missing — skip it */ }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAll(PRECACHE).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// The page still reports what it loaded — that catches anything the build list
// missed, and the big engine files once they've been used.
self.addEventListener('message', (event) => {
  const data = event.data;
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
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    } catch (err) {
      // A range request for a cached whole file (audio) can land here.
      const fallback = await cache.match(event.request, { ignoreSearch: true });
      if (fallback) return fallback;
      throw err;
    }
  })());
});
