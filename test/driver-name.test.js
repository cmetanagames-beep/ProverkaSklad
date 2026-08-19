const test = require('node:test');
const assert = require('node:assert/strict');
const { driverNamesMatch } = require('../src/domain/driver-name');
const {
  bitrixIdFromOrderNumber,
  normalizeSheetDate,
  sheetDateFromIso,
  moscowIsoDate,
  shippingOrderId,
  fillDownShippingClients,
} = require('../src/integrations/shipping-sheet-client');

test('matches a short account name to the full spreadsheet name', () => {
  assert.equal(driverNamesMatch('Магомедов Шамиль', 'Магомедов Шамиль Магомедович'), true);
});

test('normalizes letter case, punctuation and ё', () => {
  assert.equal(driverNamesMatch('Семёнов Иван', 'семенов  иван.'), true);
});

test('does not match different drivers', () => {
  assert.equal(driverNamesMatch('Магомедов Шамиль', 'Магомедов Ринат'), false);
  assert.equal(driverNamesMatch('Иван', 'Иванов Иван'), false);
});

test('normalizes the order number without treating it as a Bitrix item id', () => {
  assert.equal(bitrixIdFromOrderNumber('3424'), '3424');
  assert.equal(bitrixIdFromOrderNumber('АФУТ-003424'), '003424');
});

test('converts an ISO date to the spreadsheet date format', () => {
  assert.equal(sheetDateFromIso('2027-01-01'), '01.01.2027');
  assert.equal(normalizeSheetDate('1.1.2027'), '01.01.2027');
  assert.equal(sheetDateFromIso('01.01.2027'), '');
});

test('calculates tomorrow as a valid Moscow calendar date', () => {
  assert.match(moscowIsoDate(1), /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(moscowIsoDate(1), moscowIsoDate());
});

test('shipping order identity is stable across row moves and distinct across dates', () => {
  assert.equal(shippingOrderId('2026-08-20', '3499', 20), shippingOrderId('2026-08-20', '3499', 99));
  assert.notEqual(shippingOrderId('2026-08-20', '3499', 20), shippingOrderId('2026-08-21', '3499', 20));
});

test('blank client cells inherit the client only within the same shipping date', () => {
  const rows = fillDownShippingClients([
    { date: '20.08.2026', client: 'Алтай-сервис', orderNumber: '3289' },
    { date: '20.08.2026', client: '', orderNumber: '3500' },
    { date: '20.08.2026', client: '', orderNumber: '3297' },
    { date: '21.08.2026', client: '', orderNumber: '4000' },
  ]);
  assert.equal(rows[1].client, 'Алтай-сервис');
  assert.equal(rows[2].client, 'Алтай-сервис');
  assert.equal(rows[3].client, '');
});
