const test = require('node:test');
const assert = require('node:assert/strict');
const { driverBitrixFields, formatValue } = require('../src/domain/driver-bitrix-fields');

test('returns only named delivery fields in the intended order', () => {
  const definitions = { createdBy: { title: 'Кем создано' }, ufPlan: { title: 'Плановая дата отгрузки' }, ufTerms: { title: 'Условия доставки', items: [{ ID: '7', VALUE: 'Транспортная компания' }] }, ufContact: { title: 'Контактное лицо и номер телефона получателя' }, ufAddress: { title: 'Адрес доставки' } };
  const fields = driverBitrixFields({ createdBy: 1707, ufPlan: '2026-08-18', ufTerms: '7', ufContact: '+7 988 285-34-44 Бахчагулян Рафаел', ufAddress: 'Ростов-на-Дону, ул Нансена, 148А' }, definitions);
  assert.deepEqual(fields, [
    { key: 'ufPlan', label: 'Плановая дата отгрузки', value: '18.08.2026' },
    { key: 'ufContact', label: 'Контакт получателя', value: '+7 988 285-34-44 Бахчагулян Рафаел' },
    { key: 'ufAddress', label: 'Адрес доставки', value: 'Ростов-на-Дону, ул Нансена, 148А' },
  ]);
  assert.equal(fields.some(field => field.key === 'createdBy'), false);
  assert.equal(fields.some(field => field.key === 'ufTerms'), false);
});
test('formats empty, boolean and enumeration values for a driver', () => {
  assert.equal(formatValue('', {}), 'Не заполнено');
  assert.equal(formatValue('N', {}), 'Нет');
  assert.equal(formatValue('3', { items: [{ id: 3, value: 'Мы' }] }), 'Мы');
});

test('recognizes Bitrix labels stored outside title and with different wording', () => {
  const fields = driverBitrixFields({ ufPlan: '2026-08-18', ufPayer: 'Мы', ufDocs: 'N', ufInfo: 'СДЭК до ПВЗ', ufPhone: '+7 900 000-00-00', ufAddress: 'Ростов-на-Дону' }, {
    ufPlan: { title: 'UF_CRM_1', formLabel: 'Дата отгрузки (плановая)' },
    ufPayer: { title: 'UF_CRM_2', listLabel: 'Плательщик за доставку' },
    ufDocs: { title: 'UF_CRM_3', formLabel: 'Класть ли документы вместе с грузом?' },
    ufInfo: { title: 'UF_CRM_4', formLabel: 'Доп. информация по доставке' },
    ufPhone: { title: 'UF_CRM_5', formLabel: 'Телефон конечного получателя' },
    ufAddress: { title: 'UF_CRM_6', formLabel: 'Адрес для доставки' },
  });
  assert.equal(fields.length, 6);
  assert.deepEqual(fields.map(field => field.value), ['18.08.2026', 'Мы', 'Нет', 'СДЭК до ПВЗ', '+7 900 000-00-00', 'Ростов-на-Дону']);
});
