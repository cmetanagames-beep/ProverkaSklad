class CheckService {
  constructor({ bitrix, telegram, pendingChecks, history }) {
    this.bitrix = bitrix;
    this.telegram = telegram;
    this.pendingChecks = pendingChecks;
    this.history = history;
    this.finalizing = new Map();
  }

  pending() { return this.pendingChecks.listPending(); }

  async complete({ fields, files, user }) {
    this.#validate(fields, files);
    await this.pendingChecks.save({ fields, files, user });
    await this.history.upsert(fields, user, 'waiting');
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
      await this.history.markOrderCompleted(orderId, checks.map(check => check.user));
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
    if (fields.noCargo !== 'true') {
      const palletCount = Number(fields.euro || 0) + Number(fields.american || 0);
      const requiredShots = new Set(['angle1', 'angle2', 'top', 'product1', 'product2']);
      for (let pallet = 1; pallet <= palletCount; pallet++) {
        const present = new Set(files.map(file => file.filename.match(new RegExp(`^pallet-${pallet}-(angle1|angle2|top|product1|product2)-`))?.[1]).filter(Boolean));
        if ([...requiredShots].some(shot => !present.has(shot))) throw new Error(`PALLET_PHOTOS_INCOMPLETE:${pallet}`);
      }
    }
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
