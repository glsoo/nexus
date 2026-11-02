// Shows Nexus's Web Push messages (a chat finished or needs you) and opens that chat when one is tapped.
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => e.waitUntil((async () => {
  const { title = 'Nexus', body = '', project = '' } = e.data?.json() || {};
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  // Someone looking at Nexus already sees it. Safari drops subscriptions that receive a push without a notification, so it always shows one.
  const safari = /Safari/.test(navigator.userAgent) && !/Chrom|Edg|Android/.test(navigator.userAgent);
  if (!safari && windows.some(w => w.focused && w.visibilityState === 'visible')) return;
  await self.registration.showNotification(title, { body, tag: `nexus-${project}`, renotify: true, icon: '/icon-180.png', data: { project } });
})()));

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { project } = e.notification.data || {};
  e.waitUntil((async () => {
    const [win] = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (!win) return self.clients.openWindow(project ? `/#/p/${encodeURIComponent(project)}/chat` : '/');
    await win.focus();
    if (project) win.postMessage({ open: project });
  })());
});
