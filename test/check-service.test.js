// @ts-check

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { PendingCheckStore } = require('../src/uploads/pending-check-store');
const { HistoryStore } = require('../src/uploads/history-store');
const { CheckService } = require('../src/uploads/check-service');

/** @typedef {{filename:string, mime:string, buffer:Buffer}} TestPhoto */
/** @returns {TestPhoto} */
const photo = () => ({ filename: 'cargo.jpg', mime: 'image/jpeg', buffer: Buffer.from('photo') });
/** @param {number} count @returns {TestPhoto[]} */
const palletPhotos = (count) =>
  Array.from({ length: count }, (_, pallet) =>
    ['side1', 'side2', 'top'].map((shot) => ({
      filename: `pallet-${pallet + 1}-${shot}-test.jpg`,
      mime: 'image/jpeg',
      buffer: Buffer.from(`${pallet}-${shot}`),
    }))
  ).flat();
/** @param {number} orderId @param {Record<string,string>} [extra] */
const fields = (orderId, extra = {}) => ({
  orderId: String(orderId),
  orderNumber: `АФУТ-${String(orderId).padStart(6, '0')}`,
  orderTitle: `Заказ ${orderId}`,
  noCargo: 'false',
  euro: '0',
  american: '0',
  ...extra,
});
/** @param {'Мытищи'|'Балашиха'} warehouse */
const user = (warehouse) => ({ login: warehouse === 'Мытищи' ? 'ivan' : 'albert', name: warehouse, warehouse });

/** @param {any} [overrides] */
async function fixture(overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'akfix-checks-'));
  /** @type {any[][]} */
  const calls = [];
  const bitrix = {
    updateWarehousePhotos: async (/** @type {any} */ input) =>
      calls.push(['bitrix-warehouse', input.orderId, input.warehouse]),
    updateCombinedPhotos: async (/** @type {any} */ input) => calls.push(['bitrix-combined', input.orderId]),
    updateFinalPalletCount: async (/** @type {any} */ input) => calls.push(['bitrix-count', input.orderId]),
    moveToAcceptedVerification: async (/** @type {any} */ orderId) => calls.push(['bitrix-stage', orderId]),
    ...overrides.bitrix,
  };
  const telegram = {
    sendCheck: async (/** @type {any} */ text) => calls.push(['telegram', text]),
    ...overrides.telegram,
  };
  const pendingChecks = new PendingCheckStore(path.join(root, 'checks'));
  const history = new HistoryStore(path.join(root, 'history'));
  const service = new CheckService({ bitrix, telegram, pendingChecks, history, retryMs: 100000, concurrency: 3 });
  return { root, calls, service, pendingChecks, history, bitrix, telegram };
}

test('each warehouse uploads independently and does not change the Bitrix stage', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));

  await f.service.complete({ fields: fields(101), files: [photo()], user: user('Мытищи') });
  await f.service.processQueue();

  assert.deepEqual(
    f.calls.map((call) => call[0]),
    ['bitrix-warehouse', 'telegram']
  );
  assert.equal(
    f.calls.some((call) => call[0] === 'bitrix-stage'),
    false
  );
  assert.equal((await f.pendingChecks.status('101')).mytishchi.delivery.completed, true);
});

test('no cargo is saved without Bitrix or Telegram delivery', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));

  await f.service.complete({ fields: fields(102, { noCargo: 'true' }), files: [], user: user('Балашиха') });
  await f.service.processQueue();

  assert.deepEqual(f.calls, []);
  const status = await f.pendingChecks.status('102');
  assert.equal(status.balashikha.delivery.completed, true);
  assert.equal(status.balashikha.delivery.skipped, true);
});

test('combined cargo is delivered separately and only it changes the stage', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));

  await f.service.complete({ fields: fields(103), files: [photo()], user: user('Мытищи') });
  await f.service.complete({ fields: fields(103), files: [photo()], user: user('Балашиха') });
  await f.service.processQueue();
  f.calls.length = 0;
  await f.service.complete({
    fields: fields(103, { phase: 'combined', euro: '2' }),
    files: palletPhotos(2),
    user: user('Балашиха'),
  });
  await f.service.processQueue();

  assert.deepEqual(
    f.calls.map((call) => call[0]),
    ['bitrix-combined', 'bitrix-count', 'telegram', 'bitrix-stage']
  );
  assert.equal((await f.pendingChecks.status('103')).combined.delivery.completed, true);
});

test('a duplicate Balashikha upload never becomes a combined-cargo event', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));
  const mytishchi = { fields: fields(107, { phase: 'warehouse' }), files: [photo()], user: user('Мытищи') };
  const balashikha = { fields: fields(107, { phase: 'warehouse' }), files: [photo()], user: user('Балашиха') };

  await f.service.complete(mytishchi);
  await f.service.complete(balashikha);
  await f.service.complete(balashikha);
  await f.service.processQueue();

  assert.equal((await f.pendingChecks.status('107')).combined.completed, false);
  assert.equal(
    f.calls.some((call) => call[0] === 'bitrix-combined'),
    false
  );
  assert.equal(
    f.calls.some((call) => call[0] === 'bitrix-stage'),
    false
  );
});

test('twenty orders are retained and delivered without mixing their photos', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));

  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      f.service.complete({ fields: fields(200 + index), files: [photo()], user: user('Мытищи') })
    )
  );
  await f.service.processQueue();

  const delivered = f.calls.filter((call) => call[0] === 'bitrix-warehouse');
  assert.equal(delivered.length, 20);
  assert.equal(new Set(delivered.map((call) => call[1])).size, 20);
  assert.equal((await f.pendingChecks.listJobs()).length, 0);
});

test('retry continues after Telegram failure without repeating the Bitrix upload', async (t) => {
  let telegramAttempts = 0;
  const f = await fixture({
    telegram: {
      sendCheck: async () => {
        telegramAttempts += 1;
        if (telegramAttempts === 1) throw new Error('TELEGRAM_TEMPORARY');
        f.calls.push(['telegram-retry']);
      },
    },
  });
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));

  await f.service.complete({ fields: fields(104), files: [photo()], user: user('Мытищи') });
  await f.service.processQueue();
  await f.pendingChecks.updateDelivery('104', 'mytishchi', { nextAttemptAt: new Date(0).toISOString() });
  await f.service.processQueue();

  assert.equal(f.calls.filter((call) => call[0] === 'bitrix-warehouse').length, 1);
  assert.equal(telegramAttempts, 2);
  assert.equal((await f.pendingChecks.status('104')).mytishchi.delivery.completed, true);
});

test('a new service instance resumes a persisted job after a server restart', async (t) => {
  let telegramAttempts = 0;
  const f = await fixture({
    telegram: {
      sendCheck: async () => {
        telegramAttempts += 1;
        if (telegramAttempts === 1) throw new Error('TELEGRAM_TEMPORARY');
        f.calls.push(['telegram-after-restart']);
      },
    },
  });
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));

  await f.service.complete({ fields: fields(105), files: [photo()], user: user('Балашиха') });
  await f.service.processQueue();
  await f.pendingChecks.updateDelivery('105', 'balashikha', { nextAttemptAt: new Date(0).toISOString() });

  const restarted = new CheckService({
    bitrix: f.bitrix,
    telegram: f.telegram,
    pendingChecks: f.pendingChecks,
    history: f.history,
    retryMs: 100000,
  });
  await restarted.processQueue();

  assert.equal(f.calls.filter((call) => call[0] === 'bitrix-warehouse').length, 1);
  assert.equal(telegramAttempts, 2);
  assert.equal((await f.pendingChecks.status('105')).balashikha.delivery.completed, true);
});

test('legacy combined records are not replayed automatically', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.root, { recursive: true, force: true }));

  await f.pendingChecks.save({
    fields: fields(106, { phase: 'combined' }),
    files: [photo()],
    user: user('Балашиха'),
  });
  const file = path.join(f.root, 'checks', '106', 'combined', 'check.json');
  const record = JSON.parse(await fs.readFile(file, 'utf8'));
  delete record.delivery;
  await fs.writeFile(file, JSON.stringify(record));

  assert.deepEqual(await f.pendingChecks.listJobs(), []);
});
