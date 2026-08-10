class CheckService {
  constructor({ bitrix, telegram, pendingChecks }) {
    this.bitrix = bitrix;
    this.telegram = telegram;
    this.pendingChecks = pendingChecks;
    this.finalizing = new Map();
  }

  async complete({ fields, files, user }) {
    this.#validate(fields, files);
    await this.pendingChecks.save({ fields, files, user });
    const pair = await this.pendingChecks.loadPair(fields.orderId);
    const waitingFor = Object.entries(pair).find(([, check]) => !check)?.[0];
    if (waitingFor) return { pending: true, completed: false, savedWarehouse: user.warehouse, waitingFor };

    const key = String(fields.orderId);
    if (!this.finalizing.has(key)) this.finalizing.set(key, this.#finalize(key, pair).finally(() => this.finalizing.delete(key)));
    return this.finalizing.get(key);
  }

  async #finalize(orderId, pair) {
    const status = { pending: false, completed: false, bitrix: false, telegram: false, stageChanged: false };
    for (const warehouse of ['Балашиха', 'Мытищи']) {
      const check = pair[warehouse];
      if (check.fields.noCargo === 'true') await this.bitrix.clearWarehousePhotos({ orderId, warehouse });
      else await this.bitrix.updateWarehousePhotos({ orderId, warehouse, files: check.files });
    }
    status.bitrix = true;
    try {
      const checks = ['Балашиха', 'Мытищи'].map(warehouse => pair[warehouse]);
      const text = checks.map(check => this.#buildText(check.fields, check.user)).join('\n\n');
      const files = checks.flatMap(check => check.files);
      await this.telegram.sendCheck(text, files);
      status.telegram = true;
      await this.bitrix.moveToAcceptedVerification(orderId);
      status.stageChanged = true;
      status.completed = true;
      await this.pendingChecks.clear(orderId);
      return status;
    } catch (error) {
      error.uploadStatus = status;
      throw error;
    }
  }

  #validate(fields, files) {
    if (!fields.orderId || !fields.orderNumber) throw new Error('INVALID_CHECK');
    if (fields.noCargo !== 'true' && !files.length) throw new Error('PHOTOS_REQUIRED');
  }

  #buildText(fields, user) {
    const title = fields.orderTitle || fields.orderNumber;
    const lines = ['📦 ПРОВЕРКА СКЛАДА', `Заказ: ${title}`, `Склад: ${user.warehouse}`, `Проверил: ${user.name}`];
    if (fields.noCargo === 'true') lines.push(`Товара нет на складе ${user.warehouse}`);
    else lines.push(`Европалеты: ${fields.euro || 0}`, `Американские палеты: ${fields.american || 0}`, `Всего палет: ${Number(fields.euro || 0) + Number(fields.american || 0)}`);
    if (fields.specialB === 'true') lines.push('Особый товар: Б — бракованный');
    if (fields.specialP === 'true') lines.push('Особый товар: П — перебитый');
    return lines.join('\n');
  }
}

module.exports = { CheckService };
