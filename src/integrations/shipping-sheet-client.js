const HEADER_ALIASES = {
  date: ['Число'], client: ['Наименование Наименование', 'Наименование'],
  orderNumber: ['Номер заказа'], bitrixId: ['Заявки на Балашихе', 'Заявки на балашихе'],
  warehouse: ['Склад'], documents: ['Документы'], relabel: ['Перебивка с Мытищи'],
  marking: ['ЧЗ'], status: ['Статус'], driver: ['Водитель'], delivery: ['Доставка'], amount: ['Сумма'],
};
const FALLBACK_INDEX = { date: 1, client: 3, orderNumber: 4, bitrixId: 5, warehouse: 6, documents: 7, relabel: 8, marking: 9, status: 10, driver: 11, delivery: 12, amount: 14 };
const bitrixIdFromOrderNumber = value => String(value || '').replace(/\D/g, '');

class ShippingSheetClient {
  constructor({ spreadsheetId, sheetName }) { this.spreadsheetId = spreadsheetId; this.sheetName = sheetName; }

  async listForDriver(driverName) {
    const rows = await this.listToday();
    const normalized = String(driverName || '').trim().toLocaleLowerCase('ru');
    return rows.filter(item => item.driver.toLocaleLowerCase('ru') === normalized);
  }

  async listToday() {
    const url = new URL(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(this.spreadsheetId)}/gviz/tq`);
    url.searchParams.set('tqx', 'out:json'); url.searchParams.set('sheet', this.sheetName); url.searchParams.set('headers', '2');
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`SHIPPING_SHEET_${response.status}`);
    const text = await response.text();
    const match = text.match(/setResponse\((.*)\);?\s*$/s);
    if (!match) throw new Error('SHIPPING_SHEET_FORMAT');
    const table = JSON.parse(match[1]).table;
    const labels = table.cols.map(column => String(column.label || '').trim());
    const index = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, aliases.map(alias => labels.indexOf(alias)).find(i => i >= 0) ?? FALLBACK_INDEX[key]]));
    const value = (row, key) => { const cell = row.c[index[key]]; return cell ? String(cell.f ?? cell.v ?? '').trim() : ''; };
    const today = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
    const normalizeDate = input => {
      const parts = String(input || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      return parts ? `${parts[1].padStart(2, '0')}.${parts[2].padStart(2, '0')}.${parts[3]}` : '';
    };
    return table.rows.map((row, rowIndex) => ({
      id: `sheet-${rowIndex + 2}`,
      row: rowIndex + 2,
      date: value(row, 'date'), client: value(row, 'client'), orderNumber: value(row, 'orderNumber'),
      bitrixId: bitrixIdFromOrderNumber(value(row, 'orderNumber')), warehouse: value(row, 'warehouse'),
      documents: value(row, 'documents'), relabel: value(row, 'relabel'), marking: value(row, 'marking'),
      status: value(row, 'status'), driver: value(row, 'driver'), delivery: value(row, 'delivery'), amount: value(row, 'amount'),
    })).filter(item => normalizeDate(item.date) === today && (item.orderNumber || item.client));
  }

}

module.exports = { ShippingSheetClient, bitrixIdFromOrderNumber };
