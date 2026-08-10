const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const BITRIX_WEBHOOK_BASE = String(process.env.BITRIX_WEBHOOK_BASE || '').replace(/\/+$/, '');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function proxyBitrix(req, res, method) {
  if (!BITRIX_WEBHOOK_BASE) return json(res, 503, { error: 'BITRIX_NOT_CONFIGURED' });
  if (!/^[a-z0-9._-]+\.json$/i.test(method)) return json(res, 400, { error: 'INVALID_METHOD' });
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const upstream = await fetch(`${BITRIX_WEBHOOK_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': req.headers['content-type'] || 'application/x-www-form-urlencoded' },
    body: Buffer.concat(chunks)
  });
  const body = await upstream.arrayBuffer();
  res.writeHead(upstream.status, {
    'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(Buffer.from(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') return json(res, 200, { ok: true, bitrixConfigured: Boolean(BITRIX_WEBHOOK_BASE) });
    if (req.method === 'POST' && url.pathname.startsWith('/api/bitrix/')) {
      return await proxyBitrix(req, res, url.pathname.slice('/api/bitrix/'.length));
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep)) return json(res, 403, { error: 'FORBIDDEN' });
    fs.readFile(file, (error, data) => {
      if (error) return json(res, error.code === 'ENOENT' ? 404 : 500, { error: 'NOT_FOUND' });
      res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'SERVER_ERROR' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`ProverkaSklad listening on 0.0.0.0:${PORT}`));