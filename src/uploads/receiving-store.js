const fs = require('fs/promises');
const path = require('path');

class ReceivingStore {
  constructor(file) { this.file = path.resolve(file); this.items = {}; this.writeLock = Promise.resolve(); }
  async init() { try { this.items = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; this.items = {}; } }
  get(login) { return this.items[login] || null; }
  async save(login, payload) {
    const products = (Array.isArray(payload.products) ? payload.products : []).slice(0, 5000).map(item => ({ article: String(item?.article || '').slice(0, 100), name: String(item?.name || '').slice(0, 500), plan: Math.max(0, Number(item?.plan || 0)), pack: String(item?.pack || '').slice(0, 100) }));
    const sourceRows = Array.isArray(payload.rows) ? payload.rows : [];
    const rows = products.map((_, index) => ({ done: Boolean(sourceRows[index]?.done), alloc: (Array.isArray(sourceRows[index]?.alloc) ? sourceRows[index].alloc : []).slice(0, 100).map(item => ({ qty: Math.max(0, Number(item?.qty || 0)), expiry: String(item?.expiry || '').slice(0, 7), cell: String(item?.cell || '').slice(0, 100), comment: String(item?.comment || '').slice(0, 1000) })) }));
    const value = { fileName: String(payload.fileName || '').slice(0, 255), products, rows, updatedAt: new Date().toISOString() };
    this.items[login] = value; await this.#save(); return value;
  }
  async clear(login) { delete this.items[login]; await this.#save(); }
  #save() { this.writeLock = this.writeLock.then(async () => { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(this.file, JSON.stringify(this.items, null, 2)); }); return this.writeLock; }
}

module.exports = { ReceivingStore };
