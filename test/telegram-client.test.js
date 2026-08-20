// @ts-check

const test = require('node:test');
const assert = require('node:assert/strict');
const { TelegramClient } = require('../src/integrations/telegram-client');

test('listChats keeps the selected group visible when Telegram updates are empty', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  /** @type {string[]} */
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/getUpdates')) return new globalThis.Response(JSON.stringify({ ok: true, result: [] }));
    return new globalThis.Response(
      JSON.stringify({ ok: true, result: { id: -100123, title: 'Экспедиторские расписки', type: 'supergroup' } })
    );
  };

  const client = new TelegramClient({ token: 'test-token', chatId: '-100123', settingsFile: undefined });
  const chats = await client.listChats();

  assert.deepEqual(chats, [{ id: '-100123', title: 'Экспедиторские расписки', type: 'supergroup', current: true }]);
  assert.match(calls[1], /getChat\?chat_id=-100123$/);
});

test('listChats still returns new groups if the selected group is no longer accessible', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = async (url) => {
    if (String(url).endsWith('/getUpdates')) {
      return new globalThis.Response(
        JSON.stringify({
          ok: true,
          result: [{ message: { chat: { id: -200, title: 'Новая группа', type: 'group' } } }],
        })
      );
    }
    throw new Error('network error');
  };

  const client = new TelegramClient({ token: 'test-token', chatId: '-100123', settingsFile: undefined });
  assert.deepEqual(await client.listChats(), [{ id: '-200', title: 'Новая группа', type: 'group', current: false }]);
});
