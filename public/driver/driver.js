const $ = (selector) => document.querySelector(selector);
const state = { user: null, orders: [], filter: 'active', offline: !navigator.onLine, currentOrderId: null };
function finishBoot() {
  const boot = $('#boot');
  if (!boot) return;
  boot.classList.add('leave');
  setTimeout(() => boot.remove(), 260);
}
function showLogin() {
  $('#login').hidden = false;
  $('#login').style.display = 'grid';
  finishBoot();
}
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );
const moscowIsoDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86400000));
const orderListDate = () => (state.filter === 'tomorrow' ? moscowIsoDate(1) : moscowIsoDate());
const isoFromSheetDate = (value) => {
  const parts = String(value || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return parts ? `${parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}` : moscowIsoDate();
};
const offlineOrderKey = (order) =>
  `${isoFromSheetDate(order.date)}:${String(order.orderNumber || order.id || '').trim()}`;
const clientFromBitrixTitle = (title) =>
  String(title || '')
    .replace(/^\s*\([^)]+\)\s*/, '')
    .replace(/^АФУТ-\d+\s*/i, '')
    .trim();
let queueSyncPromise = null;
let queueSyncAgain = false;

// eslint-disable-next-line no-redeclare
const DriverOffline = {
  db() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('akfix-driver-offline', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('details')) db.createObjectStore('details', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  async get(store, key) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result?.value ?? request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  },
  async put(store, value) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },
  async remove(store, key) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },
  async all(store) {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store).objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  saveUser(user) {
    localStorage.setItem('akfix_driver_user', JSON.stringify(user));
  },
  savedUser() {
    try {
      return JSON.parse(localStorage.getItem('akfix_driver_user'));
    } catch {
      return null;
    }
  },
  saveOrders(login, date, orders) {
    return this.put('meta', { key: `orders:${login}:${date}`, value: orders, savedAt: new Date().toISOString() });
  },
  loadOrders(login, date) {
    return this.get('meta', `orders:${login}:${date}`);
  },
  saveHistory(login, date, orders) {
    return this.put('meta', { key: `history:${login}:${date}`, value: orders, savedAt: new Date().toISOString() });
  },
  loadHistory(login, date) {
    return this.get('meta', `history:${login}:${date}`);
  },
  saveDetail(login, id, detail) {
    return this.put('details', { key: `${login}:${id}`, value: detail, savedAt: new Date().toISOString() });
  },
  loadDetail(login, id) {
    return this.get('details', `${login}:${id}`);
  },
  enqueue(user, order, photo) {
    return this.put('queue', {
      id: window.crypto.randomUUID(),
      userLogin: user.login,
      order,
      photo: photo || null,
      photoName: photo?.name || 'expeditor.jpg',
      createdAt: new Date().toISOString(),
    });
  },
  async queued(login) {
    return (await this.all('queue')).filter((item) => item.userLogin === login);
  },
};

function toast(text) {
  $('#toast').textContent = text;
  $('#toast').classList.add('show');
  setTimeout(() => $('#toast').classList.remove('show'), 2400);
}

async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ошибка загрузки');
  return data;
}

function setSyncText(text, offline = false) {
  $('#sync').textContent = text;
  $('#sync').style.color = offline ? '#b36a00' : '';
}

async function start(user) {
  if (user.role !== 'driver') {
    location.href = '/';
    return;
  }
  state.user = user;
  DriverOffline.saveUser(user);
  $('#login').hidden = true;
  $('#login').style.display = 'none';
  $('#app').hidden = false;
  $('#app').style.display = 'block';
  finishBoot();
  $('#userName').textContent = user.name;
  await loadOrders();
  if (navigator.onLine) syncQueue();
}

async function loadOrders() {
  const date = orderListDate();
  setSyncText(
    navigator.onLine ? 'Обновляем назначения…' : 'Нет интернета · открываем сохранённые данные',
    !navigator.onLine
  );
  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    state.orders = (await api(`/api/driver/orders?date=${encodeURIComponent(date)}`)).items;
    await DriverOffline.saveOrders(state.user.login, date, state.orders);
    cacheOrderDetails(state.orders, date);
    setSyncText(
      `${state.filter === 'tomorrow' ? 'На завтра' : 'Назначено'}: ${state.orders.length} · обновлено ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    );
  } catch {
    state.orders = (await DriverOffline.loadOrders(state.user.login, date)) || [];
    const queued = await DriverOffline.queued(state.user.login);
    state.orders = state.orders.map((order) => {
      const pending = queued.find((item) => offlineOrderKey(item.order) === offlineOrderKey(order));
      return pending ? { ...order, completed: { queued: true, completedAt: pending.createdAt } } : order;
    });
    setSyncText(
      state.orders.length
        ? `Офлайн · сохранено заказов: ${state.orders.length}`
        : 'Офлайн · сохранённых заказов пока нет',
      true
    );
  }
  renderOrders();
}

async function cacheOrderDetails(orders, date) {
  await Promise.allSettled(
    orders.map(async (order) => {
      const detail = await api(`/api/driver/order?id=${encodeURIComponent(order.id)}&date=${encodeURIComponent(date)}`);
      if (!order.client) {
        const client = clientFromBitrixTitle(detail.bitrix?.title);
        if (client) {
          order.client = client;
          detail.order = { ...detail.order, client };
        }
      }
      await DriverOffline.saveDetail(state.user.login, order.id, detail);
    })
  );
  if (state.orders === orders) renderOrders();
}

function renderOrders() {
  const rows = ['history', 'tomorrow'].includes(state.filter)
    ? state.orders
    : state.orders.filter((order) => (state.filter === 'done' ? order.completed : !order.completed));
  $('#orders').innerHTML =
    rows
      .map(
        (order) =>
          `<button class="order" data-id="${esc(order.id)}"><div><time>${esc(order.date || 'Дата не указана')}</time><h3>${esc(order.client || 'Клиент не указан')}${order.isGroup ? ` · ${order.orderNumbers.length} заказа` : ''}</h3><p>${order.isGroup ? 'Заказы' : 'Заказ'} № ${esc(order.orderNumber || '—')} · ${esc(order.warehouse || 'Склад не указан')}</p><span class="tag ${/^тк(?:\s|$)/i.test(order.delivery) ? 'tk' : ''}">${esc(order.delivery || 'Доставка не указана')}</span>${order.completed ? `<div class="delivery-status ${order.completed.queued ? 'status-waiting' : 'status-success'}"><i></i>${order.completed.queued ? 'Ожидает отправки' : 'Отправлено'}</div>` : '<div class="delivery-status status-neutral"><i></i>Не начат</div>'}</div><span class="chev">›</span></button>`
      )
      .join('') || '<div class="empty">В этом разделе пока нет рейсов</div>';
  document.querySelectorAll('[data-id]').forEach((button) => (button.onclick = () => openOrder(button.dataset.id)));
}

async function loadHistory() {
  const date = $('#historyDate').value;
  if (!date) return;
  setSyncText(
    navigator.onLine ? 'Загружаем историю рейсов…' : 'Офлайн · открываем сохранённую историю',
    !navigator.onLine
  );
  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    state.orders = (await api(`/api/driver/history?date=${encodeURIComponent(date)}`)).items;
    await DriverOffline.saveHistory(state.user.login, date, state.orders);
    setSyncText(
      `История за ${new Date(date + 'T12:00:00').toLocaleDateString('ru-RU')} · ${state.orders.length} рейсов`
    );
  } catch {
    state.orders = (await DriverOffline.loadHistory(state.user.login, date)) || [];
    setSyncText(
      state.orders.length
        ? `Офлайн · история за ${new Date(date + 'T12:00:00').toLocaleDateString('ru-RU')}`
        : 'За эту дату сохранённых рейсов нет',
      true
    );
  }
  renderOrders();
}

function renderDetail({ order, bitrix, completed }) {
  const needsPhoto = /^тк(?:\s|$)/i.test(order.delivery);
  const isCdek = /сдэк/i.test(order.delivery);
  const fields = Array.isArray(bitrix?.fields) ? bitrix.fields : [];
  const bitrixNumber = isCdek ? '' : String(bitrix?.title || '').match(/АФУТ-\d+/i)?.[0] || '';
  const client = order.client || clientFromBitrixTitle(bitrix?.title) || 'Заказ';
  const orderLabel = order.isGroup
    ? `Заказы № ${order.orderNumbers.join(', ')}`
    : `Заказ № ${order.orderNumber || '—'}`;
  const groupPanel = order.isGroup
    ? `<div class="panel"><h2>Общий рейс</h2><div class="bitrix">${order.orderNumbers.map((number) => `<div><span>Заказ</span>№ ${esc(number)}</div>`).join('')}</div><p class="note">Одна экспедиторская расписка будет сохранена во всех связанных сделках.</p></div>`
    : '';
  const bitrixPanel = isCdek
    ? ''
    : `<div class="panel"><h2>Доставка из Битрикс24</h2><div class="bitrix">${fields.length ? fields.map((field) => `<div><span>${esc(field.label)}</span>${esc(field.value)}</div>`).join('') : '<p class="note">Поля доставки в сделке не заполнены.</p>'}</div></div>`;
  const receiptPanel =
    completed?.photo && !completed.queued
      ? `<div class="panel receipt"><h2>Фото экспедиторской расписки</h2><a class="receipt-preview" href="/api/driver/photo/${encodeURIComponent(completed.photo.id)}" target="_blank" rel="noopener"><img src="/api/driver/photo/${encodeURIComponent(completed.photo.id)}" alt="Фото экспедиторской расписки"></a><a class="secondary receipt-download" href="/api/driver/photo/${encodeURIComponent(completed.photo.id)}?download=1" download>Скачать фотографию</a></div>`
      : '';
  $('#detail').innerHTML =
    `<div class="hero"><p class="hero-order">${esc(orderLabel)}${!order.isGroup && bitrixNumber ? ` · Bitrix ${esc(bitrixNumber)}` : ''}</p><h1>${esc(client)}</h1></div><div class="panel facts"><div class="fact"><small>Дата</small><b>${esc(order.date || '—')}</b></div><div class="fact"><small>Склад</small><b>${esc(order.warehouse || '—')}</b></div><div class="fact"><small>Доставка</small><b>${esc(order.delivery || '—')}</b></div><div class="fact"><small>Документы</small><b>${esc(order.documents || '—')}</b></div><div class="fact"><small>Честный знак</small><b>${esc(order.marking || '—')}</b></div><div class="fact"><small>Перебивка</small><b>${esc(order.relabel || '—')}</b></div></div>${groupPanel}${bitrixPanel}${completed ? `<div class="panel done-mark">${completed.queued ? (navigator.onLine ? '✓ Принято. Отправляем в фоне — можно продолжать работу.' : '◷ Сохранено на телефоне. Отправится после появления интернета.') : '✓ Рейс завершён ' + new Date(completed.completedAt).toLocaleString('ru-RU')}</div>${receiptPanel}` : `<form id="completeForm" class="panel"><h2>${needsPhoto ? 'Фото экспедиторской обязательно' : 'Завершение рейса'}</h2>${needsPhoto ? '<label id="upload" class="upload"><span>📷 Сфотографировать экспедиторскую</span><input id="photo" type="file" accept="image/*" capture="environment" required></label>' : '<p class="note">Подтвердите, что груз отправлен.</p>'}<button id="complete" class="primary" ${needsPhoto ? 'disabled' : ''}>Груз отправлен</button></form>`}`;
  if (!completed) {
    const photo = $('#photo');
    if (photo)
      photo.onchange = () => {
        $('#upload').classList.toggle('has', Boolean(photo.files[0]));
        $('#upload span').textContent = photo.files[0]
          ? '✓ Фото сохранено на телефоне'
          : '📷 Сфотографировать экспедиторскую';
        $('#complete').disabled = !photo.files[0];
      };
    $('#completeForm').onsubmit = (event) => complete(event, order);
  }
}

async function openOrder(id) {
  state.currentOrderId = id;
  $('#listScreen').hidden = true;
  $('#detailScreen').hidden = false;
  $('#detail').innerHTML = '<div class="empty">Открываем заказ…</div>';
  try {
    let detail = null;
    let onlineError = null;
    if (state.filter === 'history') {
      const order = state.orders.find((item) => String(item.id) === String(id));
      if (order) detail = { order, bitrix: null, completed: order.completed };
    }
    if (!detail && navigator.onLine) {
      try {
        detail = await api(
          `/api/driver/order?id=${encodeURIComponent(id)}&date=${encodeURIComponent(orderListDate())}`
        );
        await DriverOffline.saveDetail(state.user.login, id, detail);
      } catch (error) {
        onlineError = error;
        detail = await DriverOffline.loadDetail(state.user.login, id);
      }
    } else if (!detail) detail = await DriverOffline.loadDetail(state.user.login, id);
    if (!detail) throw onlineError || new Error('NO_OFFLINE_DETAIL');
    const pending = (await DriverOffline.queued(state.user.login)).find(
      (item) => offlineOrderKey(item.order) === offlineOrderKey(detail.order)
    );
    if (pending) detail.completed = { queued: true, completedAt: pending.createdAt };
    renderDetail(detail);
  } catch {
    $('#detail').innerHTML = navigator.onLine
      ? '<div class="empty"><b>Не удалось загрузить карточку</b><p>Обновите данные и попробуйте открыть рейс ещё раз.</p><button class="secondary" id="retryDetail">Повторить</button></div>'
      : '<div class="empty">Эта карточка ещё не была загружена на телефон. Откройте её один раз с интернетом.</div>';
    const retry = $('#retryDetail');
    if (retry) retry.onclick = () => openOrder(id);
  }
}

async function markQueued(order, photo) {
  const [, cachedDetail] = await Promise.all([
    DriverOffline.enqueue(state.user, order, photo),
    DriverOffline.loadDetail(state.user.login, order.id),
  ]);
  const completed = { queued: true, completedAt: new Date().toISOString() };
  const current = state.orders.find((item) => String(item.id) === String(order.id));
  if (current) current.completed = completed;
  DriverOffline.saveOrders(state.user.login, isoFromSheetDate(order.date), state.orders).catch(() => {});
  toast(navigator.onLine ? 'Принято. Отправляем в фоне.' : 'Сохранено. Отправим после появления интернета.');
  renderDetail({
    order,
    bitrix: cachedDetail?.bitrix,
    completed,
  });
  scheduleQueuedUpload();
}

function scheduleQueuedUpload() {
  if (navigator.onLine) syncQueue();
  const ready = navigator.serviceWorker?.ready;
  if (!ready) return;
  ready
    .then((registration) => {
      if (registration.sync?.register) return registration.sync.register('akfix-driver-upload');
      return null;
    })
    .catch(() => {});
}

async function complete(event, order) {
  event.preventDefault();
  const button = $('#complete');
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  const photo = await optimizePhoto($('#photo')?.files[0] || null);
  try {
    await markQueued(order, photo);
  } catch {
    toast('Не удалось сохранить отправку. Повторите ещё раз.');
    button.disabled = false;
    button.textContent = 'Груз отправлен';
  }
}

async function optimizePhoto(photo) {
  if (!photo || photo.size <= 6 * 1024 * 1024) return photo;
  try {
    const image = await decodePhoto(photo);
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return photo;
    context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
    image.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob || blob.size >= photo.size) return photo;
    return new window.File([blob], String(photo.name || 'expeditor.jpg').replace(/\.[^.]+$/, '.jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return photo;
  }
}

async function decodePhoto(photo) {
  if (typeof window.createImageBitmap === 'function') {
    try {
      const bitmap = await window.createImageBitmap(photo);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Safari can reject a camera file here even though an HTML image can decode it.
    }
  }
  const url = window.URL.createObjectURL(photo);
  try {
    const image = new window.Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => {} };
  } finally {
    window.URL.revokeObjectURL(url);
  }
}

function syncQueue() {
  if (queueSyncPromise) {
    queueSyncAgain = true;
    return queueSyncPromise;
  }
  queueSyncPromise = (async () => {
    do {
      queueSyncAgain = false;
      await syncQueueOnce();
    } while (queueSyncAgain);
  })().finally(() => {
    queueSyncPromise = null;
  });
  return queueSyncPromise;
}

async function syncQueueOnce() {
  if (!navigator.onLine || !state.user) return;
  const items = (await DriverOffline.queued(state.user.login)).sort((left, right) =>
    String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
  );
  let sent = 0;
  let failed = 0;
  for (const item of items) {
    const optimizedPhoto = await optimizePhoto(item.photo);
    if (optimizedPhoto && optimizedPhoto !== item.photo) {
      item.photo = optimizedPhoto;
      item.photoName = optimizedPhoto.name;
      await DriverOffline.put('queue', item);
    }
    const form = new FormData();
    form.set('orderId', item.order.id);
    form.set('orderNumber', item.order.orderNumber || '');
    form.set('date', isoFromSheetDate(item.order.date));
    if (item.photo) form.append('expeditorPhoto', item.photo, item.photoName);
    try {
      await api('/api/driver/complete', { method: 'POST', body: form });
      await DriverOffline.remove('queue', item.id);
      sent++;
    } catch {
      failed++;
    }
  }
  if (sent) {
    await loadOrders();
    if (state.currentOrderId) await openOrder(state.currentOrderId);
  }
  if (failed) {
    toast(
      sent ? `Отправлено: ${sent}. Осталось на повтор: ${failed}` : `Не отправлено: ${failed}. Повторим автоматически.`
    );
  } else if (sent) toast(`Отправлено из очереди: ${sent}`);
}

setInterval(() => {
  if (navigator.onLine && state.user) syncQueue();
}, 30000);

$('#loginForm').onsubmit = async (event) => {
  event.preventDefault();
  $('#loginError').textContent = '';
  try {
    start(
      (
        await api('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ login: $('#loginInput').value, pin: $('#pinInput').value }),
        })
      ).user
    );
  } catch {
    $('#loginError').textContent = 'Неверный логин или PIN-код';
  }
};

$('#refresh').onclick = () => (state.filter === 'history' ? loadHistory() : loadOrders());
$('#historyDate').max = new Date().toISOString().slice(0, 10);
$('#historyDate').value = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
$('#historyDate').onchange = loadHistory;
$('#back').onclick = () => {
  state.currentOrderId = null;
  $('#detailScreen').hidden = true;
  $('#listScreen').hidden = false;
};
$('#logout').onclick = async () => {
  localStorage.removeItem('akfix_driver_user');
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
};
document.querySelectorAll('[data-filter]').forEach(
  (button) =>
    (button.onclick = () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
      $('#historyCalendar').hidden = state.filter !== 'history';
      if (state.filter === 'history') loadHistory();
      else loadOrders();
    })
);

addEventListener('online', () => {
  state.offline = false;
  toast('Интернет появился. Отправляем сохранённые данные…');
  syncQueue();
  state.filter === 'history' ? loadHistory() : loadOrders();
});
addEventListener('offline', () => {
  state.offline = true;
  toast('Нет интернета. Можно продолжать работу офлайн.');
  setSyncText(`Офлайн · сохранено заказов: ${state.orders.length}`, true);
});

if ('serviceWorker' in navigator) {
  setTimeout(() => sessionStorage.removeItem('akfix-driver-sw-reload'), 5000);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (sessionStorage.getItem('akfix-driver-sw-reload') === '1') return;
    sessionStorage.setItem('akfix-driver-sw-reload', '1');
    location.reload();
  });
  navigator.serviceWorker
    .register('/sw.js', { updateViaCache: 'none' })
    .then((registration) => registration.update())
    .catch(() => {});
}
fetch('/api/session', { cache: 'no-store' })
  .then(async (response) => {
    if (response.ok) start((await response.json()).user);
    else if (!navigator.onLine && DriverOffline.savedUser()) start(DriverOffline.savedUser());
    else showLogin();
  })
  .catch(() => {
    const user = DriverOffline.savedUser();
    if (user) start(user);
    else showLogin();
  });
