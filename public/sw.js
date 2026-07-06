// Minimal service worker — satisfies Chrome PWA installability criteria.
// No caching: all requests pass through to the network unchanged.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => e.respondWith(fetch(e.request)));
