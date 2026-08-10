const fs = require('fs');
const path = require('path');
const { sendJson, readJson } = require('./http/response');

const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};

class Application {
  constructor({ publicDir, sessions, bitrix, multipart, checks }) {
    this.publicDir = publicDir;
    this.sessions = sessions;
    this.bitrix = bitrix;
    this.multipart = multipart;
    this.checks = checks;
  }

  async handle(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/health') return this.#health(res);
      if (url.pathname === '/api/session' && req.method === 'GET') return this.#session(req, res);
      if (url.pathname === '/api/login' && req.method === 'POST') return this.#login(req, res);
      if (url.pathname === '/api/logout' && req.method === 'POST') return this.#logout(res);
      if (url.pathname === '/api/checks/complete' && req.method === 'POST') return this.#complete(req, res);
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
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }
}

module.exports = { Application };

