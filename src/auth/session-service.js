const crypto = require('crypto');

class SessionService {
  constructor({ secret, users, ttlMs = 12 * 60 * 60 * 1000 }) {
    if (!secret) throw new Error('SESSION_SECRET is required');
    if (!users.length) throw new Error('APP_USERS_JSON must contain at least one user');
    this.secret = secret;
    this.users = users;
    this.ttlMs = ttlMs;
  }

  authenticate(login, pin) {
    const normalized = String(login || '').trim().toLowerCase();
    const suppliedHash = this.#hash(String(pin || ''));
    return this.users.find(user =>
      String(user.login).toLowerCase() === normalized &&
      crypto.timingSafeEqual(Buffer.from(this.#hash(String(user.pin))), Buffer.from(suppliedHash))
    ) || null;
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
      return data.exp > Date.now() ? this.users.find(user => user.login === data.login) || null : null;
    } catch { return null; }
  }

  publicUser(user) {
    return { login: user.login, name: user.name, warehouse: user.warehouse || null, role: user.role || 'employee' };
  }

  #hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
  #sign(value) { return crypto.createHmac('sha256', this.secret).update(value).digest('base64url'); }
}

module.exports = { SessionService };
