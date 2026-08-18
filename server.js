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
const { ShippingSheetClient } = require('./src/integrations/shipping-sheet-client');
const { DriverDeliveryStore } = require('./src/uploads/driver-delivery-store');
const { ReceivingStore } = require('./src/uploads/receiving-store');

async function main() {
  const userStore = new UserStore(config.userStorageFile, config.users);
  await userStore.init();
  const sessions = new SessionService({ secret: config.sessionSecret, userStore });
  const bitrix = new BitrixClient(config.bitrixWebhookBase);
  const telegram = new TelegramClient({ token: config.telegramBotToken, chatId: config.telegramPhotoChatId || config.telegramChatId, settingsFile: config.telegramSettingsFile, preferConfiguredChat: true, confirmationText: '✅ AKFIX: группа выбрана для фотографий и результатов проверки склада.' });
  await telegram.init();
  const telegramExpeditor = new TelegramClient({ token: config.telegramExpeditorBotToken, chatId: config.telegramExpeditorChatId, settingsFile: config.telegramExpeditorSettingsFile, confirmationText: '✅ AKFIX: группа выбрана для экспедиторских расписок водителей.' });
  await telegramExpeditor.init();
  const multipart = new MultipartReader();
  const pendingChecks = new PendingCheckStore(config.checkStorageDir);
  const history = new HistoryStore(config.historyStorageDir);
  const shippingSheet = new ShippingSheetClient({ spreadsheetId: config.shippingSpreadsheetId, sheetName: config.shippingSheetName });
  const driverDeliveries = new DriverDeliveryStore(config.driverStorageFile, config.driverPhotoDir);
  await driverDeliveries.init();
  const receiving = new ReceivingStore(config.receivingStorageFile);
  await receiving.init();
  const checks = new CheckService({ bitrix, telegram, pendingChecks, history });
  const app = new Application({ publicDir: config.publicDir, receivingTestDir: config.receivingTestDir, sessions, bitrix, multipart, checks, history, userStore, shippingSheet, driverDeliveries, telegramExpeditor, receiving });
  http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    app.handle(req, res);
  })
    .listen(config.port, '0.0.0.0', () => console.log(`ProverkaSklad listening on 0.0.0.0:${config.port}`));
}

main().catch(error => { console.error(error); process.exit(1); });
