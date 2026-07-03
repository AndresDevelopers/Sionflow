const fs = require('fs');
const path = require('path');

const swPath = path.join(__dirname, '../public/sw.js');

const pushHandlerCode = `
// Custom Push Notification Handlers
self.addEventListener('push', function(event) {
  console.log('[Service Worker] Push Received.');
  
  if (!event.data) {
    console.log('[Service Worker] Push event but no data');
    return;
  }

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    console.error('[Service Worker] Error parsing push data:', e);
    data = {
      title: 'Nueva Notificación',
      body: event.data.text(),
      icon: '/logo.svg',
      badge: '/logo.svg',
    };
  }

  const title = data.title || 'QuorumFlow';
  const options = {
    body: data.body || 'Tienes una nueva notificación',
    icon: data.icon || '/logo.svg',
    badge: data.badge || '/logo.svg',
    data: {
      url: data.url || '/',
      timestamp: data.timestamp || Date.now(),
    },
    vibrate: [200, 100, 200],
    tag: 'quorumflow-notification',
    requireInteraction: true,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  console.log('[Service Worker] Notification click received.');
  
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener('notificationclose', function(event) {
  console.log('[Service Worker] Notification closed', event);
});
`;

// Check if sw.js exists
if (fs.existsSync(swPath)) {
  let swContent = fs.readFileSync(swPath, 'utf8');
  
  // Check if push handler is already injected
  if (!swContent.includes('Custom Push Notification Handlers')) {
    // Append the push handler code
    swContent += '\n' + pushHandlerCode;
    fs.writeFileSync(swPath, swContent, 'utf8');
    console.log('✅ Push notification handlers injected into service worker');
  } else {
    console.log('ℹ️ Push notification handlers already present in service worker');
  }
} else {
  console.log('⚠️ Service worker file not found. It will be generated on build.');
}
