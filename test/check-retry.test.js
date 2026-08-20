// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { CheckService } = require('../src/uploads/check-service');
const { PendingCheckStore } = require('../src/uploads/pending-check-store');

test('warehouse photos continue from the failed server step without employee involvement', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'akfix-check-retry-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const pendingChecks = new PendingCheckStore(root);
  const calls = { clear: 0, pallets: 0, telegram: 0, stage: 0, history: 0 };
  let failTelegram = true;
  /** @type {any} */
  const service = new CheckService({
    pendingChecks,
    bitrix: {
      async clearWarehousePhotos() {
        calls.clear += 1;
      },
      async updateWarehousePhotos() {
        throw new Error('unexpected photos');
      },
      async updateCombinedPhotos() {
        throw new Error('unexpected combined photos');
      },
      async updateFinalPalletCount() {
        calls.pallets += 1;
      },
      async moveToAcceptedVerification() {
        calls.stage += 1;
      },
    },
    telegram: {
      async sendCheck() {
        calls.telegram += 1;
        if (failTelegram) throw new Error('TELEGRAM: temporary');
      },
    },
    history: {
      async upsert() {},
      async markOrderCompleted() {
        calls.history += 1;
      },
    },
  });
  const fields = {
    orderId: '42',
    orderNumber: 'АФУТ-000042',
    orderTitle: 'Заказ 42',
    noCargo: 'true',
    euro: '0',
    american: '0',
  };
  const first = await service.complete({
    fields: { ...fields },
    files: [],
    user: { login: 'myt', name: 'Мытищи', warehouse: 'Мытищи' },
  });
  assert.equal(first.pending, true);
  const second = await service.complete({
    fields: { ...fields },
    files: [],
    user: { login: 'bal', name: 'Балашиха', warehouse: 'Балашиха' },
  });
  assert.equal(second.accepted, true);

  await Promise.all([service.retryPending(), service.retryPending()]);
  assert.equal(calls.clear, 2);
  assert.equal(calls.pallets, 1);
  assert.equal(calls.telegram, 1);
  assert.equal(calls.stage, 0);
  const failed = await pendingChecks.finalization('42');
  assert.match(failed.lastError, /temporary/);

  failTelegram = false;
  await pendingChecks.updateFinalization('42', (/** @type {any} */ current) => ({
    ...current,
    nextRetryAt: new Date(0).toISOString(),
  }));
  await service.retryPending();
  assert.equal(calls.clear, 2, 'completed Bitrix photo steps must not run again');
  assert.equal(calls.pallets, 1, 'completed pallet step must not run again');
  assert.equal(calls.telegram, 2);
  assert.equal(calls.stage, 1);
  assert.equal(calls.history, 1);
  assert.equal(await pendingChecks.finalization('42'), null);
});

test('ready checks stored before a restart are discovered automatically', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'akfix-check-restart-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new PendingCheckStore(root);
  const fields = { orderId: '73', orderNumber: '73', noCargo: 'true' };
  await store.save({ fields, files: [], user: { login: 'myt', name: 'М', warehouse: 'Мытищи' } });
  await store.save({ fields, files: [], user: { login: 'bal', name: 'Б', warehouse: 'Балашиха' } });
  const restartedStore = new PendingCheckStore(root);
  const jobs = await restartedStore.listFinalizable();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].orderId, '73');
  assert.deepEqual(jobs[0].state.steps, {});
});
