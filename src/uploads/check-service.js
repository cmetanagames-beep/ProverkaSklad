class CheckService {
  constructor({ bitrix, telegram }) { this.bitrix = bitrix; this.telegram = telegram; }

  async complete({ fields, files, user }) {
    this.#validate(fields, files);
    const text = this.#buildText(fields, user);
    const status = { bitrix: false, telegram: false };
    await this.bitrix.updateWarehousePhotos({ orderId: fields.orderId, warehouse: user.warehouse, files });
    status.bitrix = true;
    try { await this.telegram.sendCheck(text, files); status.telegram = true; }
    catch (error) { error.uploadStatus = status; throw error; }
    return status;
  }

  #validate(fields, files) {
    if (!fields.orderId || !fields.orderNumber) throw new Error('INVALID_CHECK');
    if (fields.noCargo !== 'true' && !files.length) throw new Error('PHOTOS_REQUIRED');
  }

  #buildText(fields, user) {
    const lines = ['📦 ПРОВЕРКА СКЛАДА', `Заказ: ${fields.orderNumber}`, `Склад: ${user.warehouse}`, `Проверил: ${user.name}`];
    if (fields.noCargo === 'true') lines.push('Результат: на складе товара нет');
    else lines.push(`Европалеты: ${fields.euro || 0}`, `Американские палеты: ${fields.american || 0}`, `Всего палет: ${Number(fields.euro || 0) + Number(fields.american || 0)}`);
    if (fields.specialB === 'true') lines.push('Особый товар: Б — бракованный');
    if (fields.specialP === 'true') lines.push('Особый товар: П — перебитый');
    return lines.join('\n');
  }
}

module.exports = { CheckService };

