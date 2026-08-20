const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

class DriverDeliveryStore {
  constructor(file, photoDir) { this.file = path.resolve(file); this.photoDir = path.resolve(photoDir || path.join(path.dirname(file), 'driver-photos')); this.items = {}; this.writeLock = Promise.resolve(); }
  async init() { try { this.items = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; this.items = {}; } }
  get(login, orderId) { return this.items[`${login}:${orderId}`] || null; }
  list(login) { return Object.values(this.items).filter(item => !item._assignment && item.login === login); }
  listAll() { return Object.values(this.items).filter(item => !item._assignment).sort((a,b) => String(b.completedAt).localeCompare(String(a.completedAt))); }
  assignedDriver(orderId, fallback) { return this.items[`assignment:${orderId}`]?.driver || fallback; }
  async assign(orderId, driver, user) {
    const value = { _assignment: true, orderId: String(orderId), driver: String(driver || '').trim(), changedAt: new Date().toISOString(), changedBy: user.name };
    this.items[`assignment:${orderId}`] = value; await this.#save(); return value;
  }
  bitrixOverride(orderId) { return this.items[`bitrix:${orderId}`]?.fields || {}; }
  async saveBitrixOverride(orderId, fields, user) {
    const value = { _assignment: true, _bitrixOverride: true, orderId: String(orderId), fields, changedAt: new Date().toISOString(), changedBy: user.name };
    this.items[`bitrix:${orderId}`] = value; await this.#save(); return value;
  }
  async complete(item) { this.items[`${item.login}:${item.orderId}`] = item; await this.#save(); return item; }
  async reset(login, orderId) {
    const key = `${login}:${orderId}`;
    const item = this.items[key];
    if (!item) return null;
    delete this.items[key];
    await this.#save();
    if (item.photo?.id) await fs.unlink(path.join(this.photoDir, item.photo.id)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return item;
  }
  async savePhoto(file) {
    if (!file?.buffer) return null;
    await fs.mkdir(this.photoDir, { recursive: true });
    const extension = file.mime === 'image/png' ? '.png' : file.mime === 'image/webp' ? '.webp' : '.jpg';
    const id = `${crypto.randomUUID()}${extension}`;
    await fs.writeFile(path.join(this.photoDir, id), file.buffer);
    return { id, mime: file.mime || 'image/jpeg', filename: file.filename || `expeditor${extension}` };
  }
  async photo(id) {
    if (!/^[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(String(id || ''))) return null;
    try { return await fs.readFile(path.join(this.photoDir, id)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async review(key, changes, user) {
    const current = this.items[key];
    if (!current) throw new Error('DELIVERY_NOT_FOUND');
    const allowed = ['deliveryCompany','deliveryAddress','recipient','recipientPhone','documents','logistComment'];
    const corrections = {};
    for (const field of allowed) if (Object.hasOwn(changes, field)) corrections[field] = String(changes[field] || '').trim().slice(0, 1000);
    const review = { status: changes.status === 'needs_correction' ? 'needs_correction' : 'approved', corrections, reviewedAt: new Date().toISOString(), reviewedBy: user.name };
    this.items[key] = { ...current, review };
    await this.#save();
    return this.items[key];
  }
  #save() { this.writeLock = this.writeLock.then(async () => { await fs.mkdir(path.dirname(this.file), { recursive: true }); const temp = `${this.file}.${crypto.randomUUID()}.tmp`; await fs.writeFile(temp, JSON.stringify(this.items, null, 2)); await fs.rename(temp, this.file); }); return this.writeLock; }
}
module.exports = { DriverDeliveryStore };
