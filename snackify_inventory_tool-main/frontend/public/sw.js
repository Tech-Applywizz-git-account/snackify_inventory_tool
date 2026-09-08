// Applywizz Office Pantry — Service Worker
// Handles background push notifications for office boy / staff

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}

  const title   = data.title   || '🔔 New Order';
  const body    = data.body    || 'A new request has been placed.';
  const url     = data.url     || '/queue';
  const tag     = data.tag     || 'pantry-notification';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      tag,
      renotify: true,
      requireInteraction: false,
      data: { url },
      actions: [
        { action: 'open',    title: '📋 Open Queue' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/queue';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
