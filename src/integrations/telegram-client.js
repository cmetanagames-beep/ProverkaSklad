class TelegramClient {
  constructor({ token, chatId }) { this.token = token; this.chatId = chatId; }
  get configured() { return Boolean(this.token && this.chatId); }

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

