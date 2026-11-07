// Service worker of the Tracker app. It makes the app installable and shows a friendly page when there is no connection.
// It deliberately keeps NOTHING else: no pages, no data, no files of the Tracker (they hold owners, tenants and contracts), so
// nothing private is stored on the phone by the app itself. Every request goes straight to the network.
const VERSION = 'tracker-app-v1';
const OFFLINE = '/tracker-offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll([OFFLINE, '/tracker-icon/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;          // only pages: everything else is left to the browser
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
