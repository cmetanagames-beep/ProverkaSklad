const CACHE = 'akfix-shell-v18';
const ASSETS = [
  '/', '/index.html', '/assets/styles.css', '/assets/strict-ui.css', '/assets/order-status.css', '/assets/nav-fix.css', '/assets/app.js', '/assets/offline.js',
  '/assets/role-router.js', '/assets/logo.svg', '/assets/app-loading.css', '/assets/app-loading.js', '/manifest.webmanifest',
  '/driver/', '/driver/index.html', '/driver/driver.css', '/driver/driver-fix.css', '/driver/driver.js?v=18',
  '/logist/', '/logist/index.html', '/logist/logist.css', '/logist/logist.js',
  '/admin.html', '/assets/admin.css', '/assets/admin-users.css', '/assets/admin-strict.css', '/assets/admin.js',
  '/receiving/styles.css', '/receiving/scanner.css', '/receiving/app.js', '/receiving/exceljs.min.js',
];

function navigationKey(pathname) {
  if (pathname.startsWith('/driver')) return '/driver/index.html';
  if (pathname.startsWith('/logist')) return '/logist/index.html';
  if (pathname.startsWith('/receiving')) return '/receiving/';
  if (pathname.startsWith('/admin')) return '/admin.html';
  return '/index.html';
}

self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
));

self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request, { cache:'no-store' }).then(response => {
      if (response.ok) {
        const key = event.request.mode === 'navigate'
          ? navigationKey(url.pathname)
          : event.request;
        caches.open(CACHE).then(cache => cache.put(key, response.clone()));
      }
      return response;
    }).catch(() => {
      if (event.request.mode === 'navigate') return caches.match(navigationKey(url.pathname));
      return caches.match(event.request);
    })
  );
});

self.addEventListener('sync', event => {
  if (event.tag === 'akfix-upload') event.waitUntil(syncWarehouseUploads());
  if (event.tag === 'akfix-driver-upload') event.waitUntil(syncDriverUploads());
});

function warehouseDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('akfix-offline', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('uploads', { keyPath:'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function driverDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('akfix-driver-offline', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath:'key' });
      if (!db.objectStoreNames.contains('details')) db.createObjectStore('details', { keyPath:'key' });
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath:'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function all(dbPromise, store) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function remove(dbPromise, store, id) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function syncWarehouseUploads() {
  const session = await fetch('/api/session');
  if (!session.ok) throw new Error('AUTH_REQUIRED');
  const current = (await session.json()).user;
  for (const item of (await all(warehouseDb(), 'uploads')).filter(row => row.userLogin === current.login)) {
    const form = new FormData();
    Object.entries(item.fields).forEach(([key,value]) => form.set(key, value));
    item.files.forEach(file => form.append(file.key, file.blob, file.name));
    const response = await fetch('/api/checks/complete', { method:'POST', body:form });
    if (!response.ok) throw new Error(`UPLOAD_${response.status}`);
    await remove(warehouseDb(), 'uploads', item.id);
  }
}

async function syncDriverUploads() {
  const session = await fetch('/api/session');
  if (!session.ok) throw new Error('AUTH_REQUIRED');
  const current = (await session.json()).user;
  const items = (await all(driverDb(), 'queue'))
    .filter(row => row.userLogin === current.login)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
  let failed = 0;
  for (const item of items) {
    try {
      const form = new FormData();
      form.set('orderId', item.order.id);
      form.set('orderNumber', item.order.orderNumber || '');
      const date = String(item.order.date || '');
      const match = date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      form.set('date', match ? `${match[3]}-${match[2]}-${match[1]}` : date.slice(0, 10));
      if (item.photo) form.append('expeditorPhoto', item.photo, item.photoName || 'expeditor.jpg');
      const response = await fetch('/api/driver/complete', { method:'POST', body:form });
      if (!response.ok) throw new Error(`DRIVER_UPLOAD_${response.status}`);
      await remove(driverDb(), 'queue', item.id);
    } catch {
      failed++;
    }
  }
  if (failed) throw new Error(`DRIVER_UPLOAD_FAILED_${failed}`);
}
