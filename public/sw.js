// 웹 푸시 알림용 서비스워커. 새 주문이 들어올 때 서버(lib/webpush.ts)가
// 이 앱을 설치한 각 기기로 푸시를 보내면, 여기서 받아서 알림을 띄운다.

self.addEventListener('push', (event) => {
  let data = { title: '새 주문', body: '' };
  try {
    data = event.data.json();
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'HION HUB', {
      body: data.body || '',
      icon: '/logo.png',
      badge: '/logo.png',
      data: { url: data.url || '/dashboard/inventory/stock' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard/inventory/stock';
  event.waitUntil(clients.openWindow(url));
});
