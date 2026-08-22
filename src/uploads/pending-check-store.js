const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const WAREHOUSE_KEYS = { Мытищи: 'mytishchi', Балашиха: 'balashikha' };
const STAGE_WAREHOUSES = { mytishchi: 'Мытищи', balashikha: 'Балашиха', combined: 'Объединённый груз' };

class PendingCheckStore {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
  }

  async save({ fields, files, user }) {
    const orderId = this.#orderId(fields.orderId);
    const warehouseKey = fields.phase === 'combined' ? 'combined' : this.#warehouseKey(user.warehouse);
    const orderDir = path.join(this.rootDir, orderId);
    const finalDir = path.join(orderDir, warehouseKey);
    const tempDir = path.join(orderDir, `.${warehouseKey}-${crypto.randomUUID()}`);
    const fingerprint = this.#fingerprint(fields, files);
    const current = await this.#readRecord(finalDir).catch(() => null);
    if (current?.fingerprint === fingerprint) return current;
    await fs.mkdir(tempDir, { recursive: true });
    const storedFiles = [];
    try {
      for (let index = 0; index < files.length; index++) {
        const diskName = `${String(index + 1).padStart(3, '0')}.bin`;
        await fs.writeFile(path.join(tempDir, diskName), files[index].buffer);
        storedFiles.push({ diskName, filename: files[index].filename, mime: files[index].mime });
      }
      const record = {
        fields,
        user: { login: user.login, name: user.name, warehouse: user.warehouse },
        files: storedFiles,
        fingerprint,
        savedAt: new Date().toISOString(),
        delivery: { bitrix: false, telegram: false, stageChanged: false, completed: false, attempts: 0 },
      };
      await fs.writeFile(path.join(tempDir, 'check.json'), JSON.stringify(record));
      await fs.mkdir(orderDir, { recursive: true });
      await fs.rm(finalDir, { recursive: true, force: true });
      await fs.rename(tempDir, finalDir);
      return record;
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  async load(orderId, warehouse) {
    const folder = path.join(this.rootDir, this.#orderId(orderId), this.#warehouseKey(warehouse));
    try {
      const record = JSON.parse(await fs.readFile(path.join(folder, 'check.json'), 'utf8'));
      record.files = await Promise.all(
        record.files.map(async (file) => ({ ...file, buffer: await fs.readFile(path.join(folder, file.diskName)) }))
      );
      return record;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async loadStage(orderId, stage) {
    const folder = path.join(this.rootDir, this.#orderId(orderId), this.#stageKey(stage));
    try {
      const record = await this.#readRecord(folder);
      record.files = await Promise.all(
        record.files.map(async (file) => ({ ...file, buffer: await fs.readFile(path.join(folder, file.diskName)) }))
      );
      return record;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async loadMetadata(orderId, stage) {
    const folder = path.join(this.rootDir, this.#orderId(orderId), this.#stageKey(stage));
    try {
      return await this.#readRecord(folder);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async matches(orderId, stage, fields, files) {
    const current = await this.loadMetadata(orderId, stage);
    return Boolean(current?.fingerprint && current.fingerprint === this.#fingerprint(fields, files));
  }

  async loadPair(orderId) {
    const [mytishchi, balashikha, combined] = await Promise.all([
      this.load(orderId, 'Мытищи'),
      this.load(orderId, 'Балашиха'),
      this.loadCombined(orderId),
    ]);
    return { Мытищи: mytishchi, Балашиха: balashikha, combined };
  }

  async loadCombined(orderId) {
    return this.loadStage(orderId, 'combined');
  }

  async updateDelivery(orderId, stage, patch) {
    const folder = path.join(this.rootDir, this.#orderId(orderId), this.#stageKey(stage));
    const record = await this.#readRecord(folder);
    record.delivery = { ...(record.delivery || {}), ...patch, updatedAt: new Date().toISOString() };
    const target = path.join(folder, 'check.json');
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(record));
    await fs.rename(temp, target);
    return record.delivery;
  }

  async listJobs() {
    try {
      const orders = await fs.readdir(this.rootDir, { withFileTypes: true });
      const jobs = [];
      for (const order of orders) {
        if (!order.isDirectory() || !/^\d+$/.test(order.name)) continue;
        const stages = Object.keys(STAGE_WAREHOUSES);
        const records = Object.fromEntries(
          await Promise.all(stages.map(async (stage) => [stage, await this.loadMetadata(order.name, stage)]))
        );
        // A combined result created by the previous application version may already
        // have been sent as one indivisible operation. Replaying it automatically
        // could duplicate Telegram albums, so only new durable jobs are resumed.
        const legacyCombined = records.combined && !records.combined.delivery;
        for (const [stage, record] of Object.entries(records)) {
          if (!record || record.delivery?.completed || (!record.delivery && legacyCombined)) continue;
          jobs.push({ orderId: order.name, stage, savedAt: record.savedAt, delivery: record.delivery || {} });
        }
      }
      return jobs.sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async status(orderId) {
    const [mytishchi, balashikha, combined] = await Promise.all([
      this.loadMetadata(orderId, 'mytishchi'),
      this.loadMetadata(orderId, 'balashikha'),
      this.loadMetadata(orderId, 'combined'),
    ]);
    const pair = { Мытищи: mytishchi, Балашиха: balashikha, combined };
    const summary = (check) =>
      check
        ? {
            completed: true,
            noCargo: check.fields.noCargo === 'true',
            employee: check.user.name,
            warehouse: check.user.warehouse,
            savedAt: check.savedAt,
            photos: check.files.length,
            euro: Number(check.fields.euro || 0),
            american: Number(check.fields.american || 0),
            delivery: check.delivery || {},
          }
        : { completed: false, photos: 0, delivery: {} };
    const requiresCombined = Boolean(
      pair['Мытищи'] &&
      pair['Балашиха'] &&
      pair['Мытищи'].fields.noCargo !== 'true' &&
      pair['Балашиха'].fields.noCargo !== 'true'
    );
    return {
      mytishchi: summary(pair['Мытищи']),
      balashikha: summary(pair['Балашиха']),
      combined: summary(pair.combined),
      requiresCombined,
    };
  }

  async listPending() {
    try {
      const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
      const rows = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
        const [mytishchi, balashikha, combined] = await Promise.all([
          this.loadMetadata(entry.name, 'mytishchi'),
          this.loadMetadata(entry.name, 'balashikha'),
          this.loadMetadata(entry.name, 'combined'),
        ]);
        const row = this.#pendingRow(entry.name, mytishchi, balashikha, combined);
        if (row) rows.push(row);
      }
      return rows.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async clear(orderId) {
    await fs.rm(path.join(this.rootDir, this.#orderId(orderId)), { recursive: true, force: true });
  }

  #orderId(value) {
    const id = String(value || '');
    if (!/^\d+$/.test(id)) throw new Error('INVALID_ORDER_ID');
    return id;
  }
  #warehouseKey(warehouse) {
    const key = WAREHOUSE_KEYS[warehouse];
    if (!key) throw new Error('UNKNOWN_WAREHOUSE');
    return key;
  }
  #stageKey(value) {
    const key = WAREHOUSE_KEYS[value] || String(value || '');
    if (!STAGE_WAREHOUSES[key]) throw new Error('UNKNOWN_CHECK_STAGE');
    return key;
  }
  #readRecord(folder) {
    return fs.readFile(path.join(folder, 'check.json'), 'utf8').then(JSON.parse);
  }
  #fingerprint(fields, files) {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(fields));
    for (const file of files) hash.update(file.buffer);
    return hash.digest('hex');
  }

  #pendingRow(orderId, mytishchi, balashikha, combined) {
    const warehouseChecks = [mytishchi, balashikha].filter(Boolean);
    if (!warehouseChecks.length) return null;
    const check = warehouseChecks[0];
    const requiresCombined =
      warehouseChecks.length === 2 &&
      mytishchi.fields.noCargo !== 'true' &&
      balashikha.fields.noCargo !== 'true' &&
      !combined;
    const checks = [...warehouseChecks, combined].filter(Boolean);
    const failed = checks.find((item) => item.delivery?.error);
    const uploading = !(combined && !combined.delivery) && checks.some((item) => !item.delivery?.completed);
    const waitingFor = requiresCombined
      ? 'Объединение на Балашихе'
      : failed
        ? 'Повторная отправка'
        : uploading
          ? 'Отправка в Bitrix24 и Telegram'
          : 'Выгружено';
    return {
      orderId,
      orderNumber: check.fields.orderNumber,
      orderTitle: check.fields.orderTitle || check.fields.orderNumber,
      completedWarehouse: warehouseChecks.map((item) => item.user.warehouse).join(' + '),
      employee: warehouseChecks.map((item) => item.user.name).join(', '),
      mytishchiReady: Boolean(mytishchi),
      balashikhaReady: Boolean(balashikha),
      waitingFor,
      requiresCombined,
      uploading,
      failed: Boolean(failed),
      delivered: !uploading && !requiresCombined,
      savedAt: check.savedAt,
    };
  }
}

module.exports = { PendingCheckStore };
