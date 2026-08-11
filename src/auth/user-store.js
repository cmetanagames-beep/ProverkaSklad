const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

class UserStore {
  constructor(file, seedUsers = []) { this.file = path.resolve(file); this.seedUsers = seedUsers; this.users = []; this.writeLock = Promise.resolve(); }

  async init() {
    try {
      const saved = await fs.readFile(this.file, 'utf8');
      this.users = saved.trim() ? JSON.parse(saved) : [];
      if (!this.users.length && this.seedUsers.length) {
        this.users = this.#seed();
        await this.#save();
      }
    }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.users = this.#seed();
      await this.#save();
    }
  }

  #seed() { return this.seedUsers.map(user => ({ id: crypto.randomUUID(), ...user, login: (user.role || 'employee') === 'employee' ? user.name : user.login })); }

  findByLogin(login) { const value=String(login||'').trim().toLocaleLowerCase('ru');return this.users.find(user=>String(user.login).trim().toLocaleLowerCase('ru')===value)||null; }
  listEmployees() { return this.users.filter(user => (user.role || 'employee') === 'employee').map(this.#public); }

  async createEmployee(input) {
    const user = this.#validate({ ...input, role: 'employee' }, true);
    if (this.findByLogin(user.login)) throw new Error('LOGIN_ALREADY_EXISTS');
    const created = { id: crypto.randomUUID(), ...user };
    this.users.push(created); await this.#save(); return this.#public(created);
  }

  async updateEmployee(id, input) {
    const index = this.users.findIndex(user => user.id === id && (user.role || 'employee') === 'employee');
    if (index < 0) throw new Error('EMPLOYEE_NOT_FOUND');
    const current = this.users[index];
    const next = this.#validate({ ...current, ...input, pin: input.pin || current.pin, role: 'employee' }, false);
    const duplicate = this.users.find(user => user.id !== id && String(user.login).toLocaleLowerCase('ru') === next.login.toLocaleLowerCase('ru'));
    if (duplicate) throw new Error('LOGIN_ALREADY_EXISTS');
    this.users[index] = { ...current, ...next, id: current.id }; await this.#save(); return this.#public(this.users[index]);
  }

  #validate(input, pinRequired) {
    const login=String(input.login||'').trim(),name=String(input.name||'').trim(),warehouse=String(input.warehouse||'').trim(),pin=String(input.pin||'').trim();
    if (!login || login.length > 60 || !name || name.length > 100) throw new Error('INVALID_EMPLOYEE');
    if (!['Мытищи','Балашиха'].includes(warehouse)) throw new Error('INVALID_WAREHOUSE');
    if ((pinRequired || input.pin) && !/^\d{4,12}$/.test(pin)) throw new Error('INVALID_PIN');
    return { login, name, warehouse, pin, role: 'employee' };
  }

  #public(user) { return { id:user.id,login:user.login,name:user.name,warehouse:user.warehouse,role:user.role||'employee' }; }
  #save() { this.writeLock=this.writeLock.then(async()=>{await fs.mkdir(path.dirname(this.file),{recursive:true});const temp=`${this.file}.${crypto.randomUUID()}.tmp`;await fs.writeFile(temp,JSON.stringify(this.users));await fs.rename(temp,this.file)});return this.writeLock; }
}

module.exports = { UserStore };
