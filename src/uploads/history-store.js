const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

class HistoryStore {
  constructor(rootDir) { this.rootDir = path.resolve(rootDir); this.locks = new Map(); }

  async upsert(fields, user, status = 'waiting') {
    return this.#locked(user.login, async () => {
      const rows = await this.list(user.login);
      const id = `${fields.orderId}:${user.warehouse}`;
      const row = {
        id, orderId: String(fields.orderId), orderNumber: fields.orderNumber,
        orderTitle: fields.orderTitle || fields.orderNumber, warehouse: user.warehouse,
        employee: user.name, noCargo: fields.noCargo === 'true', euro: Number(fields.euro || 0),
        american: Number(fields.american || 0), palletTotal: Number(fields.euro || 0) + Number(fields.american || 0),
        status, createdAt: new Date().toISOString(),
      };
      const index = rows.findIndex(item => item.id === id);
      if (index >= 0) rows[index] = row; else rows.unshift(row);
      await this.#write(user.login, rows.slice(0, 300));
      return row;
    });
  }

  async markOrderCompleted(orderId, users) {
    await Promise.all(users.map(user => this.#locked(user.login, async () => {
      const rows = await this.list(user.login);
      const row = rows.find(item => item.orderId === String(orderId) && item.warehouse === user.warehouse);
      if (row) { row.status = 'completed'; row.completedAt = new Date().toISOString(); await this.#write(user.login, rows); }
    })));
  }

  async list(login) {
    try { return JSON.parse(await fs.readFile(this.#file(login), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }

  async #write(login, rows) {
    await fs.mkdir(this.rootDir, { recursive: true });
    const file = this.#file(login), temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(rows));
    await fs.rename(temp, file);
  }

  #file(login) { return path.join(this.rootDir, `${crypto.createHash('sha256').update(String(login)).digest('hex')}.json`); }
  #locked(login, action) {
    const previous = this.locks.get(login) || Promise.resolve();
    const current = previous.then(action, action).finally(() => { if (this.locks.get(login) === current) this.locks.delete(login); });
    this.locks.set(login, current); return current;
  }
}

module.exports = { HistoryStore };
