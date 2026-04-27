// AZ Group CRM — Service Worker для push-уведомлений
self.addEventListener('install', (event) => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'AZ Group CRM', body: event.data.text() }; }
  const title = payload.title || 'AZ Group CRM';
  const options = {
    body: payload.body || '', icon: payload.icon || '/icon-192.png', badge: '/badge-72.png',
    tag: payload.tag, renotify: true, requireInteraction: false,
    data: { url: payload.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) { client.focus(); if ('navigate' in client) client.navigate(url); return; }
      }
      if (clients.openWindow) return clients.openWindow(url);
    }),
  );
});
