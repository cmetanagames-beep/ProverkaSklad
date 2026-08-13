const fs = require('fs/promises');
const path = require('path');

class TelegramClient {
  constructor({ token, chatId, settingsFile }) { this.token = token; this.chatId = chatId; this.settingsFile = settingsFile; }
  get configured() { return Boolean(this.token && this.chatId); }

  async init() {
    if (!this.settingsFile) return;
    try { const saved = JSON.parse(await fs.readFile(this.settingsFile, 'utf8')); if (saved.chatId) this.chatId = String(saved.chatId); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async listChats() {
    if (!this.token) throw new Error('TELEGRAM_NOT_CONFIGURED');
    const response = await fetch(`https://api.telegram.org/bot${this.token}/getUpdates`);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(`TELEGRAM: ${data.description || response.status}`);
    const chats = new Map();
    for (const update of data.result || []) {
      const message = update.message || update.channel_post;
      if (message?.chat && ['group','supergroup','channel'].includes(message.chat.type)) chats.set(String(message.chat.id), { id: String(message.chat.id), title: message.chat.title || 'Без названия', type: message.chat.type, current: String(message.chat.id) === String(this.chatId) });
    }
    return [...chats.values()];
  }

  async selectChat(chatId) {
    this.chatId = String(chatId);
    if (this.settingsFile) { await fs.mkdir(path.dirname(this.settingsFile), { recursive: true }); await fs.writeFile(this.settingsFile, JSON.stringify({ chatId: this.chatId, updatedAt: new Date().toISOString() })); }
    return this.#sendText('✅ AKFIX: эта группа выбрана для фотографий проверки склада.');
  }

  async sendCheck(text, files) {
    if (!this.configured) throw new Error('TELEGRAM_NOT_CONFIGURED');
    if (!files.length) return this.#sendText(text);
    const groups = Array.from({ length: Math.ceil(files.length / 10) }, (_, i) => files.slice(i * 10, i * 10 + 10));
    for (let i = 0; i < groups.length; i++) {
      const caption = i === 0 ? text : `Продолжение фотографий · ${i + 1}/${groups.length}`;
      await this.#sendAlbum(groups[i], caption);
    }
  }

  async #sendText(text) {
    const form = new FormData();
    form.set('chat_id', this.chatId);
    form.set('text', text);
    return this.#call('sendMessage', form);
  }

  async #sendAlbum(files, caption) {
    if (files.length === 1) {
      const form = new FormData();
      form.set('chat_id', this.chatId);
      form.set('caption', caption);
      form.set('photo', new Blob([files[0].buffer], { type: files[0].mime }), files[0].filename);
      return this.#call('sendPhoto', form);
    }
    const form = new FormData();
    const media = [];
    form.set('chat_id', this.chatId);
    files.forEach((file, index) => {
      const key = `photo_${index}`;
      form.set(key, new Blob([file.buffer], { type: file.mime }), file.filename);
      media.push({ type: 'photo', media: `attach://${key}`, ...(index === 0 ? { caption } : {}) });
    });
    form.set('media', JSON.stringify(media));
    return this.#call('sendMediaGroup', form);
  }

  async #call(method, form) {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: 'POST', body: form });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(`TELEGRAM: ${data.description || response.status}`);
    return data.result;
  }
}

module.exports = { TelegramClient };
