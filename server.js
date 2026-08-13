const http = require('http');
const config = require('./src/config');
const { Application } = require('./src/app');
const { SessionService } = require('./src/auth/session-service');
const { UserStore } = require('./src/auth/user-store');
const { BitrixClient } = require('./src/integrations/bitrix-client');
const { TelegramClient } = require('./src/integrations/telegram-client');
const { MultipartReader } = require('./src/uploads/multipart-reader');
const { CheckService } = require('./src/uploads/check-service');
const { PendingCheckStore } = require('./src/uploads/pending-check-store');
const { HistoryStore } = require('./src/uploads/history-store');

async function main() {
  const userStore = new UserStore(config.userStorageFile, config.users);
  await userStore.init();
  const sessions = new SessionService({ secret: config.sessionSecret, userStore });
  const bitrix = new BitrixClient(config.bitrixWebhookBase);
  const telegram = new TelegramClient({ token: config.telegramBotToken, chatId: config.telegramChatId, settingsFile: config.telegramSettingsFile });
  await telegram.init();
  const multipart = new MultipartReader();
  const pendingChecks = new PendingCheckStore(config.checkStorageDir);
  const history = new HistoryStore(config.historyStorageDir);
  const checks = new CheckService({ bitrix, telegram, pendingChecks, history });
  const app = new Application({ publicDir: config.publicDir, sessions, bitrix, multipart, checks, history, userStore });
  http.createServer((req, res) => app.handle(req, res))
    .listen(config.port, '0.0.0.0', () => console.log(`ProverkaSklad listening on 0.0.0.0:${config.port}`));
}

main().catch(error => { console.error(error); process.exit(1); });
