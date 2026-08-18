const DRIVER_FIELDS = [
  ['Плановая дата отгрузки', ['плановая дата отгрузки']],
  ['Кто оплачивает доставку', ['кто оплачивает доставку']],
  ['Документы с грузом', ['класть документы с грузом', 'документы с грузом']],
  ['Дополнительная информация', ['дополнительная информация о доставке']],
  ['Контакт получателя', ['контактное лицо и номер телефона получателя', 'контактное лицо получателя']],
  ['Адрес доставки', ['адрес доставки']],
];

function normalize(value) { return String(value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').trim(); }
function formatValue(value, definition = {}) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return 'Не заполнено';
  if (Array.isArray(value)) return value.map(item => formatValue(item, definition)).join(', ');
  const option = (Array.isArray(definition.items) ? definition.items : []).find(item => String(item.ID ?? item.id) === String(value));
  if (option) return String(option.VALUE ?? option.value ?? value);
  if (value === 'Y' || value === true) return 'Да';
  if (value === 'N' || value === false) return 'Нет';
  const text = String(value), date = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  return date ? `${date[3]}.${date[2]}.${date[1]}` : text;
}
function driverBitrixFields(item = {}, definitions = {}) {
  const byTitle = Object.entries(definitions).map(([key, definition]) => ({ key, definition, title: normalize(definition?.title || definition?.formLabel || '') }));
  return DRIVER_FIELDS.map(([label, aliases]) => {
    const match = byTitle.find(field => aliases.some(alias => field.title === alias || field.title.includes(alias)));
    return match ? { key: match.key, label, value: formatValue(item[match.key], match.definition) } : null;
  }).filter(Boolean);
}
module.exports = { driverBitrixFields, formatValue };
