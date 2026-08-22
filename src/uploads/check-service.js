// @ts-check

const STAGE_BY_WAREHOUSE = { Мытищи: 'mytishchi', Балашиха: 'balashikha' };

/** @typedef {{orderId:string, orderNumber:string, orderTitle?:string, phase?:string, noCargo:string, euro?:string, american?:string, specialB?:string, specialP?:string}} CheckFields */
/** @typedef {{filename:string, mime:string, buffer:Buffer}} CheckFile */
/** @typedef {{login:string, name:string, warehouse:'Мытищи'|'Балашиха'}} CheckUser */
/** @typedef {{orderId:string, stage:string, delivery:{nextAttemptAt?:string}}} CheckJob */

class CheckService {
  /** @param {{bitrix:any, telegram:any, pendingChecks:any, history:any, retryMs?:number, concurrency?:number}} options */
  constructor({ bitrix, telegram, pendingChecks, history, retryMs = 30000, concurrency = 3 }) {
    this.bitrix = bitrix;
    this.telegram = telegram;
    this.pendingChecks = pendingChecks;
    this.history = history;
    this.retryMs = retryMs;
    this.concurrency = concurrency;
    this.processing = new Map();
    this.queueRun = null;
    this.queueRequested = false;
    this.retryTimer = null;
  }

  start() {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(
      () => this.processQueue().catch((error) => console.error('Check queue failed:', error)),
      this.retryMs
    );
    this.retryTimer.unref();
    const initial = setTimeout(
      () => this.processQueue().catch((error) => console.error('Initial check queue failed:', error)),
      3000
    );
    initial.unref();
  }

  pending() {
    return this.pendingChecks.listPending();
  }
  /** @param {string} orderId */
  status(orderId) {
    return this.pendingChecks.status(orderId);
  }

  /** @param {{fields:CheckFields, files:CheckFile[], user:CheckUser}} input */
  async complete({ fields, files, user }) {
    const before = await this.pendingChecks.loadPair(fields.orderId);
    fields.phase = await this.#resolvePhase(fields, files, user, before);
    this.#validate(fields, files);
    if (
      fields.phase === 'combined' &&
      (!before['Мытищи'] ||
        !before['Балашиха'] ||
        before['Мытищи'].fields.noCargo === 'true' ||
        before['Балашиха'].fields.noCargo === 'true')
    )
      throw new Error('COMBINED_NOT_REQUIRED');
    const stage = fields.phase === 'combined' ? 'combined' : STAGE_BY_WAREHOUSE[user.warehouse];
    await this.pendingChecks.save({ fields, files, user });
    await this.history.upsert(fields, user, 'waiting');
    this.processQueue().catch((error) => console.error('Check queue failed:', error));
    return { queued: true, completed: false, stage, noCargo: fields.noCargo === 'true' };
  }

  /** @param {CheckFields} fields @param {CheckFile[]} files @param {CheckUser} user @param {any} before */
  async #resolvePhase(fields, files, user, before) {
    if (fields.phase) {
      if (!['warehouse', 'combined'].includes(fields.phase)) throw new Error('INVALID_CHECK_PHASE');
      return fields.phase;
    }
    const canBeLegacyCombined =
      user.warehouse === 'Балашиха' &&
      before['Мытищи']?.fields.noCargo !== 'true' &&
      before['Балашиха']?.fields.noCargo !== 'true' &&
      before['Мытищи'] &&
      before['Балашиха'] &&
      !before.combined;
    if (!canBeLegacyCombined) return 'warehouse';
    const duplicate = await this.pendingChecks.matches(
      fields.orderId,
      'balashikha',
      { ...fields, phase: 'warehouse' },
      files
    );
    return duplicate ? 'warehouse' : 'combined';
  }

  async processQueue() {
    if (this.queueRun) {
      this.queueRequested = true;
      return this.queueRun;
    }
    this.queueRun = (async () => {
      do {
        this.queueRequested = false;
        await this.#drain();
      } while (this.queueRequested);
    })().finally(() => {
      this.queueRun = null;
    });
    return this.queueRun;
  }

  async #drain() {
    const now = Date.now();
    /** @type {CheckJob[]} */
    const jobs = (await this.pendingChecks.listJobs()).filter(
      (/** @type {CheckJob} */ job) => !job.delivery.nextAttemptAt || Date.parse(job.delivery.nextAttemptAt) <= now
    );
    let index = 0;
    const worker = async () => {
      while (index < jobs.length) {
        const job = jobs[index++];
        await this.#run(job).catch(() => {});
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, jobs.length) }, worker));
  }

  /** @param {CheckJob} job */
  async #run(job) {
    const key = `${job.orderId}:${job.stage}`;
    if (this.processing.has(key)) return this.processing.get(key);
    const promise = this.#deliver(job).finally(() => this.processing.delete(key));
    this.processing.set(key, promise);
    return promise;
  }

  /** @param {CheckJob} job */
  async #deliver({ orderId, stage }) {
    const check = await this.pendingChecks.loadStage(orderId, stage);
    if (!check || check.delivery?.completed) return;
    const delivery = { bitrix: false, telegram: false, stageChanged: false, attempts: 0, ...(check.delivery || {}) };
    try {
      if (check.fields.noCargo === 'true') {
        await this.pendingChecks.updateDelivery(orderId, stage, { completed: true, skipped: true, error: null });
        await this.history.markCheckCompleted(orderId, check.user, check.fields.phase);
        return;
      }
      if (!delivery.bitrix) {
        if (stage === 'combined') {
          await this.bitrix.updateCombinedPhotos({ orderId, files: check.files });
          await this.bitrix.updateFinalPalletCount({
            orderId,
            euro: check.fields.euro,
            american: check.fields.american,
          });
        } else {
          await this.bitrix.updateWarehousePhotos({ orderId, warehouse: check.user.warehouse, files: check.files });
        }
        delivery.bitrix = true;
        await this.pendingChecks.updateDelivery(orderId, stage, { bitrix: true, error: null });
      }
      if (!delivery.telegram) {
        await this.telegram.sendCheck(this.#buildText(check.fields, check.user, stage), check.files);
        delivery.telegram = true;
        await this.pendingChecks.updateDelivery(orderId, stage, { telegram: true, error: null });
      }
      if (stage === 'combined' && !delivery.stageChanged) {
        await this.bitrix.moveToAcceptedVerification(orderId);
        delivery.stageChanged = true;
        await this.pendingChecks.updateDelivery(orderId, stage, { stageChanged: true, error: null });
      }
      await this.pendingChecks.updateDelivery(orderId, stage, { completed: true, error: null, nextAttemptAt: null });
      await this.history.markCheckCompleted(orderId, check.user, check.fields.phase);
    } catch (error) {
      const attempts = Number(delivery.attempts || 0) + 1;
      const delay = Math.min(15 * 60 * 1000, 15000 * 2 ** Math.min(attempts - 1, 6));
      await this.pendingChecks.updateDelivery(orderId, stage, {
        attempts,
        error: error instanceof Error ? error.message : String(error),
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
      });
      throw error;
    }
  }

  /** @param {CheckFields} fields @param {CheckFile[]} files */
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

  /** @param {CheckFields} fields @param {CheckUser} user @param {string} stage */
  #buildText(fields, user, stage) {
    const title = fields.orderTitle || fields.orderNumber;
    const lines =
      stage === 'combined'
        ? ['ОБЪЕДИНЁННЫЙ ГРУЗ', `Заказ: ${title}`, `Объединил: ${user.name}`]
        : [`Заказ: ${title}`, `Склад: ${user.warehouse}`, `Проверил: ${user.name}`];
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
