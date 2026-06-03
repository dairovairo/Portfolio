// SocialBattery Service Worker — Phase 9 (promotion notifications)
const CACHE_NAME = 'socialbattery-v9';
const STATIC_ASSETS = ['/', '/index.html'];

// Install: cache static shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first so deployed JS/CSS updates are not trapped by old cache.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and API calls
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Push notifications — works in foreground AND background/closed app.
// Ultra events get vibration + requireInteraction so they're not dismissed silently.
self.addEventListener('push', (event) => {
  let data = { title: 'SocialBattery', body: 'Tienes una nueva notificación 🔋' };
  try { data = event.data.json(); } catch {}

  const isUltra = (data.tag || '').startsWith('ultra-event-');

  const notifOptions = {
    body:             data.body,
    icon:             '/icons/icon-192.png',
    badge:            '/icons/badge-72.png',
    tag:              data.tag || 'general',
    renotify:         true,
    data:             { url: data.url || '/community' },
    actions:          data.actions || [],
    // Ultra-specific: keep visible until user taps + vibrate pattern
    requireInteraction: isUltra,
    vibrate:            isUltra ? [200, 100, 200, 100, 400] : [100],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'SocialBattery', notifOptions)
  );
});

// Notification click → open/focus app at the event URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/community';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
