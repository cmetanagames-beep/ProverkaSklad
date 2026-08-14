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
  receivingTestDir: path.resolve(__dirname, '..', 'receiving-test'),
  bitrixWebhookBase: String(process.env.BITRIX_WEBHOOK_BASE || '').replace(/\/+$/, ''),
  telegramBotToken: String(process.env.TELEGRAM_BOT_TOKEN || ''),
  telegramChatId: String(process.env.TELEGRAM_CHAT_ID || ''),
  telegramPhotoChatId: String(process.env.TELEGRAM_PHOTO_CHAT_ID || '-1002084123169'),
  telegramSettingsFile: path.resolve(process.env.TELEGRAM_SETTINGS_FILE || path.join(__dirname, '..', 'data', 'telegram.json')),
  sessionSecret: String(process.env.SESSION_SECRET || ''),
  checkStorageDir: path.resolve(process.env.CHECK_STORAGE_DIR || path.join(__dirname, '..', 'data', 'checks')),
  historyStorageDir: path.resolve(process.env.HISTORY_STORAGE_DIR || path.join(__dirname, '..', 'data', 'history')),
  userStorageFile: path.resolve(process.env.USER_STORAGE_FILE || path.join(__dirname, '..', 'data', 'users.json')),
  users: parseUsers(process.env.APP_USERS_JSON),
};
