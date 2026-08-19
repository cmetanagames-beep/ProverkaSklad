const test = require('node:test');
const assert = require('node:assert/strict');
const { BitrixClient } = require('../src/integrations/bitrix-client');

test('finds a Bitrix item by the exact account number field', async () => {
  const client = new BitrixClient('https://example.test');
  const calls = [];
  client.call = async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'crm.item.fields') return { fields: { ufOrder: { title: 'Номер счета' } } };
    if (method === 'crm.item.list') return { items: [{ id: 8622, title: 'Клиент', ufOrder: 'АФУТ-003424' }] };
    if (method === 'crm.item.get') return { item: { id: 8622, title: 'Клиент' } };
    throw new Error(`Unexpected method: ${method}`);
  };

  const result = await client.findItemByOrderNumber('3424');

  assert.equal(result.item.id, 8622);
  assert.deepEqual(calls[1].payload.filter, { ufOrder: 'АФУТ-003424' });
  assert.equal(calls[2].payload.id, 8622);
});

test('does not accept a different account number returned by Bitrix', async () => {
  const client = new BitrixClient('https://example.test');
  client.call = async (method) => {
    if (method === 'crm.item.fields') return { fields: { ufOrder: { title: 'Номер счета' } } };
    if (method === 'crm.item.list') return { items: [{ id: 3424, ufOrder: 'АФУТ-005678' }] };
    throw new Error(`Unexpected method: ${method}`);
  };

  await assert.rejects(() => client.findItemByOrderNumber('3424'), /BITRIX_ORDER_NOT_FOUND: АФУТ-003424/);
});

test('driver completion adds the receipt and moves the deal to Груз отправлен', async () => {
  const client = new BitrixClient('https://example.test');
  const calls = [];
  client.call = async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'crm.status.list') return [{ NAME: 'Груз отправлен', STATUS_ID: 'DT1052_31:SHIPPED' }];
    return {};
  };

  await client.completeDriverDelivery({
    orderId: '8622',
    driverName: 'Магомедов Шамиль',
    delivery: 'ТК Деловые линии',
    file: { filename: 'receipt.jpg', buffer: Buffer.from('photo') },
  });

  assert.equal(calls[0].method, 'crm.timeline.comment.add');
  assert.deepEqual(calls[0].payload.fields.FILES, [['receipt.jpg', Buffer.from('photo').toString('base64')]]);
  assert.deepEqual(calls[1], {
    method: 'crm.status.list',
    payload: { filter: { ENTITY_ID: 'DYNAMIC_1052_STAGE_31' } },
  });
  assert.deepEqual(calls[2], {
    method: 'crm.item.update',
    payload: { entityTypeId: 1052, id: 8622, fields: { stageId: 'DT1052_31:SHIPPED' } },
  });
});
