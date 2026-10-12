// Keeps FSTEdit in the browser, so it opens at once and with the network off.
// The build writes this build's id and its files into the two lines below.
const VERSION = '__VERSION__';
const FILES = __FILES__;
const APP = `fstedit-${VERSION}`;

// the app is stored on install; the ffmpeg and transcription engines, tens of megabytes each, the first time a job uses them
self.addEventListener('install', (e) => {
  // past the browser's own cache, which may still hold the page of the previous deploy
  const shell = ['./', ...FILES.filter((f) => !f.endsWith('.wasm'))].map((f) => new Request(f, { cache: 'reload' }));
  e.waitUntil(caches.open(APP).then((c) => c.addAll(shell)));
});

// the open page asks for the new version once its user chooses to reload
self.addEventListener('message', (e) => {
  if (e.data === 'update') void self.skipWaiting();
});

self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      const app = await caches.open(APP);
      const wanted = new Set(FILES.map((f) => new URL(f, self.registration.scope).href));
      for (const key of await caches.keys()) {
        // the Whisper model sits in a cache of its own and stays
        if (!key.startsWith('fstedit-') || key === APP) continue;
        const old = await caches.open(key);
        // an engine this version still uses keeps its stored copy rather than downloading again
        for (const req of await old.keys()) {
          if (wanted.has(req.url) && !(await app.match(req))) await app.put(req, await old.match(req));
        }
        await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // the page and its files come from the store; a new deploy arrives as a new version of this worker
  const key = e.request.mode === 'navigate' ? './' : e.request;
  e.respondWith(
    caches.match(key).then(
      (hit) =>
        hit ??
        fetch(e.request).then((res) => {
          if (res.ok && url.pathname.includes('/assets/')) {
            const copy = res.clone();
            void caches.open(APP).then((c) => c.put(e.request, copy));
          }
          return res;
        }),
    ),
  );
});
