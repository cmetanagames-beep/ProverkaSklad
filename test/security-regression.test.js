const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 19873;
const BASE = `http://127.0.0.1:${PORT}`;
let child;
let tempDir;

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('SERVER_DID_NOT_START');
}

async function login(login, pin) {
  const response = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, pin }) });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';', 1)[0];
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'akfix-security-'));
  const users = [
    { login: 'receiver', pin: '1111', name: 'Приёмщик', warehouse: 'Балашиха', role: 'employee' },
    { login: 'driver', pin: '2222', name: 'Водитель', warehouse: '', role: 'driver' },
  ];
  child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', SESSION_SECRET: 'test-secret-at-least-32-characters-long', APP_USERS_JSON: JSON.stringify(users), RECEIVING_STORAGE_FILE: path.join(tempDir, 'receiving.json'), USER_STORAGE_FILE: path.join(tempDir, 'users.json'), CHECK_STORAGE_DIR: path.join(tempDir, 'checks'), PENDING_STORAGE_FILE: path.join(tempDir, 'pending.json'), HISTORY_STORAGE_FILE: path.join(tempDir, 'history.json'), DRIVER_DELIVERY_STORAGE_FILE: path.join(tempDir, 'deliveries.json') }, stdio: 'ignore' });
  await waitForServer();
});

test.after(async () => {
  child?.kill();
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('receiving requires authentication and the correct role', async () => {
  const anonymous = await fetch(`${BASE}/receiving/`, { redirect: 'manual' });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get('location'), '/');
  assert.equal((await fetch(`${BASE}/api/receiving`)).status, 401);

  const driverCookie = await login('driver', '2222');
  assert.equal((await fetch(`${BASE}/receiving/`, { headers: { Cookie: driverCookie } })).status, 403);

  const receiverCookie = await login('receiver', '1111');
  assert.equal((await fetch(`${BASE}/receiving/`, { headers: { Cookie: receiverCookie } })).status, 200);
});

test('receiving data is validated and persisted on the server', async () => {
  const cookie = await login('receiver', '1111');
  const payload = { fileName: 'приёмка.xlsx', products: [{ article: 'A1', name: 'Товар', plan: 12, pack: '12 шт' }], rows: [{ done: true, alloc: [{ qty: 12, expiry: '2027-08', cell: 'A-01', comment: 'Принято' }] }] };
  assert.equal((await fetch(`${BASE}/api/receiving`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).status, 200);
  const saved = await (await fetch(`${BASE}/api/receiving`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(saved.item.products, payload.products);
  assert.deepEqual(saved.item.rows, payload.rows);
  const disk = JSON.parse(await fs.readFile(path.join(tempDir, 'receiving.json'), 'utf8'));
  assert.equal(disk.receiver.fileName, payload.fileName);
});

test('malformed JSON is rejected without stopping the service', async () => {
  const invalid = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'INVALID_JSON' });
  assert.equal((await fetch(`${BASE}/health`)).status, 200);
});

test('security headers and distinct offline navigation routes are present', async () => {
  const response = await fetch(`${BASE}/health`);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('strict-transport-security'), /max-age=31536000/);
  const sw = await fs.readFile(path.join(ROOT, 'public', 'sw.js'), 'utf8');
  assert.match(sw, /pathname\.startsWith\('\/receiving'\).*'\/receiving\/'/s);
  assert.match(sw, /pathname\.startsWith\('\/admin'\).*'\/admin\.html'/s);
});
