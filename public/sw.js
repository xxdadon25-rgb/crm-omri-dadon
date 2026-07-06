// Minimal service worker — satisfies Chrome PWA installability criteria.
// No fetch interception: all requests go directly to the network.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
