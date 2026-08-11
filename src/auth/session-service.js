const crypto = require('crypto');

class SessionService {
  constructor({ secret, userStore, ttlMs = 30 * 24 * 60 * 60 * 1000 }) {
    if (!secret) throw new Error('SESSION_SECRET is required');
    if (!userStore) throw new Error('User store is required');
    this.secret = secret;
    this.userStore = userStore;
    this.ttlMs = ttlMs;
  }

  authenticate(login, pin) {
    const normalized = String(login || '').trim().toLowerCase();
    const suppliedHash = this.#hash(String(pin || ''));
    const user = this.userStore.findByLogin(normalized);
    return user &&
      crypto.timingSafeEqual(Buffer.from(this.#hash(String(user.pin))), Buffer.from(suppliedHash))
      ? user : null;
  }

  createCookie(user) {
    const value = Buffer.from(JSON.stringify({ login: user.login, exp: Date.now() + this.ttlMs })).toString('base64url');
    return `akfix_session=${value}.${this.#sign(value)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.floor(this.ttlMs / 1000)}`;
  }

  clearCookie() {
    return 'akfix_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
  }

  userFromRequest(req) {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('akfix_session='))?.slice(14);
    if (!token) return null;
    const [value, signature] = token.split('.');
    const expected = this.#sign(value || '');
    if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
      const data = JSON.parse(Buffer.from(value, 'base64url').toString());
      return data.exp > Date.now() ? this.userStore.findByLogin(data.login) : null;
    } catch { return null; }
  }

  publicUser(user) {
    return { login: user.login, name: user.name, warehouse: user.warehouse || null, role: user.role || 'employee' };
  }


  #hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
  #sign(value) { return crypto.createHmac('sha256', this.secret).update(value).digest('base64url'); }
}

module.exports = { SessionService };
