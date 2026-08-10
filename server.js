const http = require('http');
const config = require('./src/config');
const { Application } = require('./src/app');
const { SessionService } = require('./src/auth/session-service');
const { BitrixClient } = require('./src/integrations/bitrix-client');
const { TelegramClient } = require('./src/integrations/telegram-client');
const { MultipartReader } = require('./src/uploads/multipart-reader');
const { CheckService } = require('./src/uploads/check-service');

const sessions = new SessionService({ secret: config.sessionSecret, users: config.users });
const bitrix = new BitrixClient(config.bitrixWebhookBase);
const telegram = new TelegramClient({ token: config.telegramBotToken, chatId: config.telegramChatId });
const multipart = new MultipartReader();
const checks = new CheckService({ bitrix, telegram });
const app = new Application({ publicDir: config.publicDir, sessions, bitrix, multipart, checks });

http.createServer((req, res) => app.handle(req, res))
  .listen(config.port, '0.0.0.0', () => console.log(`ProverkaSklad listening on 0.0.0.0:${config.port}`));

