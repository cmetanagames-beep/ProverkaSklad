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
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('SERVER_DID_NOT_START');
}

async function login(login, pin) {
  const response = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, pin }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';', 1)[0];
}

test.before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'akfix-security-'));
  const users = [
    { login: 'receiver', pin: '1111', name: 'Приёмщик', warehouse: 'Балашиха', role: 'employee' },
    { login: 'driver', pin: '2222', name: 'Водитель', warehouse: '', role: 'driver' },
  ];
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'production',
      SESSION_SECRET: 'test-secret-at-least-32-characters-long',
      APP_USERS_JSON: JSON.stringify(users),
      RECEIVING_STORAGE_FILE: path.join(tempDir, 'receiving.json'),
      USER_STORAGE_FILE: path.join(tempDir, 'users.json'),
      CHECK_STORAGE_DIR: path.join(tempDir, 'checks'),
      PENDING_STORAGE_FILE: path.join(tempDir, 'pending.json'),
      HISTORY_STORAGE_FILE: path.join(tempDir, 'history.json'),
      DRIVER_DELIVERY_STORAGE_FILE: path.join(tempDir, 'deliveries.json'),
    },
    stdio: 'ignore',
  });
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
  const payload = {
    fileName: 'приёмка.xlsx',
    products: [{ article: 'A1', name: 'Товар', plan: 12, pack: '12 шт' }],
    rows: [{ done: true, alloc: [{ qty: 12, expiry: '2027-08', cell: 'A-01', comment: 'Принято' }] }],
  };
  assert.equal(
    (
      await fetch(`${BASE}/api/receiving`, {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    ).status,
    200
  );
  const saved = await (await fetch(`${BASE}/api/receiving`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(saved.item.products, payload.products);
  assert.deepEqual(saved.item.rows, payload.rows);
  const disk = JSON.parse(await fs.readFile(path.join(tempDir, 'receiving.json'), 'utf8'));
  assert.equal(disk.receiver.fileName, payload.fileName);

  const replacement = {
    fileName: 'новая-приёмка.csv',
    products: [{ article: 'B2', name: 'Новый товар', plan: 3, pack: '' }],
    rows: [{ done: false, alloc: [{ qty: 3, expiry: '', cell: '', comment: '' }] }],
  };
  assert.equal(
    (
      await fetch(`${BASE}/api/receiving`, {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(replacement),
      })
    ).status,
    200
  );
  const replaced = await (await fetch(`${BASE}/api/receiving`, { headers: { Cookie: cookie } })).json();
  assert.equal(replaced.item.fileName, replacement.fileName);
  assert.deepEqual(replaced.item.products, replacement.products);
});

test('malformed JSON is rejected without stopping the service', async () => {
  const invalid = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'INVALID_JSON' });
  assert.equal((await fetch(`${BASE}/health`)).status, 200);
});

test('role APIs reject the wrong user and validate driver dates', async () => {
  assert.equal((await fetch(`${BASE}/api/driver/orders`)).status, 401);
  const receiverCookie = await login('receiver', '1111');
  assert.equal((await fetch(`${BASE}/api/driver/orders`, { headers: { Cookie: receiverCookie } })).status, 403);
  const driverCookie = await login('driver', '2222');
  assert.equal((await fetch(`${BASE}/api/logist/orders`, { headers: { Cookie: driverCookie } })).status, 403);
  assert.equal(
    (await fetch(`${BASE}/api/driver/orders?date=tomorrow`, { headers: { Cookie: driverCookie } })).status,
    400
  );
  assert.equal(
    (await fetch(`${BASE}/api/driver/order?id=sheet-1&date=19.08.26`, { headers: { Cookie: driverCookie } })).status,
    400
  );
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

test('role screens share the AKFIX visual tokens and driver tomorrow navigation', async () => {
  const cssFiles = [
    path.join(ROOT, 'public', 'driver', 'driver.css'),
    path.join(ROOT, 'public', 'logist', 'logist.css'),
    path.join(ROOT, 'receiving-test', 'styles.css'),
    path.join(ROOT, 'public', 'assets', 'admin-strict.css'),
  ];
  for (const file of cssFiles) {
    const css = await fs.readFile(file, 'utf8');
    assert.match(css, /--red:#cf0a2c/);
    assert.match(css, /--ink:#151518/);
    assert.match(css, /--line:#e[23]e[23]e[56]/);
  }
  const driverHtml = await fs.readFile(path.join(ROOT, 'public', 'driver', 'index.html'), 'utf8');
  assert.match(driverHtml, /data-filter="tomorrow">Завтра</);
  assert.match(driverHtml, /src="\/assets\/logo\.svg" alt="AKFIX"/);
});

test('unauthenticated app stays hidden and role controls remain usable on mobile', async () => {
  const indexHtml = await fs.readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const appJs = await fs.readFile(path.join(ROOT, 'public', 'assets', 'app.js'), 'utf8');
  const driverCss = await fs.readFile(path.join(ROOT, 'public', 'driver', 'driver.css'), 'utf8');
  const logistHtml = await fs.readFile(path.join(ROOT, 'public', 'logist', 'index.html'), 'utf8');

  assert.match(indexHtml, /<main class="shell" id="appShell" hidden>/);
  assert.match(indexHtml, /<nav class="bottom-nav" id="bottomNav" hidden>/);
  assert.match(appJs, /q\('#appShell'\)\.hidden\s*=\s*false/);
  assert.match(appJs, /q\('#bottomNav'\)\.hidden\s*=\s*false/);
  assert.match(appJs, /async function refreshPending\(\).*if \(!app\.user\.login\) return/s);
  assert.match(appJs, /async function refreshLocks\(\).*if \(!app\.user\.login\) return/s);
  assert.match(driverCss, /\.tabs button\{flex:1 1 0;min-width:0/);
  assert.match(logistHtml, /class="logout-button" aria-label="Выйти из приложения">Выйти<\/button>/);
  assert.doesNotMatch(logistHtml, />↗<\/button>/);
});

test('receiving is part of unified navigation and safely replaces an Excel file', async () => {
  const receivingHtml = await fs.readFile(path.join(ROOT, 'receiving-test', 'index.html'), 'utf8');
  const receivingJs = await fs.readFile(path.join(ROOT, 'receiving-test', 'app.js'), 'utf8');
  const appJs = await fs.readFile(path.join(ROOT, 'public', 'assets', 'app.js'), 'utf8');
  const loadingCss = await fs.readFile(path.join(ROOT, 'public', 'assets', 'app-loading.css'), 'utf8');
  const navCss = await fs.readFile(path.join(ROOT, 'public', 'assets', 'nav-fix.css'), 'utf8');
  const mainHtml = await fs.readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');

  assert.match(receivingHtml, /class="receiving-nav"/);
  assert.match(receivingHtml, /href="\/">Заказы<\/a>/);
  assert.match(receivingHtml, /href="\/receiving\/" aria-current="page">Приёмка<\/a>/);
  assert.match(receivingHtml, /href="\/\?screen=history">История<\/a>/);
  assert.match(receivingHtml, /id="replaceExcel"/);
  assert.match(receivingJs, /input\.value='';input\.click\(\)/);
  assert.match(receivingJs, /state\.query='';state\.complete=false/);
  assert.match(receivingJs, /fetch\('\/api\/logout',\{method:'POST'\}\)/);
  assert.match(appJs, /new URLSearchParams\(location\.search\).*screen.*history/);
  assert.match(appJs, /fetch\('\/api\/session', \{ cache: 'no-store', credentials: 'same-origin' \}\)/);
  assert.match(appJs, /location\.assign\('\/receiving\/'\)/);
  assert.match(mainHtml, /class="app-loading" aria-label="Загрузка приложения"/);
  assert.match(mainHtml, /class="auth" id="auth" hidden/);
  assert.doesNotMatch(mainHtml, /assets\/role-router\.js/);
  assert.match(appJs, /user\.role\s*===\s*'driver'.*location\.href\s*=\s*'\/driver\/'/s);
  assert.match(appJs, /user\.role\s*===\s*'logist'.*location\.href\s*=\s*'\/logist\/'/s);
  assert.match(appJs, /const showLogin[\s\S]*auth\.hidden\s*=\s*false/);
  assert.match(appJs, /async function restoreSession\(\)/);
  assert.match(appJs, /attempt < 3/);
  assert.match(loadingCss, /akfix-splash-out \.35s ease 2s forwards/);
  assert.match(navCss, /overscroll-behavior-y:none/);
  assert.match(navCss, /\.bottom-nav\{left:0!important;right:0!important/);
  assert.match(navCss, /@keyframes akfix-screen-enter/);
  assert.match(appJs, /b\.classList\.add\('opening'\);\s*await openOrder/);
  assert.doesNotMatch(receivingHtml, /class="app-loading"/);
});

test('product presentation is public, responsive and interactive', async () => {
  const response = await fetch(`${BASE}/presentation/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Склад и доставка —<br><span>в одном рабочем контуре<\/span>/);
  assert.match(html, /Одно действие водителя запускает весь поток/);
  assert.match(html, /Рабочая сделка не изменяется/);

  const script = await fs.readFile(path.join(ROOT, 'public', 'presentation', 'app.js'), 'utf8');
  const styles = await fs.readFile(path.join(ROOT, 'public', 'presentation', 'styles.css'), 'utf8');
  assert.match(script, /setRole/);
  assert.match(script, /setStep/);
  assert.match(script, /IntersectionObserver/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /@media\(max-width:520px\)/);
});
