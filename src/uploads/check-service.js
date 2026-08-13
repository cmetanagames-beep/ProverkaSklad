class CheckService {
  constructor({ bitrix, telegram, pendingChecks, history }) {
    this.bitrix = bitrix;
    this.telegram = telegram;
    this.pendingChecks = pendingChecks;
    this.history = history;
    this.finalizing = new Map();
  }

  pending() { return this.pendingChecks.listPending(); }
  status(orderId) { return this.pendingChecks.status(orderId); }

  async complete({ fields, files, user }) {
    const before = await this.pendingChecks.loadPair(fields.orderId);
    if (user.warehouse === 'Балашиха' && before['Мытищи'] && before['Балашиха'] && before['Мытищи'].fields.noCargo !== 'true' && !before.combined) fields.phase = 'combined';
    this.#validate(fields, files);
    if (fields.phase === 'combined' && (!before['Мытищи'] || !before['Балашиха'] || before['Мытищи'].fields.noCargo === 'true')) throw new Error('COMBINED_NOT_REQUIRED');
    await this.pendingChecks.save({ fields, files, user });
    await this.history.upsert(fields, user, 'waiting');
    const pair = await this.pendingChecks.loadPair(fields.orderId);
    const waitingFor = ['Мытищи','Балашиха'].find(warehouse => !pair[warehouse]);
    if (waitingFor) return { pending: true, completed: false, savedWarehouse: user.warehouse, waitingFor };
    if (pair['Мытищи'].fields.noCargo !== 'true' && !pair.combined) return { pending: true, completed: false, requiresCombined: true, savedWarehouse: user.warehouse, waitingFor: 'Объединение на Балашихе' };

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
    if (pair.combined) await this.bitrix.updateCombinedPhotos({ orderId, files: pair.combined.files });
    status.bitrix = true;
    try {
      const checks = ['Балашиха', 'Мытищи'].map(warehouse => pair[warehouse]);
      let text = checks.map(check => this.#buildText(check.fields, check.user)).join('\n\n');
      if (pair.combined) text += `\n\nОБЪЕДИНЁННЫЙ ГРУЗ\nСклад: Балашиха\nОбъединил: ${pair.combined.user.name}\nЕвропалеты после объединения: ${pair.combined.fields.euro || 0}\nАмериканские палеты после объединения: ${pair.combined.fields.american || 0}\nВсего после объединения: ${Number(pair.combined.fields.euro || 0) + Number(pair.combined.fields.american || 0)} палет`;
      const warehouseFiles = [...pair['Мытищи'].files, ...pair['Балашиха'].files];
      await this.telegram.sendCheck(text, warehouseFiles);
      if (pair.combined) {
        const total = Number(pair.combined.fields.euro || 0) + Number(pair.combined.fields.american || 0);
        await this.telegram.sendCheck(`ФОТО ОБЪЕДИНЁННОГО ГРУЗА\nЗаказ: ${pair.combined.fields.orderTitle || pair.combined.fields.orderNumber}\nОбъединил: ${pair.combined.user.name}\nПосле объединения получилось: ${total} палет`, pair.combined.files);
      }
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
      const requiredShots = new Set(['side1', 'side2', 'top']);
      for (let pallet = 1; pallet <= palletCount; pallet++) {
        const present = new Set(files.map(file => file.filename.match(new RegExp(`^pallet-${pallet}-(side1|side2|top)-`))?.[1]).filter(Boolean));
        if ([...requiredShots].some(shot => !present.has(shot))) throw new Error(`PALLET_PHOTOS_INCOMPLETE:${pallet}`);
      }
    }
  }

  #buildText(fields, user) {
    const title = fields.orderTitle || fields.orderNumber;
    const lines = [`Заказ: ${title}`, `Склад: ${user.warehouse}`, `Проверил: ${user.name}`];
    if (fields.noCargo === 'true') lines.push(`На складе ${user.warehouse} товара нет`);
    else lines.push(`Европалеты: ${fields.euro || 0}`, `Американские палеты: ${fields.american || 0}`, `Всего палет: ${Number(fields.euro || 0) + Number(fields.american || 0)}`);
    if (fields.specialB === 'true') lines.push('Особый товар: Б — бракованный');
    if (fields.specialP === 'true') lines.push('Особый товар: П — перебитый');
    return lines.join('\n');
  }
}

module.exports = { CheckService };
