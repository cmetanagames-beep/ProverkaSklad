const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const WAREHOUSE_KEYS = { 'Мытищи': 'mytishchi', 'Балашиха': 'balashikha' };

class PendingCheckStore {
  constructor(rootDir) { this.rootDir = path.resolve(rootDir); }

  async save({ fields, files, user }) {
    const orderId = this.#orderId(fields.orderId);
    const warehouseKey = this.#warehouseKey(user.warehouse);
    const orderDir = path.join(this.rootDir, orderId);
    const finalDir = path.join(orderDir, warehouseKey);
    const tempDir = path.join(orderDir, `.${warehouseKey}-${crypto.randomUUID()}`);
    await fs.mkdir(tempDir, { recursive: true });
    const storedFiles = [];
    try {
      for (let index = 0; index < files.length; index++) {
        const diskName = `${String(index + 1).padStart(3, '0')}.bin`;
        await fs.writeFile(path.join(tempDir, diskName), files[index].buffer);
        storedFiles.push({ diskName, filename: files[index].filename, mime: files[index].mime });
      }
      await fs.writeFile(path.join(tempDir, 'check.json'), JSON.stringify({ fields, user: { login: user.login, name: user.name, warehouse: user.warehouse }, files: storedFiles, savedAt: new Date().toISOString() }));
      await fs.mkdir(orderDir, { recursive: true });
      await fs.rm(finalDir, { recursive: true, force: true });
      await fs.rename(tempDir, finalDir);
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw error;
    }
  }

  async load(orderId, warehouse) {
    const folder = path.join(this.rootDir, this.#orderId(orderId), this.#warehouseKey(warehouse));
    try {
      const record = JSON.parse(await fs.readFile(path.join(folder, 'check.json'), 'utf8'));
      record.files = await Promise.all(record.files.map(async file => ({ ...file, buffer: await fs.readFile(path.join(folder, file.diskName)) })));
      return record;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async loadPair(orderId) {
    const [mytishchi, balashikha] = await Promise.all([this.load(orderId, 'Мытищи'), this.load(orderId, 'Балашиха')]);
    return { 'Мытищи': mytishchi, 'Балашиха': balashikha };
  }

  async listPending() {
    try {
      const entries = await fs.readdir(this.rootDir, { withFileTypes: true });
      const rows = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
        const pair = await this.loadPair(entry.name);
        const checks = Object.values(pair).filter(Boolean);
        if (!checks.length || checks.length === 2) continue;
        const check = checks[0];
        const waitingFor = pair['Мытищи'] ? 'Балашиха' : 'Мытищи';
        rows.push({ orderId: entry.name, orderNumber: check.fields.orderNumber, orderTitle: check.fields.orderTitle || check.fields.orderNumber, completedWarehouse: check.user.warehouse, employee: check.user.name, waitingFor, savedAt: check.savedAt });
      }
      return rows.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }

  async clear(orderId) { await fs.rm(path.join(this.rootDir, this.#orderId(orderId)), { recursive: true, force: true }); }

  #orderId(value) { const id = String(value || ''); if (!/^\d+$/.test(id)) throw new Error('INVALID_ORDER_ID'); return id; }
  #warehouseKey(warehouse) { const key = WAREHOUSE_KEYS[warehouse]; if (!key) throw new Error('UNKNOWN_WAREHOUSE'); return key; }
}

module.exports = { PendingCheckStore };
