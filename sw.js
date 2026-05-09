/* GradTracker v1.4.0 — Service Worker */
const CACHE_NAME = 'gradtracker-v1.4.0';
const PRECACHE = ['./', './index.html', './styles.css', './app.js', './manifest.json'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k!==CACHE_NAME).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin === self.location.origin) {
    e.respondWith(caches.match(e.request).then(c => c || fetch(e.request).then(r => {
      if (r && r.status===200) { const cl=r.clone(); caches.open(CACHE_NAME).then(ca=>ca.put(e.request,cl)); }
      return r;
    }).catch(()=>caches.match('./index.html'))));
  } else { e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))); }
});
