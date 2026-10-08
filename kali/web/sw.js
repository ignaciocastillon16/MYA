// Service worker del area de equipo: muestra los avisos push aunque la app este cerrada.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { cuerpo: event.data ? event.data.text() : '' };
  }
  event.waitUntil(self.registration.showNotification(datos.titulo || 'Kali Equipo', {
    body: datos.cuerpo || '',
    icon: 'img/logo.png',
    badge: 'img/logo.png',
    timestamp: Date.now(),
    data: { url: datos.url || 'admin.html#hoy' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL(event.notification.data?.url || 'admin.html#hoy', self.registration.scope).href;
  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const v of ventanas) {
      if (v.url.startsWith(self.registration.scope)) {
        await v.focus();
        if ('navigate' in v) await v.navigate(destino);
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
