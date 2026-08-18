const DRIVER_FIELDS = [
  ['Плановая дата отгрузки', [['план', 'отгруз']]],
  ['Кто оплачивает доставку', [['оплач', 'достав'], ['плательщик', 'достав']]],
  ['Документы с грузом', [['документ', 'груз']]],
  ['Дополнительная информация', [['дополн', 'достав'], ['доп', 'достав']]],
  ['Контакт получателя', [['контакт', 'получ'], ['телефон', 'получ']]],
  ['Адрес доставки', [['адрес', 'достав']]],
];

function normalize(value) { return String(value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim(); }
function labelsOf(definition = {}) {
  return ['title', 'formLabel', 'listLabel', 'filterLabel'].flatMap(key => {
    const value = definition[key];
    return value && typeof value === 'object' ? Object.values(value) : [value];
  }).map(normalize).filter(Boolean);
}
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
  const candidates = Object.entries(definitions).map(([key, definition]) => ({ key, definition, labels: labelsOf(definition) }));
  return DRIVER_FIELDS.map(([label, patterns]) => {
    const match = candidates.find(field => field.labels.some(title => patterns.some(tokens => tokens.every(token => title.includes(token)))));
    return match ? { key: match.key, label, value: formatValue(item[match.key], match.definition) } : null;
  }).filter(Boolean);
}
module.exports = { driverBitrixFields, formatValue };
