const fs = require('fs');
const path = require('path');
const { sendJson, readJson } = require('./http/response');

const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};

class Application {
  constructor({ publicDir, receivingTestDir, sessions, bitrix, multipart, checks, history, userStore, shippingSheet, driverDeliveries }) {
    this.publicDir = publicDir;
    this.receivingTestDir = receivingTestDir;
    this.sessions = sessions;
    this.bitrix = bitrix;
    this.multipart = multipart;
    this.checks = checks;
    this.history = history;
    this.userStore = userStore;
    this.shippingSheet = shippingSheet;
    this.driverDeliveries = driverDeliveries;
    this.orderLocks = new Map();
    this.version = process.env.APP_VERSION || `${Date.now()}`;
  }

  async handle(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/health') return this.#health(res);
      if (url.pathname === '/api/version' && req.method === 'GET') return sendJson(res, 200, { version: this.version }, { 'Cache-Control': 'no-store' });
      if (url.pathname === '/api/session' && req.method === 'GET') return this.#session(req, res);
      if (url.pathname === '/api/login' && req.method === 'POST') return this.#login(req, res);
      if (url.pathname === '/api/logout' && req.method === 'POST') return this.#logout(res);
      if (url.pathname === '/api/driver/orders' && req.method === 'GET') return await this.#driverOrders(req, res);
      if (url.pathname === '/api/driver/history' && req.method === 'GET') return this.#driverHistory(req, res, url);
      if (url.pathname === '/api/driver/order' && req.method === 'GET') return await this.#driverOrder(req, res, url);
      if (url.pathname === '/api/driver/complete' && req.method === 'POST') return await this.#driverComplete(req, res);
      if (url.pathname === '/api/logist/orders' && req.method === 'GET') return await this.#logistOrders(req, res);
      if (url.pathname === '/api/logist/drivers' && req.method === 'GET') return this.#logistDrivers(req, res);
      if (url.pathname === '/api/logist/order' && req.method === 'GET') return await this.#logistOrder(req, res, url);
      if (url.pathname === '/api/logist/order/update' && req.method === 'POST') return await this.#logistUpdate(req, res);
      if (url.pathname === '/api/logist/assign' && req.method === 'POST') return await this.#logistAssign(req, res);
      if (url.pathname.startsWith('/api/logist/photo/') && req.method === 'GET') return await this.#logistPhoto(req, res, url.pathname.slice('/api/logist/photo/'.length));
      if (url.pathname === '/api/checks/complete' && req.method === 'POST') return this.#complete(req, res);
      if (url.pathname === '/api/history' && req.method === 'GET') return this.#history(req, res);
      if (url.pathname === '/api/pending' && req.method === 'GET') return this.#pending(req, res);
      if (url.pathname === '/api/check-status' && req.method === 'GET') return this.#checkStatus(req, res, url);
      if (url.pathname === '/api/order-locks' && req.method === 'GET') return this.#orderLocks(req, res);
      if (url.pathname === '/api/order-locks/acquire' && req.method === 'POST') return this.#acquireOrderLock(req, res);
      if (url.pathname === '/api/order-locks/release' && req.method === 'POST') return this.#releaseOrderLock(req, res);
      if (url.pathname === '/api/admin/comments/list' && req.method === 'POST') return this.#adminListComments(req, res);
      if (url.pathname === '/api/admin/comments/delete' && req.method === 'POST') return this.#adminDeleteComment(req, res);
      if (url.pathname === '/api/admin/photos/clear' && req.method === 'POST') return this.#adminClearPhotos(req, res);
      if (url.pathname === '/api/admin/check-status' && req.method === 'GET') return this.#adminCheckStatus(req, res, url);
      if (url.pathname === '/api/admin/users' && req.method === 'GET') return this.#adminUsers(req, res);
      if (url.pathname === '/api/admin/users/create' && req.method === 'POST') return this.#adminCreateUser(req, res);
      if (url.pathname === '/api/admin/users/update' && req.method === 'POST') return this.#adminUpdateUser(req, res);
      if (url.pathname === '/api/admin/telegram/chats' && req.method === 'GET') return this.#adminTelegramChats(req, res);
      if (url.pathname === '/api/admin/telegram/select' && req.method === 'POST') return this.#adminTelegramSelect(req, res);
      if (url.pathname.startsWith('/api/bitrix/') && req.method === 'POST') return await this.#proxyBitrix(req, res, url.pathname.slice('/api/bitrix/'.length));
      if (url.pathname === '/receiving') { res.writeHead(308, { Location: '/receiving/' }); return res.end(); }
      if (url.pathname === '/receiving-test') { res.writeHead(308, { Location: '/receiving-test/' }); return res.end(); }
      return this.#static(req, res, url.pathname);
    } catch (error) {
      console.error(error);
      const status = ['BODY_TOO_LARGE','PHOTO_TOO_LARGE'].includes(error.message) ? 413 : 500;
      sendJson(res, status, { error: error.message || 'SERVER_ERROR' });
    }
  }

  #health(res) { sendJson(res, 200, { ok: true, bitrixConfigured: this.bitrix.configured, telegramConfigured: this.checks.telegram.configured }); }
  #user(req, res) { const user = this.sessions.userFromRequest(req); if (!user) sendJson(res, 401, { error: 'AUTH_REQUIRED' }); return user; }
  #admin(req, res) { const user = this.#user(req, res); if (!user) return null; if ((user.role || 'employee') !== 'admin') { sendJson(res, 403, { error: 'ADMIN_REQUIRED' }); return null; } return user; }
  #session(req, res) { const user = this.#user(req, res); if (user) sendJson(res, 200, { user: this.sessions.publicUser(user) }); }

  async #login(req, res) {
    const body = await readJson(req);
    const user = this.sessions.authenticate(body.login, body.pin);
    if (!user) return sendJson(res, 401, { error: 'INVALID_CREDENTIALS' });
    sendJson(res, 200, { user: this.sessions.publicUser(user) }, { 'Set-Cookie': this.sessions.createCookie(user) });
  }

  #logout(res) { sendJson(res, 200, { ok: true }, { 'Set-Cookie': this.sessions.clearCookie() }); }

  #driver(req, res) { const user = this.#user(req, res); if (!user) return null; if (user.role !== 'driver') { sendJson(res, 403, { error: 'DRIVER_REQUIRED' }); return null; } return user; }
  #logist(req, res) { const user = this.#user(req, res); if (!user) return null; if (!['logist','admin'].includes(user.role)) { sendJson(res, 403, { error: 'LOGIST_REQUIRED' }); return null; } return user; }

  async #rowsForDriver(name) {
    const normalized = String(name || '').trim().toLocaleLowerCase('ru');
    return (await this.shippingSheet.listToday()).filter(row => this.driverDeliveries.assignedDriver(row.id, row.driver).toLocaleLowerCase('ru') === normalized)
      .map(row => ({ ...row, driver: this.driverDeliveries.assignedDriver(row.id, row.driver) }));
  }

  async #driverOrders(req, res) {
    const user = this.#driver(req, res); if (!user) return;
    const rows = await this.#rowsForDriver(user.name);
    const completed = new Map(this.driverDeliveries.list(user.login).map(item => [item.orderId, item]));
    sendJson(res, 200, { items: rows.map(row => ({ ...row, completed: completed.get(row.id) || null })) }, { 'Cache-Control': 'no-store' });
  }

  #driverHistory(req, res, url) {
    const user = this.#driver(req, res); if (!user) return;
    const date = String(url.searchParams.get('date') || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { error: 'INVALID_DATE' });
    const items = this.driverDeliveries.list(user.login).filter(item => deliveryDate(item) === date)
      .map(item => ({ ...(item.order || {}), id: item.orderId, bitrixId: item.bitrixId || item.order?.bitrixId || '', completed: item }));
    sendJson(res, 200, { date, items }, { 'Cache-Control': 'no-store' });
  }

  async #driverOrder(req, res, url) {
    const user = this.#driver(req, res); if (!user) return;
    const sheetId = String(url.searchParams.get('id') || '');
    const row = (await this.#rowsForDriver(user.name)).find(item => item.id === sheetId);
    if (!row) return sendJson(res, 404, { error: 'ORDER_NOT_FOUND' });
    let bitrix = null;
    if (row.bitrixId && this.bitrix.configured) bitrix = await this.bitrix.getItem(row.bitrixId);
    sendJson(res, 200, { order: row, bitrix, completed: this.driverDeliveries.get(user.login, row.id) }, { 'Cache-Control': 'no-store' });
  }

  async #driverComplete(req, res) {
    const user = this.#driver(req, res); if (!user) return;
    const payload = await this.multipart.read(req);
    const orderId = String(payload.fields.orderId || '');
    const row = (await this.#rowsForDriver(user.name)).find(item => item.id === orderId);
    if (!row) return sendJson(res, 404, { error: 'ORDER_NOT_FOUND' });
    const needsPhoto = /^тк(?:\s|$)/i.test(row.delivery);
    const file = payload.files.find(item => item.name === 'expeditorPhoto') || payload.files[0];
    if (needsPhoto && !file) return sendJson(res, 400, { error: 'EXPEDITOR_PHOTO_REQUIRED' });
    if (row.bitrixId && this.bitrix.configured) await this.bitrix.completeDriverDelivery({ orderId: row.bitrixId, driverName: user.name, delivery: row.delivery, file });
    const photo = await this.driverDeliveries.savePhoto(file);
    const completed = await this.driverDeliveries.complete({ login: user.login, driverName: user.name, orderId: row.id, bitrixId: row.bitrixId, order: row, completedAt: new Date().toISOString(), hasPhoto: Boolean(file), photo });
    sendJson(res, 200, { ok: true, completed });
  }

  async #logistOrders(req, res) {
    if (!this.#logist(req, res)) return;
    const completed = new Map(this.driverDeliveries.listAll().map(item => [item.orderId, item]));
    const rows = (await this.shippingSheet.listToday()).map(row => ({ ...row, driver: this.driverDeliveries.assignedDriver(row.id, row.driver), completed: completed.get(row.id) || null }));
    sendJson(res, 200, { items: rows }, { 'Cache-Control': 'no-store' });
  }

  #logistDrivers(req, res) { if (!this.#logist(req, res)) return; sendJson(res, 200, { items: this.userStore.listDrivers() }); }

  async #logistOrder(req, res, url) {
    if (!this.#logist(req, res)) return;
    const id = String(url.searchParams.get('id') || '');
    const row = (await this.shippingSheet.listToday()).find(item => item.id === id);
    if (!row) return sendJson(res, 404, { error: 'ORDER_NOT_FOUND' });
    let item, definitions = {};
    if (row.bitrixId && this.bitrix.configured) {
      const [result, fieldResult] = await Promise.all([this.bitrix.getItem(row.bitrixId), this.bitrix.getItemFields()]);
      item = result.item || result; definitions = fieldResult.fields || fieldResult;
    } else item = {};
    item = { ...item, ...this.driverDeliveries.bitrixOverride(row.id) };
    const hidden = new Set(['id','entityTypeId','categoryId','createdBy','updatedBy','createdTime','updatedTime','movedTime']);
    const fields = Object.entries(item).filter(([key,value]) => !hidden.has(key) && value != null && ['string','number','boolean'].includes(typeof value)).map(([key,value]) => ({ key, label: definitions[key]?.title || demoLabel(key), value: String(value), editable: definitions[key] ? !definitions[key].isReadOnly : key !== 'title' }));
    const completed = this.driverDeliveries.listAll().find(entry => entry.orderId === row.id) || null;
    sendJson(res, 200, { order: { ...row, driver: this.driverDeliveries.assignedDriver(row.id, row.driver) }, fields, completed }, { 'Cache-Control': 'no-store' });
  }

  async #logistUpdate(req, res) {
    const user = this.#logist(req, res); if (!user) return;
    const { orderId, fields } = await readJson(req);
    const row = (await this.shippingSheet.listToday()).find(item => item.id === String(orderId));
    if (!row) return sendJson(res, 404, { error: 'ORDER_NOT_FOUND' });
    const clean = Object.fromEntries(Object.entries(fields || {}).filter(([key,value]) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) && typeof value === 'string').map(([key,value]) => [key, value.trim().slice(0, 5000)]));
    if (row.bitrixId && this.bitrix.configured) {
      const definitionsResult = await this.bitrix.getItemFields(); const definitions = definitionsResult.fields || definitionsResult;
      for (const key of Object.keys(clean)) if (!definitions[key] || definitions[key].isReadOnly) delete clean[key];
      if (Object.keys(clean).length) await this.bitrix.updateItem(row.bitrixId, clean);
    }
    await this.driverDeliveries.saveBitrixOverride(row.id, clean, user);
    sendJson(res, 200, { ok: true });
  }

  async #logistAssign(req, res) {
    const user = this.#logist(req, res); if (!user) return;
    const { orderId, driver } = await readJson(req);
    if (!String(driver || '').trim()) return sendJson(res, 400, { error: 'DRIVER_REQUIRED' });
    await this.driverDeliveries.assign(orderId, driver, user);
    sendJson(res, 200, { ok: true });
  }

  async #logistPhoto(req, res, id) {
    if (!this.#logist(req, res)) return;
    const item = this.driverDeliveries.listAll().find(entry => entry.photo?.id === id);
    if (!item) return sendJson(res, 404, { error: 'PHOTO_NOT_FOUND' });
    const data = await this.driverDeliveries.photo(id);
    if (!data) return sendJson(res, 404, { error: 'PHOTO_NOT_FOUND' });
    res.writeHead(200, { 'Content-Type': item.photo.mime, 'Cache-Control': 'private, max-age=3600' }); res.end(data);
  }

  async #complete(req, res) {
    const user = this.#user(req, res);
    if (!user) return;
    const payload = await this.multipart.read(req);
    try {
      const status = await this.checks.complete({ ...payload, user });
      sendJson(res, 200, { ok: true, status });
    } catch (error) {
      const code = error.message.startsWith('TELEGRAM:') || error.message === 'TELEGRAM_NOT_CONFIGURED' ? 'TELEGRAM_UPLOAD_FAILED' : 'BITRIX_UPLOAD_FAILED';
      sendJson(res, 502, { error: code, status: error.uploadStatus || { bitrix: false, telegram: false }, message: error.message });
    }
  }

  async #history(req, res) {
    const user = this.#user(req, res);
    if (!user) return;
    sendJson(res, 200, { items: await this.history.list(user.login) });
  }

  async #pending(req, res) {
    if (!this.#user(req, res)) return;
    sendJson(res, 200, { items: await this.checks.pending() });
  }

  async #checkStatus(req, res, url) {
    if (!this.#user(req, res)) return;
    sendJson(res, 200, await this.checks.status(url.searchParams.get('orderId')));
  }

  #activeLocks() {
    const now = Date.now();
    for (const [key, lock] of this.orderLocks) if (lock.expiresAt <= now) this.orderLocks.delete(key);
    return [...this.orderLocks.values()];
  }

  #orderLocks(req, res) {
    if (!this.#user(req, res)) return;
    sendJson(res, 200, { items: this.#activeLocks().map(({ login, ...lock }) => lock) }, { 'Cache-Control': 'no-store' });
  }

  async #acquireOrderLock(req, res) {
    const user = this.#user(req, res);
    if (!user) return;
    const { orderId } = await readJson(req);
    const key = `${orderId}:${user.warehouse}`;
    const current = this.#activeLocks().find(lock => lock.key === key);
    if (current && current.login !== user.login) return sendJson(res, 409, { error: 'ORDER_BUSY', lock: { employee: current.employee, warehouse: current.warehouse, expiresAt: current.expiresAt } });
    const lock = { key, orderId: String(orderId), login: user.login, employee: user.name, warehouse: user.warehouse, expiresAt: Date.now() + 90000 };
    this.orderLocks.set(key, lock);
    sendJson(res, 200, { ok: true, lock: { orderId: lock.orderId, employee: lock.employee, warehouse: lock.warehouse, expiresAt: lock.expiresAt } });
  }

  async #releaseOrderLock(req, res) {
    const user = this.#user(req, res);
    if (!user) return;
    const { orderId } = await readJson(req);
    const key = `${orderId}:${user.warehouse}`;
    if (this.orderLocks.get(key)?.login === user.login) this.orderLocks.delete(key);
    sendJson(res, 200, { ok: true });
  }

  async #adminListComments(req, res) {
    if (!this.#admin(req, res)) return;
    const { orderId } = await readJson(req);
    sendJson(res, 200, { comments: await this.bitrix.listComments(orderId) });
  }

  async #adminDeleteComment(req, res) {
    if (!this.#admin(req, res)) return;
    const { orderId, commentId } = await readJson(req);
    await this.bitrix.deleteComment({ orderId, commentId });
    sendJson(res, 200, { ok: true });
  }

  async #adminClearPhotos(req, res) {
    if (!this.#admin(req, res)) return;
    const { orderId, warehouse } = await readJson(req);
    if (warehouse === 'Объединённый груз') await this.bitrix.clearCombinedPhotos(orderId);
    else await this.bitrix.clearWarehousePhotos({ orderId, warehouse });
    sendJson(res, 200, { ok: true });
  }

  async #adminCheckStatus(req, res, url) {
    if (!this.#admin(req, res)) return;
    sendJson(res, 200, await this.checks.status(url.searchParams.get('orderId')));
  }

  #adminUsers(req, res) {
    if (!this.#admin(req, res)) return;
    sendJson(res, 200, { items: this.userStore.listEmployees() });
  }

  async #adminCreateUser(req, res) {
    if (!this.#admin(req, res)) return;
    sendJson(res, 201, { user: await this.userStore.createEmployee(await readJson(req)) });
  }

  async #adminUpdateUser(req, res) {
    if (!this.#admin(req, res)) return;
    const body = await readJson(req);
    sendJson(res, 200, { user: await this.userStore.updateEmployee(body.id, body) });
  }

  async #adminTelegramChats(req, res) {
    if (!this.#admin(req, res)) return;
    sendJson(res, 200, { items: await this.checks.telegram.listChats() });
  }

  async #adminTelegramSelect(req, res) {
    if (!this.#admin(req, res)) return;
    const { chatId } = await readJson(req);
    await this.checks.telegram.selectChat(chatId);
    sendJson(res, 200, { ok: true });
  }

  async #proxyBitrix(req, res, method) {
    if (!this.#user(req, res)) return;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const upstream = await this.bitrix.proxy(method, Buffer.concat(chunks), req.headers['content-type'] || 'application/x-www-form-urlencoded');
    res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  }

  #static(req, res, pathname) {
    if (!['GET','HEAD'].includes(req.method)) return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    const isDriver = pathname === '/driver' || pathname.startsWith('/driver/');
    const isLogist = pathname === '/logist' || pathname.startsWith('/logist/');
    const isReceivingTest = pathname === '/receiving' || pathname.startsWith('/receiving/') || pathname === '/receiving-test' || pathname.startsWith('/receiving-test/');
    const baseDir = isDriver ? path.join(this.publicDir, 'driver') : isLogist ? path.join(this.publicDir, 'logist') : (isReceivingTest ? this.receivingTestDir : this.publicDir);
    const relative = isReceivingTest
      ? (pathname === '/receiving' || pathname === '/receiving/' || pathname === '/receiving-test' || pathname === '/receiving-test/' ? 'index.html' : decodeURIComponent(pathname.startsWith('/receiving/') ? pathname.slice('/receiving/'.length) : pathname.slice('/receiving-test/'.length)))
      : isDriver ? (pathname === '/driver' || pathname === '/driver/' ? 'index.html' : decodeURIComponent(pathname.slice('/driver/'.length)))
      : isLogist ? (pathname === '/logist' || pathname === '/logist/' ? 'index.html' : decodeURIComponent(pathname.slice('/logist/'.length)))
      : (pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''));
    const file = path.resolve(baseDir, relative);
    if (file !== baseDir && !file.startsWith(baseDir + path.sep)) return sendJson(res, 403, { error: 'FORBIDDEN' });
    fs.readFile(file, (error, data) => {
      if (error) return sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: 'NOT_FOUND' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }
}

function demoLabel(key) { return ({ title:'Название сделки',ufDeliveryCompany:'Название транспортной компании',ufDeliveryAddress:'Адрес доставки',ufRecipient:'Контактное лицо',ufRecipientPhone:'Телефон получателя',ufDeliveryInfo:'Дополнительная информация о доставке' })[key] || key; }
function deliveryDate(item) {
  const source = String(item.order?.date || '');
  const ru = source.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
  return String(item.completedAt || '').slice(0, 10);
}

module.exports = { Application };
