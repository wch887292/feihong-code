/**
 * 飞虹 Code Service Worker
 * 支持离线缓存、PWA 安装、移动端适配
 */

const CACHE_NAME = 'feihong-code-v2';
const STATIC_CACHE = 'feihong-static-v2';
const RUNTIME_CACHE = 'feihong-runtime-v2';

// 静态资源缓存列表
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/app.js',
  '/js/ui.js',
  '/js/api.js',
  '/js/utils.js',
  '/js/monaco-editor.js',
];

// 安装事件：预缓存静态资源
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[SW] Pre-caching static assets');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-cache failed:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// 激活事件：清理旧缓存
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== STATIC_CACHE && name !== RUNTIME_CACHE)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

//  fetch 事件：缓存策略
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只缓存同源请求
  if (url.origin !== self.location.origin) {
    return;
  }

  // API 请求：直接透传，不缓存（API 响应是动态的，缓存会导致公钥/认证/模型配置等数据过期）
  if (url.pathname.startsWith('/api/')) {
    // 安全相关 API 强制不缓存，直接走网络
    return;
  }

  // 静态资源：缓存优先，失败时回退到网络
  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => {
          // 对于 HTML 请求，返回离线页面
          if (request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/index.html');
          }
          return new Response('Offline', { status: 503 });
        });
      })
    );
  }
});

// 消息事件：支持手动更新缓存
self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (type === 'CLEAR_CACHE') {
    caches.keys().then((names) => {
      names.forEach((name) => caches.delete(name));
    });
  }

  if (type === 'GET_VERSION') {
    event.source.postMessage({
      type: 'VERSION',
      version: CACHE_NAME,
      staticCache: STATIC_CACHE,
      runtimeCache: RUNTIME_CACHE,
    });
  }
});

// 推送通知（预留）
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    const title = data.title || '飞虹 Code';
    const options = {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: data.data || {},
    };
    event.waitUntil(self.registration.showNotification(title, options));
  }
});

// 通知点击
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.openWindow(url).catch(() => {
      return clients.matchAll({ type: 'window' }).then((clientList) => {
        for (const client of clientList) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(url);
      });
    })
  );
});

console.log('[SW] Service Worker loaded');
