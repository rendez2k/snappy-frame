// Snappy Frame service worker.
// Strategy: NETWORK-FIRST for page navigations so a new deploy shows up
// immediately whenever you're online (this is what stops the app getting
// "stuck" on an old cached version); cache-first for static assets; and a
// cache fallback so the app still opens offline. Bump CACHE each release.
const CACHE = 'snappy-1.6.20';
const ASSETS = [
  './', './index.html', './vendor/html-to-image.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-512-maskable.png', './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('/.netlify/functions/')) return;  // always network

  const isPage = req.mode === 'navigate' || req.destination === 'document';
  if (isPage) {
    // Network-first: latest page when online, cached shell when offline.
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match(req).then(h => h || caches.match('./index.html')))
    );
    return;
  }
  // Static assets: cache-first, fall back to network then the shell.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res && res.status === 200 && url.origin === location.origin) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match('./index.html'))));
});
