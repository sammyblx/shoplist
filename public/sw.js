const CACHE = 'shoplist-v1';
const PRECACHE = ['/', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Let Google API / GIS requests go straight to network (never cache)
  if (url.origin !== location.origin) return;

  // Navigation requests: network-first, fall back to cached index for offline SPA
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('/'))
    );
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(resp => {
        if (resp.ok && request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return resp;
      });
    })
  );
});
