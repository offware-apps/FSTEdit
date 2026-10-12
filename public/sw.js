// Keeps FSTEdit in the browser, so it opens with the network off.
const CACHE = 'fstedit-v2';

// the app itself is stored on install; the ffmpeg and transcription engines, tens of megabytes each, are stored the first time a job uses them
self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const shell = ['./', './index.html'];
      try {
        const manifest = await (await fetch('./.vite/manifest.json')).json();
        for (const entry of Object.values(manifest)) {
          for (const f of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
            if (f && !f.endsWith('.wasm')) shell.push(`./${f}`);
          }
        }
      } catch {
        // without a manifest the app is stored page by page as it loads
      }
      await cache.addAll([...new Set(shell)]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) =>
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // network first, so a new deploy shows at once; the stored copy serves when offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit ?? Response.error())),
  );
});
