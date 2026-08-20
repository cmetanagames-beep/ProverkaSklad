const test = require('node:test');
const assert = require('node:assert/strict');
const { BitrixClient } = require('../src/integrations/bitrix-client');

test('finds a Bitrix item by the exact account number field', async () => {
  const client = new BitrixClient('https://example.test');
  const calls = [];
  client.call = async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'crm.item.fields') return { fields: { ufOrder: { title: 'Номер счета' } } };
    if (method === 'crm.item.list') {
      if (payload.filter.ufOrder === '3424') return { items: [] };
      return { items: [{ id: 8622, title: 'Клиент', ufOrder: 'АФУТ-003424' }] };
    }
    if (method === 'crm.item.get') return { item: { id: 8622, title: 'Клиент' } };
    throw new Error(`Unexpected method: ${method}`);
  };

  const result = await client.findItemByOrderNumber('3424');

  assert.equal(result.item.id, 8622);
  assert.deepEqual(calls[1].payload.filter, { ufOrder: '3424' });
  assert.deepEqual(calls[2].payload.filter, { ufOrder: 'АФУТ-003424' });
  assert.equal(calls[3].payload.id, 8622);
});

test('finds a Bitrix item whose account number is stored without the АФУТ prefix', async () => {
  const client = new BitrixClient('https://example.test');
  const calls = [];
  client.call = async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'crm.item.fields') return { fields: { ufOrder: { title: 'Номер счета' } } };
    if (method === 'crm.item.list')
      return { items: [{ id: 1231313, title: '(А) 1231313 Тестовая компания 4', ufOrder: '1231313' }] };
    if (method === 'crm.item.get') return { item: { id: 1231313, title: '(А) 1231313 Тестовая компания 4' } };
    throw new Error(`Unexpected method: ${method}`);
  };

  const result = await client.findItemByOrderNumber('1231313');

  assert.equal(result.item.id, 1231313);
  assert.deepEqual(calls[1].payload.filter, { ufOrder: '1231313' });
  assert.equal(calls.filter((call) => call.method === 'crm.item.list').length, 1);
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

test('driver completion saves the receipt without a timeline comment and moves the deal to Принято на проверку', async () => {
  const client = new BitrixClient('https://example.test');
  const calls = [];
  client.call = async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'crm.status.list')
      return [
        { NAME: 'Передан на сборку', STATUS_ID: 'DT1052_31:PREPARATION' },
        { NAME: 'Принято на проверку', STATUS_ID: 'DT1052_31:ACCEPTED_CHECK' },
        { NAME: 'Груз отправлен', STATUS_ID: 'DT1052_31:SUCCESS' },
      ];
    return {};
  };

  await client.completeDriverDelivery({
    orderId: '8622',
    file: { filename: 'receipt.jpg', buffer: Buffer.from('photo') },
  });

  assert.equal(
    calls.some((call) => call.method === 'crm.timeline.comment.add'),
    false
  );
  assert.deepEqual(calls[0], {
    method: 'crm.item.update',
    payload: {
      entityTypeId: 1052,
      id: 8622,
      fields: {
        ufCrm19ExpeditorReceipt: [['receipt.jpg', Buffer.from('photo').toString('base64')]],
      },
    },
  });
  assert.deepEqual(calls[1], {
    method: 'crm.status.list',
    payload: { filter: { ENTITY_ID: 'DYNAMIC_1052_STAGE_31' } },
  });
  assert.deepEqual(calls[2], {
    method: 'crm.item.update',
    payload: { entityTypeId: 1052, id: 8622, fields: { stageId: 'DT1052_31:ACCEPTED_CHECK' } },
  });
});

test('driver delivery reset clears the receipt and returns the deal to Передан на сборку', async () => {
  const client = new BitrixClient('https://example.test');
  const calls = [];
  client.call = async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'crm.status.list') return [{ NAME: 'Передан на сборку', STATUS_ID: 'DT1052_31:PREPARATION' }];
    return {};
  };

  await client.resetDriverDelivery('1231313');

  assert.deepEqual(calls[1], {
    method: 'crm.item.update',
    payload: {
      entityTypeId: 1052,
      id: 1231313,
      fields: { stageId: 'DT1052_31:PREPARATION', ufCrm19ExpeditorReceipt: [] },
    },
  });
});

test('creates delivery fields and places them after the requested anchors', async () => {
  const client = new BitrixClient('https://example.test');
  const calls = [];
  client.call = async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'crm.type.getByEntityTypeId') return { type: { id: 19, entityTypeId: 1052 } };
    if (method === 'userfieldconfig.list')
      return {
        fields: [
          { fieldName: 'UF_CRM_19_1751628673880', editFormLabel: { ru: 'Трек номер' } },
          { fieldName: 'UF_CRM_19_1751013757786', editFormLabel: { ru: 'Условия доставки' } },
        ],
      };
    if (method === 'userfieldconfig.add')
      return { field: { ...payload.field, id: payload.field.userTypeId === 'file' ? 7001 : 7002 } };
    if (method === 'crm.item.fields')
      return {
        fields: {
          ufTrack: { title: 'Трек номер' },
          ufCrm19ExpeditorReceipt: { title: 'Фото экспедиторской расписки' },
          ufTerms: { title: 'Условия доставки' },
          ufCrm19DeliveryCompanyName: { title: 'Название транспортной компании' },
        },
      };
    if (method === 'crm.item.details.configuration.get')
      return [
        {
          name: 'warehouse',
          title: 'Склад',
          type: 'section',
          elements: [{ name: 'UF_CRM_19_1751628673880' }],
        },
        {
          name: 'delivery',
          title: 'Доставка',
          type: 'section',
          elements: [{ name: 'UF_CRM_19_1751013757786' }],
        },
      ];
    if (method === 'crm.item.details.configuration.set') return true;
    throw new Error(`Unexpected method: ${method}`);
  };

  const result = await client.ensureDeliveryFields();

  assert.deepEqual(result, {
    entityId: 'CRM_19',
    photo: { created: true, fieldId: '7001', fieldCode: 'ufCrm19ExpeditorReceipt' },
    company: { created: true, fieldId: '7002', fieldCode: 'ufCrm19DeliveryCompanyName' },
    layoutUpdated: true,
  });
  assert.equal(calls[2].method, 'userfieldconfig.add');
  assert.equal(calls[2].payload.field.userTypeId, 'file');
  assert.equal(calls[2].payload.field.multiple, 'Y');
  assert.equal(calls[3].payload.field.userTypeId, 'string');
  const layoutCall = calls.find((call) => call.method === 'crm.item.details.configuration.set');
  assert.deepEqual(
    layoutCall.payload.data[0].elements.map((element) => element.name),
    ['UF_CRM_19_1751628673880', 'UF_CRM_19_EXPEDITOR_RECEIPT']
  );
  assert.deepEqual(
    layoutCall.payload.data[1].elements.map((element) => element.name),
    ['UF_CRM_19_1751013757786', 'UF_CRM_19_DELIVERY_COMPANY_NAME']
  );
  assert.equal(layoutCall.payload.data[0].elements[1].optionFlags, 1);
  assert.equal(layoutCall.payload.data[1].elements[1].optionFlags, 1);
});

test('reuses delivery fields by permanent code when Bitrix omits their labels', async () => {
  const client = new BitrixClient('https://example.test');
  const calls = [];
  client.call = async (method, payload) => {
    calls.push({ method, payload });
    if (method === 'crm.type.getByEntityTypeId') return { type: { id: 19 } };
    if (method === 'userfieldconfig.list')
      return {
        fields: [
          { FIELD_NAME: 'UF_CRM_19_EXPEDITOR_RECEIPT', id: 7001 },
          { fieldName: 'UF_CRM_19_DELIVERY_COMPANY_NAME', id: 7002 },
        ],
      };
    if (method === 'crm.item.fields')
      return {
        fields: {
          ufCrm19_1751628673880: { title: 'Трек номер' },
          ufCrm19ExpeditorReceipt: { title: 'Фото экспедиторской расписки' },
          ufCrm19_1751013757786: { title: 'Условия доставки' },
          ufCrm19DeliveryCompanyName: { title: 'Название транспортной компании' },
        },
      };
    if (method === 'crm.item.details.configuration.get')
      return [
        { name: 'warehouse', elements: [{ name: 'UF_CRM_19_1751628673880' }] },
        { name: 'delivery', elements: [{ name: 'UF_CRM_19_1751013757786' }] },
      ];
    if (method === 'crm.item.details.configuration.set') return true;
    throw new Error(`Unexpected method: ${method}`);
  };

  const result = await client.ensureDeliveryFields();

  assert.equal(result.photo.created, false);
  assert.equal(result.company.created, false);
  assert.equal(
    calls.some((call) => call.method === 'userfieldconfig.add'),
    false
  );
  const layoutCall = calls.find((call) => call.method === 'crm.item.details.configuration.set');
  assert.deepEqual(
    layoutCall.payload.data.flatMap((section) => section.elements.map((element) => element.name)),
    [
      'UF_CRM_19_1751628673880',
      'UF_CRM_19_EXPEDITOR_RECEIPT',
      'UF_CRM_19_1751013757786',
      'UF_CRM_19_DELIVERY_COMPANY_NAME',
    ]
  );
});
