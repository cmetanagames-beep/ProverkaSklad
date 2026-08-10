const path = require('path');

function parseUsers(raw) {
  if (!raw) return [];
  const users = JSON.parse(raw);
  if (!Array.isArray(users)) throw new Error('APP_USERS_JSON must be a JSON array');
  return users
    .map(user => ({ ...user, role: user.role || 'employee' }))
    .filter(({ login, pin, name, warehouse, role }) =>
      login && pin && name && (role === 'admin' || Boolean(warehouse))
    );
}

module.exports = {
  port: Number(process.env.PORT || 8787),
  publicDir: path.resolve(__dirname, '..', 'public'),
  bitrixWebhookBase: String(process.env.BITRIX_WEBHOOK_BASE || '').replace(/\/+$/, ''),
  telegramBotToken: String(process.env.TELEGRAM_BOT_TOKEN || ''),
  telegramChatId: String(process.env.TELEGRAM_CHAT_ID || ''),
  sessionSecret: String(process.env.SESSION_SECRET || ''),
  users: parseUsers(process.env.APP_USERS_JSON),
};
