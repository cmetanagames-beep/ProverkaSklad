const test = require('node:test');
const assert = require('node:assert/strict');
const { driverNamesMatch } = require('../src/domain/driver-name');

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
