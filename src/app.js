const fs = require('fs');
const path = require('path');
const { sendJson, readJson } = require('./http/response');

const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};

class Application {
  constructor({ publicDir, sessions, bitrix, multipart, checks, history, userStore }) {
    this.publicDir = publicDir;
    this.sessions = sessions;
    this.bitrix = bitrix;
    this.multipart = multipart;
    this.checks = checks;
    this.history = history;
    this.userStore = userStore;
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
      if (url.pathname === '/api/checks/complete' && req.method === 'POST') return this.#complete(req, res);
      if (url.pathname === '/api/history' && req.method === 'GET') return this.#history(req, res);
      if (url.pathname === '/api/pending' && req.method === 'GET') return this.#pending(req, res);
      if (url.pathname === '/api/check-status' && req.method === 'GET') return this.#checkStatus(req, res, url);
      if (url.pathname === '/api/admin/comments/list' && req.method === 'POST') return this.#adminListComments(req, res);
      if (url.pathname === '/api/admin/comments/delete' && req.method === 'POST') return this.#adminDeleteComment(req, res);
      if (url.pathname === '/api/admin/photos/clear' && req.method === 'POST') return this.#adminClearPhotos(req, res);
      if (url.pathname === '/api/admin/check-status' && req.method === 'GET') return this.#adminCheckStatus(req, res, url);
      if (url.pathname === '/api/admin/users' && req.method === 'GET') return this.#adminUsers(req, res);
      if (url.pathname === '/api/admin/users/create' && req.method === 'POST') return this.#adminCreateUser(req, res);
      if (url.pathname === '/api/admin/users/update' && req.method === 'POST') return this.#adminUpdateUser(req, res);
      if (url.pathname === '/api/admin/telegram/chats' && req.method === 'GET') return this.#adminTelegramChats(req, res);
      if (url.pathname === '/api/admin/telegram/select' && req.method === 'POST') return this.#adminTelegramSelect(req, res);
      if (url.pathname.startsWith('/api/bitrix/') && req.method === 'POST') return this.#proxyBitrix(req, res, url.pathname.slice('/api/bitrix/'.length));
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
    await this.bitrix.clearWarehousePhotos({ orderId, warehouse });
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
    const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.resolve(this.publicDir, relative);
    if (!file.startsWith(this.publicDir + path.sep)) return sendJson(res, 403, { error: 'FORBIDDEN' });
    fs.readFile(file, (error, data) => {
      if (error) return sendJson(res, error.code === 'ENOENT' ? 404 : 500, { error: 'NOT_FOUND' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }
}

module.exports = { Application };
