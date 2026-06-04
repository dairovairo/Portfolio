// SocialBattery Service Worker — Phase 10 (premium + ultra notifications)
const CACHE_NAME = 'socialbattery-v10';
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
//
//  · ultra-event-*   → requireInteraction + strong vibration (user must tap to dismiss)
//  · premium-event-* → medium vibration, standard dismissal
//  · others          → minimal vibration
self.addEventListener('push', (event) => {
  let data = { title: 'SocialBattery', body: 'Tienes una nueva notificación 🔋' };
  try { data = event.data.json(); } catch {}

  const tag = data.tag || '';
  const isUltra      = tag.startsWith('ultra-event-');
  const isPremium    = tag.startsWith('premium-event-');
  const isEventUpdate = tag.startsWith('event-update-');
  const isGroupMsg   = tag.startsWith('group-');

  const notifOptions = {
    body:    data.body,
    icon:    '/icons/icon-192.png',
    badge:   '/icons/badge-72.png',
    tag:     tag || 'general',
    renotify: true,
    data:    { url: data.url || '/community' },
    actions: data.actions || [],
    // Ultra: keep on screen until the user taps + strong vibration pattern
    // Premium: standard dismissal + softer double-pulse
    // Event update: medium single-pulse, standard dismissal
    // Basic: single short vibration
    requireInteraction: isUltra,
    vibrate: isUltra
      ? [200, 100, 200, 100, 400]
      : isPremium
        ? [150, 80, 150]
        : isEventUpdate
          ? [120, 60, 120]
          : isGroupMsg
            ? [80, 50, 80]
            : [100],
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
