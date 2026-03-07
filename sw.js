const CACHE_NAME = 'aureus-medicos-cbt-v4';
const STATIC_PATHS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/logo.png',
  '/index.css'
];

const CACHEABLE_CORS_ORIGINS = [
  'https://cdn.jsdelivr.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://www.gstatic.com',
  'https://esm.sh'
];

const isCacheableResponse = (response) => {
  return Boolean(response) && (response.status === 200 || response.type === 'opaque');
};

const normalizeAssetUrl = (assetPath) => {
  try {
    return new URL(assetPath, self.location.origin).toString();
  } catch {
    return null;
  }
};

const extractShellAssets = async () => {
  try {
    const response = await fetch('/index.html', { cache: 'no-cache' });
    if (!response.ok) return [];

    const html = await response.text();
    const discovered = new Set(STATIC_PATHS);
    const assetPattern = /<(?:script|link|img|source)[^>]+(?:src|href)=["']([^"']+)["']/gi;
    let match;

    while ((match = assetPattern.exec(html)) !== null) {
      const raw = match[1];
      if (!raw || raw.startsWith('data:')) continue;
      const absoluteUrl = normalizeAssetUrl(raw);
      if (!absoluteUrl) continue;
      const url = new URL(absoluteUrl);
      if (url.origin !== self.location.origin) continue;
      discovered.add(url.pathname);
    }

    return Array.from(discovered);
  } catch {
    return [...STATIC_PATHS];
  }
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const shellAssets = await extractShellAssets();
    await cache.addAll(shellAssets);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isCacheableCors = CACHEABLE_CORS_ORIGINS.includes(requestUrl.origin);

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put('/index.html', response.clone());
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match('/index.html')) || (await cache.match('/'));
      }
    })());
    return;
  }

  if (isSameOrigin || isCacheableCors) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(request);

      const networkFetch = fetch(request)
        .then((networkResponse) => {
          if (isCacheableResponse(networkResponse)) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkFetch;
    })());
    return;
  }

  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Aureus Medicos CBT', body: 'You have a new notification.', url: '/' };
  try {
    const data = event.data?.json?.();
    if (data && typeof data === 'object') {
      payload = {
        title: String(data.title || payload.title),
        body: String(data.body || payload.body),
        url: String(data.url || payload.url)
      };
    } else if (event.data) {
      payload.body = event.data.text();
    }
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url },
      icon: '/assets/logo.png',
      badge: '/assets/logo.png'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        client.focus();
        client.navigate(targetUrl);
        return;
      }
    }
    if (clients.openWindow) {
      await clients.openWindow(targetUrl);
    }
  })());
});
