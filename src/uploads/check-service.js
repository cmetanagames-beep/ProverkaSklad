class CheckService {
  constructor({ bitrix, telegram, pendingChecks, history }) {
    this.bitrix = bitrix;
    this.telegram = telegram;
    this.pendingChecks = pendingChecks;
    this.history = history;
    this.finalizing = new Map();
  }

  pending() {
    return this.pendingChecks.listPending();
  }
  status(orderId) {
    return this.pendingChecks.status(orderId);
  }

  async complete({ fields, files, user }) {
    const before = await this.pendingChecks.loadPair(fields.orderId);
    if (
      user.warehouse === 'Балашиха' &&
      before['Мытищи'] &&
      before['Балашиха'] &&
      before['Мытищи'].fields.noCargo !== 'true' &&
      !before.combined
    )
      fields.phase = 'combined';
    this.#validate(fields, files);
    if (
      fields.phase === 'combined' &&
      (!before['Мытищи'] || !before['Балашиха'] || before['Мытищи'].fields.noCargo === 'true')
    )
      throw new Error('COMBINED_NOT_REQUIRED');
    await this.pendingChecks.save({ fields, files, user });
    await this.history.upsert(fields, user, 'waiting');
    const pair = await this.pendingChecks.loadPair(fields.orderId);
    const waitingFor = ['Мытищи', 'Балашиха'].find((warehouse) => !pair[warehouse]);
    if (waitingFor) return { pending: true, completed: false, savedWarehouse: user.warehouse, waitingFor };
    if (pair['Мытищи'].fields.noCargo !== 'true' && !pair.combined)
      return {
        pending: true,
        completed: false,
        requiresCombined: true,
        savedWarehouse: user.warehouse,
        waitingFor: 'Объединение на Балашихе',
      };

    await this.pendingChecks.ensureFinalization(fields.orderId);
    return { pending: false, completed: false, accepted: true, processing: true };
  }

  async retryPending() {
    const jobs = await this.pendingChecks.listFinalizable();
    for (const job of jobs) {
      if (job.state.nextRetryAt && Date.parse(job.state.nextRetryAt) > Date.now()) continue;
      await this.#runFinalization(job.orderId, job.pair);
    }
    return jobs.length;
  }

  async #runFinalization(orderId, pair) {
    const key = String(orderId);
    if (this.finalizing.has(key)) return this.finalizing.get(key);
    const task = this.#finalize(key, pair).finally(() => this.finalizing.delete(key));
    this.finalizing.set(key, task);
    return task;
  }

  async #finalize(orderId, pair) {
    let state = await this.pendingChecks.ensureFinalization(orderId);
    const step = async (name, action) => {
      if (state.steps?.[name]) return;
      await action();
      state = await this.pendingChecks.updateFinalization(orderId, (current) => ({
        ...current,
        lastError: '',
        nextRetryAt: null,
        steps: { ...(current?.steps || {}), [name]: new Date().toISOString() },
      }));
    };
    try {
      for (const warehouse of ['Балашиха', 'Мытищи']) {
        const check = pair[warehouse];
        await step(`bitrix:${warehouse}`, async () => {
          if (check.fields.noCargo === 'true') await this.bitrix.clearWarehousePhotos({ orderId, warehouse });
          else await this.bitrix.updateWarehousePhotos({ orderId, warehouse, files: check.files });
        });
      }
      if (pair.combined)
        await step('bitrix:combined', () => this.bitrix.updateCombinedPhotos({ orderId, files: pair.combined.files }));
      const finalChecks = pair.combined ? [pair.combined] : [pair['Мытищи'], pair['Балашиха']];
      const finalCounts = finalChecks.reduce(
        (result, check) => {
          if (!check || check.fields.noCargo === 'true') return result;
          result.euro += Number(check.fields.euro || 0);
          result.american += Number(check.fields.american || 0);
          return result;
        },
        { euro: 0, american: 0 }
      );
      await step('bitrix:pallets', () => this.bitrix.updateFinalPalletCount({ orderId, ...finalCounts }));
      const checks = ['Балашиха', 'Мытищи'].map((warehouse) => pair[warehouse]);
      const text = checks.map((check) => this.#buildText(check.fields, check.user)).join('\n\n');
      const warehouseFiles = [...pair['Мытищи'].files, ...pair['Балашиха'].files];
      await step('telegram:warehouses', () => this.telegram.sendCheck(text, warehouseFiles));
      if (pair.combined) {
        const total = Number(pair.combined.fields.euro || 0) + Number(pair.combined.fields.american || 0);
        await step('telegram:combined', () =>
          this.telegram.sendCheck(
            `ОБЪЕДИНЁННЫЙ ГРУЗ\nЗаказ: ${pair.combined.fields.orderTitle || pair.combined.fields.orderNumber}\nОбъединил: ${pair.combined.user.name}\nЕвропалеты: ${pair.combined.fields.euro || 0}\nАмериканские палеты: ${pair.combined.fields.american || 0}\nВсего палет: ${total}`,
            pair.combined.files
          )
        );
      }
      await step('bitrix:stage', () => this.bitrix.moveToAcceptedVerification(orderId));
      await step('history', () =>
        this.history.markOrderCompleted(
          orderId,
          checks.map((check) => check.user)
        )
      );
      await this.pendingChecks.clear(orderId);
      return { completed: true };
    } catch (error) {
      const attempts = Number(state.attempts || 0) + 1;
      const delay = Math.min(15 * 60 * 1000, 30 * 1000 * 2 ** Math.min(attempts - 1, 5));
      await this.pendingChecks.updateFinalization(orderId, (current) => ({
        ...current,
        attempts,
        lastError: String(error.message || 'CHECK_FINALIZE_FAILED').slice(0, 300),
        nextRetryAt: new Date(Date.now() + delay).toISOString(),
      }));
      return { completed: false, error: String(error.message || error) };
    }
  }

  #validate(fields, files) {
    if (!fields.orderId || !fields.orderNumber) throw new Error('INVALID_CHECK');
    if (fields.noCargo !== 'true' && !files.length) throw new Error('PHOTOS_REQUIRED');
    if (fields.noCargo !== 'true') {
      const palletCount = Number(fields.euro || 0) + Number(fields.american || 0);
      const requiredShots = new Set(['side1', 'side2', 'top']);
      for (let pallet = 1; pallet <= palletCount; pallet++) {
        const present = new Set(
          files
            .map((file) => file.filename.match(new RegExp(`^pallet-${pallet}-(side1|side2|top)-`))?.[1])
            .filter(Boolean)
        );
        if ([...requiredShots].some((shot) => !present.has(shot)))
          throw new Error(`PALLET_PHOTOS_INCOMPLETE:${pallet}`);
      }
    }
  }

  #buildText(fields, user) {
    const title = fields.orderTitle || fields.orderNumber;
    const lines = [`Заказ: ${title}`, `Склад: ${user.warehouse}`, `Проверил: ${user.name}`];
    if (fields.noCargo === 'true') lines.push(`На складе ${user.warehouse} товара нет`);
    else
      lines.push(
        `Европалеты: ${fields.euro || 0}`,
        `Американские палеты: ${fields.american || 0}`,
        `Всего палет: ${Number(fields.euro || 0) + Number(fields.american || 0)}`
      );
    if (fields.specialB === 'true') lines.push('Особый товар: Б — бракованный');
    if (fields.specialP === 'true') lines.push('Особый товар: П — перебитый');
    return lines.join('\n');
  }
}

module.exports = { CheckService };
