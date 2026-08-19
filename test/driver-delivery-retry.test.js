// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const { Application } = require('../src/app');

/** @param {(text: string, files: Array<unknown>) => Promise<unknown>} sendCheck */
function setup(sendCheck) {
  /** @type {any} */
  const item = {
    login: 'driver',
    driverName: 'Иванов Иван',
    orderId: 'order-1',
    order: { orderNumber: '1234', client: 'Клиент', delivery: 'ТК', date: '19.08.2026' },
    completedAt: '2026-08-19T10:00:00.000Z',
    photo: { id: 'photo.jpg', mime: 'image/jpeg', filename: 'receipt.jpg' },
    telegramPending: true,
  };
  /** @type {any} */
  const store = {
    item,
    listAll() {
      return [this.item];
    },
    get() {
      return this.item;
    },
    async photo() {
      return Buffer.from('photo');
    },
    async complete(/** @type {any} */ value) {
      this.item = value;
      return value;
    },
  };
  const telegram = { configured: true, sendCheck };
  return {
    app: new Application({
      publicDir: '',
      receivingTestDir: '',
      sessions: null,
      bitrix: null,
      multipart: null,
      checks: null,
      history: null,
      userStore: null,
      shippingSheet: null,
      driverDeliveries: store,
      telegramExpeditor: telegram,
      receiving: null,
    }),
    store,
  };
}

test('pending Telegram receipt is sent once even when retries overlap', async () => {
  let sends = 0;
  const { app, store } = setup(async () => {
    sends += 1;
  });
  await Promise.all([app.retryPendingDriverDeliveries(), app.retryPendingDriverDeliveries()]);
  assert.equal(sends, 1);
  assert.equal(store.item.telegramPending, false);
  assert.ok(store.item.telegramSentAt);
  await app.retryPendingDriverDeliveries();
  assert.equal(sends, 1);
});

test('failed Telegram receipt remains durable and respects retry delay', async () => {
  let sends = 0;
  const { app, store } = setup(async () => {
    sends += 1;
    throw new Error('TELEGRAM: temporary');
  });
  await app.retryPendingDriverDeliveries();
  assert.equal(sends, 1);
  assert.equal(store.item.telegramPending, true);
  assert.equal(store.item.telegramAttempts, 1);
  assert.match(store.item.telegramLastError, /temporary/);
  assert.ok(Date.parse(store.item.telegramNextRetryAt) > Date.now());
  await app.retryPendingDriverDeliveries();
  assert.equal(sends, 1);
});
