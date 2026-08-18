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
  client.call = async method => {
    if (method === 'crm.item.fields') return { fields: { ufOrder: { title: 'Номер счета' } } };
    if (method === 'crm.item.list') return { items: [{ id: 3424, ufOrder: 'АФУТ-005678' }] };
    throw new Error(`Unexpected method: ${method}`);
  };

  await assert.rejects(() => client.findItemByOrderNumber('3424'), /BITRIX_ORDER_NOT_FOUND: АФУТ-003424/);
});
