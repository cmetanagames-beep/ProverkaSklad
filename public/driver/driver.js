const $ = selector => document.querySelector(selector);
const state = { user: null, orders: [], filter: 'active', offline: !navigator.onLine };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));

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
  saveUser(user) { localStorage.setItem('akfix_driver_user', JSON.stringify(user)); },
  savedUser() { try { return JSON.parse(localStorage.getItem('akfix_driver_user')); } catch { return null; } },
  saveOrders(login, orders) { return this.put('meta', { key: `orders:${login}`, value: orders, savedAt: new Date().toISOString() }); },
  loadOrders(login) { return this.get('meta', `orders:${login}`); },
  saveHistory(login, date, orders) { return this.put('meta', { key: `history:${login}:${date}`, value: orders, savedAt: new Date().toISOString() }); },
  loadHistory(login, date) { return this.get('meta', `history:${login}:${date}`); },
  saveDetail(login, id, detail) { return this.put('details', { key: `${login}:${id}`, value: detail, savedAt: new Date().toISOString() }); },
  loadDetail(login, id) { return this.get('details', `${login}:${id}`); },
  enqueue(user, order, photo) {
    return this.put('queue', { id: crypto.randomUUID(), userLogin: user.login, order, photo: photo || null, photoName: photo?.name || 'expeditor.jpg', createdAt: new Date().toISOString() });
  },
  async queued(login) { return (await this.all('queue')).filter(item => item.userLogin === login); },
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
  if (user.role !== 'driver') { location.href = '/'; return; }
  state.user = user;
  DriverOffline.saveUser(user);
  $('#login').hidden = true;
  $('#login').style.display = 'none';
  $('#app').hidden = false;
  $('#app').style.display = 'block';
  $('#userName').textContent = user.name;
  await loadOrders();
  if (navigator.onLine) syncQueue();
}

async function loadOrders() {
  setSyncText(navigator.onLine ? 'Обновляем назначения…' : 'Нет интернета · открываем сохранённые данные', !navigator.onLine);
  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    state.orders = (await api('/api/driver/orders')).items;
    await DriverOffline.saveOrders(state.user.login, state.orders);
    cacheOrderDetails(state.orders);
    setSyncText(`Назначено: ${state.orders.length} · обновлено ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`);
  } catch {
    state.orders = await DriverOffline.loadOrders(state.user.login) || [];
    const queued = await DriverOffline.queued(state.user.login);
    state.orders = state.orders.map(order => {
      const pending = queued.find(item => item.order.id === order.id);
      return pending ? { ...order, completed: { queued: true, completedAt: pending.createdAt } } : order;
    });
    setSyncText(state.orders.length ? `Офлайн · сохранено заказов: ${state.orders.length}` : 'Офлайн · сохранённых заказов пока нет', true);
  }
  renderOrders();
}

async function cacheOrderDetails(orders) {
  await Promise.allSettled(orders.map(async order => {
    const detail = await api(`/api/driver/order?id=${encodeURIComponent(order.id)}`);
    await DriverOffline.saveDetail(state.user.login, order.id, detail);
  }));
}

function renderOrders() {
  const rows = state.filter === 'history' ? state.orders : state.orders.filter(order => state.filter === 'done' ? order.completed : !order.completed);
  $('#orders').innerHTML = rows.map(order => `<button class="order" data-id="${esc(order.id)}"><div><time>${esc(order.date || 'Дата не указана')}</time><h3>${esc(order.client || 'Клиент не указан')}</h3><p>Заказ № ${esc(order.orderNumber || '—')} · ${esc(order.warehouse || 'Склад не указан')}</p><span class="tag ${/^тк(?:\s|$)/i.test(order.delivery) ? 'tk' : ''}">${esc(order.delivery || 'Доставка не указана')}</span>${order.completed ? `<div class="done-mark">${order.completed.queued ? '◷ Ожидает отправки' : '✓ Отправлено'}</div>` : ''}</div><span class="chev">›</span></button>`).join('') || '<div class="empty">В этом разделе пока нет рейсов</div>';
  document.querySelectorAll('[data-id]').forEach(button => button.onclick = () => openOrder(button.dataset.id));
}

async function loadHistory() {
  const date = $('#historyDate').value;
  if (!date) return;
  setSyncText(navigator.onLine ? 'Загружаем историю рейсов…' : 'Офлайн · открываем сохранённую историю', !navigator.onLine);
  try {
    if (!navigator.onLine) throw new Error('OFFLINE');
    state.orders = (await api(`/api/driver/history?date=${encodeURIComponent(date)}`)).items;
    await DriverOffline.saveHistory(state.user.login, date, state.orders);
    setSyncText(`История за ${new Date(date + 'T12:00:00').toLocaleDateString('ru-RU')} · ${state.orders.length} рейсов`);
  } catch {
    state.orders = await DriverOffline.loadHistory(state.user.login, date) || [];
    setSyncText(state.orders.length ? `Офлайн · история за ${new Date(date + 'T12:00:00').toLocaleDateString('ru-RU')}` : 'За эту дату сохранённых рейсов нет', true);
  }
  renderOrders();
}

function renderDetail({ order, bitrix, completed }) {
  const needsPhoto = /^тк(?:\s|$)/i.test(order.delivery);
  const fields = Array.isArray(bitrix?.fields) ? bitrix.fields : [];
  $('#detail').innerHTML = `<div class="hero"><h1>${esc(order.client || 'Заказ')}</h1><p>Заказ № ${esc(order.orderNumber || '—')}</p></div><div class="panel facts"><div class="fact"><small>Дата</small><b>${esc(order.date || '—')}</b></div><div class="fact"><small>Склад</small><b>${esc(order.warehouse || '—')}</b></div><div class="fact"><small>Доставка</small><b>${esc(order.delivery || '—')}</b></div><div class="fact"><small>Документы</small><b>${esc(order.documents || '—')}</b></div><div class="fact"><small>Честный знак</small><b>${esc(order.marking || '—')}</b></div><div class="fact"><small>Перебивка</small><b>${esc(order.relabel || '—')}</b></div></div><div class="panel"><h2>Доставка из Битрикс24</h2><div class="bitrix">${fields.length ? fields.map(field => `<div><span>${esc(field.label)}</span>${esc(field.value)}</div>`).join('') : '<p class="note">Поля доставки в сделке не заполнены.</p>'}</div></div>${completed ? `<div class="panel done-mark">${completed.queued ? '◷ Сохранено на телефоне. Отправится после появления интернета.' : '✓ Рейс завершён ' + new Date(completed.completedAt).toLocaleString('ru-RU')}</div>` : `<form id="completeForm" class="panel"><h2>${needsPhoto ? 'Фото экспедиторской обязательно' : 'Завершение рейса'}</h2>${needsPhoto ? '<label id="upload" class="upload"><span>📷 Сфотографировать экспедиторскую</span><input id="photo" type="file" accept="image/*" capture="environment" required></label>' : '<p class="note">Подтвердите, что груз отправлен.</p>'}<button id="complete" class="primary" ${needsPhoto ? 'disabled' : ''}>Груз отправлен</button></form>`}`;
  if (!completed) {
    const photo = $('#photo');
    if (photo) photo.onchange = () => {
      $('#upload').classList.toggle('has', Boolean(photo.files[0]));
      $('#upload span').textContent = photo.files[0] ? '✓ Фото сохранено на телефоне' : '📷 Сфотографировать экспедиторскую';
      $('#complete').disabled = !photo.files[0];
    };
    $('#completeForm').onsubmit = event => complete(event, order);
  }
}

async function openOrder(id) {
  $('#listScreen').hidden = true;
  $('#detailScreen').hidden = false;
  $('#detail').innerHTML = '<div class="empty">Открываем заказ…</div>';
  try {
    let detail = null;
    if (state.filter === 'history') {
      const order = state.orders.find(item => item.id === id);
      if (order) detail = { order, bitrix: null, completed: order.completed };
    }
    if (!detail && navigator.onLine) {
      try {
        detail = await api(`/api/driver/order?id=${encodeURIComponent(id)}`);
        await DriverOffline.saveDetail(state.user.login, id, detail);
      } catch {
        detail = await DriverOffline.loadDetail(state.user.login, id);
      }
    } else if (!detail) detail = await DriverOffline.loadDetail(state.user.login, id);
    if (!detail) throw new Error('NO_OFFLINE_DETAIL');
    const pending = (await DriverOffline.queued(state.user.login)).find(item => item.order.id === id);
    if (pending) detail.completed = { queued: true, completedAt: pending.createdAt };
    renderDetail(detail);
  } catch {
    $('#detail').innerHTML = '<div class="empty">Эта карточка ещё не была загружена на телефон. Откройте её один раз с интернетом.</div>';
  }
}

async function markQueued(order, photo) {
  await DriverOffline.enqueue(state.user, order, photo);
  const current = state.orders.find(item => item.id === order.id);
  if (current) current.completed = { queued: true, completedAt: new Date().toISOString() };
  await DriverOffline.saveOrders(state.user.login, state.orders);
  navigator.serviceWorker?.ready.then(registration => registration.sync?.register('akfix-driver-upload')).catch(() => {});
  toast('Сохранено на телефоне. Отправим после появления интернета.');
  renderDetail({ order, bitrix: (await DriverOffline.loadDetail(state.user.login, order.id))?.bitrix, completed: current.completed });
}

async function complete(event, order) {
  event.preventDefault();
  const button = $('#complete');
  button.disabled = true;
  button.textContent = navigator.onLine ? 'Отправляем…' : 'Сохраняем…';
  const photo = $('#photo')?.files[0] || null;
  if (!navigator.onLine) return markQueued(order, photo);
  const form = new FormData();
  form.set('orderId', order.id);
  if (photo) form.append('expeditorPhoto', photo, photo.name || 'expeditor.jpg');
  try {
    await api('/api/driver/complete', { method: 'POST', body: form });
    toast('Рейс успешно завершён');
    await loadOrders();
    openOrder(order.id);
  } catch (error) {
    if (error.message === 'EXPEDITOR_PHOTO_REQUIRED') {
      toast('Добавьте фото экспедиторской');
      button.disabled = false;
      button.textContent = 'Груз отправлен';
    } else {
      await markQueued(order, photo);
    }
  }
}

async function syncQueue() {
  if (!navigator.onLine || !state.user) return;
  const items = await DriverOffline.queued(state.user.login);
  let sent = 0;
  for (const item of items) {
    const form = new FormData();
    form.set('orderId', item.order.id);
    if (item.photo) form.append('expeditorPhoto', item.photo, item.photoName);
    try {
      await api('/api/driver/complete', { method: 'POST', body: form });
      await DriverOffline.remove('queue', item.id);
      sent++;
    } catch { break; }
  }
  if (sent) {
    toast(`Отправлено из очереди: ${sent}`);
    await loadOrders();
  }
}

$('#loginForm').onsubmit = async event => {
  event.preventDefault();
  $('#loginError').textContent = '';
  try {
    start((await api('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ login:$('#loginInput').value, pin:$('#pinInput').value }) })).user);
  } catch { $('#loginError').textContent = 'Неверный логин или PIN-код'; }
};

$('#refresh').onclick = () => state.filter === 'history' ? loadHistory() : loadOrders();
$('#historyDate').max = new Date().toISOString().slice(0, 10);
$('#historyDate').value = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
$('#historyDate').onchange = loadHistory;
$('#back').onclick = () => { $('#detailScreen').hidden = true; $('#listScreen').hidden = false; };
$('#logout').onclick = async () => { localStorage.removeItem('akfix_driver_user'); await fetch('/api/logout',{method:'POST'}).catch(() => {}); location.href='/'; };
document.querySelectorAll('[data-filter]').forEach(button => button.onclick = () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('active', item === button));
  $('#historyCalendar').hidden = state.filter !== 'history';
  if (state.filter === 'history') loadHistory(); else loadOrders();
});

addEventListener('online', () => { state.offline = false; toast('Интернет появился. Отправляем сохранённые данные…'); syncQueue(); loadOrders(); });
addEventListener('offline', () => { state.offline = true; toast('Нет интернета. Можно продолжать работу офлайн.'); setSyncText(`Офлайн · сохранено заказов: ${state.orders.length}`, true); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { updateViaCache:'none' }).then(registration => registration.update()).catch(() => {});
fetch('/api/session', { cache:'no-store' }).then(async response => {
  if (response.ok) start((await response.json()).user);
  else if (!navigator.onLine && DriverOffline.savedUser()) start(DriverOffline.savedUser());
}).catch(() => { const user = DriverOffline.savedUser(); if (user) start(user); });
