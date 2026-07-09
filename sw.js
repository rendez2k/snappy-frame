// Snappy Frame service worker — precache the app shell so it loads offline.
// Bump CACHE on every release so clients pick up the new build.
const CACHE = 'snappy-v1.6';
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
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // The webpage-grab function must always hit the network (never cache a screenshot).
  if (url.pathname.includes('/.netlify/functions/')) return;
  // Cache-first for our own assets, network fallback (and network for cross-origin).
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res && res.status === 200 && url.origin === location.origin) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match('./index.html'))));
});
