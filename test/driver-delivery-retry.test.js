// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const { Application, driverRowMatches, groupDriverRows } = require('../src/app');

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

test('same address and recipient are combined while another destination stays separate', () => {
  const common = {
    date: '20.08.2026',
    client: 'Алтай-сервис',
    warehouse: 'Балашиха',
    delivery: 'ТК Байкал Сервис',
    driver: 'Шамиль',
    deliveryAddress: 'Москва',
    recipientContact: 'Иван +7 900 000-00-00',
  };
  const grouped = groupDriverRows([
    { ...common, id: '1', orderNumber: '3289' },
    { ...common, id: '2', orderNumber: '3500' },
    { ...common, id: '3', orderNumber: '3297' },
    { ...common, id: '4', orderNumber: '4000', deliveryAddress: 'Пермь' },
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].isGroup, true);
  assert.deepEqual(grouped[0].orderNumbers, ['3289', '3500', '3297']);
  assert.equal(grouped[1].orderNumber, '4000');
});

test('an old queued child order still resolves to its grouped shipment', () => {
  const group = {
    id: 'group:altai',
    orderNumber: '3289, 3500, 3297',
    orders: [{ orderNumber: '3289' }, { orderNumber: '3500' }, { orderNumber: '3297' }],
  };
  assert.equal(driverRowMatches(group, 'old-sheet-id', '3500'), true);
  assert.equal(driverRowMatches(group, 'old-group-id', '3289, 3500, 3297'), true);
  assert.equal(driverRowMatches(group, 'old-sheet-id', '4000'), false);
});

test('a numeric sheet order still matches the string stored in an old phone queue', () => {
  assert.equal(driverRowMatches({ id: 'new-id', orderNumber: 1231313 }, 'old-id', '1231313'), true);
});

test('one grouped receipt completes every Bitrix deal and sends one Telegram message', async () => {
  /** @type {any} */
  const item = {
    login: 'driver',
    driverName: 'Шамиль',
    orderId: 'group-1',
    order: {
      orderNumber: '3289, 3500, 3297',
      client: 'Алтай-сервис',
      delivery: 'ТК Байкал Сервис',
      date: '20.08.2026',
      orders: [{ orderNumber: '3289' }, { orderNumber: '3500' }, { orderNumber: '3297' }],
    },
    photo: { id: 'photo.jpg', mime: 'image/jpeg', filename: 'receipt.jpg' },
    bitrixPending: true,
    bitrixItems: [],
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
  /** @type {string[]} */
  const bitrixCalls = [];
  let telegramCalls = 0;
  const app = new Application({
    publicDir: '',
    receivingTestDir: '',
    sessions: null,
    multipart: null,
    checks: null,
    history: null,
    userStore: null,
    shippingSheet: null,
    receiving: null,
    driverDeliveries: store,
    bitrix: {
      configured: true,
      async findItemByOrderNumber(/** @type {string} */ orderNumber) {
        return { item: { id: Number(orderNumber) } };
      },
      async completeDriverDelivery(/** @type {{ orderId: string }} */ { orderId }) {
        bitrixCalls.push(orderId);
      },
    },
    telegramExpeditor: {
      configured: true,
      async sendCheck() {
        telegramCalls += 1;
      },
    },
  });
  await app.retryPendingDriverDeliveries();
  assert.deepEqual(bitrixCalls, ['3289', '3500', '3297']);
  assert.equal(store.item.bitrixItems.length, 3);
  assert.equal(store.item.bitrixPending, false);
  assert.equal(telegramCalls, 1);
  await app.retryPendingDriverDeliveries();
  assert.deepEqual(bitrixCalls, ['3289', '3500', '3297']);
  assert.equal(telegramCalls, 1);
});
