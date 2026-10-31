// Network first so updates show up right away; the cache only serves the app offline (e.g. gym without signal).
const CACHE = 'vbt-v3';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'css/style.css',
  'js/main.js', 'js/analysis.js', 'js/protocol.js', 'js/sensor.js', 'js/settings.js', 'js/history.js',
  'js/zones.js', 'js/ui.js', 'js/progress.js', 'demo/recording.json',
  'fonts/barlow-condensed-latin-500.woff2', 'fonts/barlow-condensed-latin-600.woff2',
  'fonts/barlow-condensed-latin-ext-500.woff2', 'fonts/barlow-condensed-latin-ext-600.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
