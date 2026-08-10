class BitrixClient {
  constructor(webhookBase) { this.webhookBase = webhookBase; }
  get configured() { return Boolean(this.webhookBase); }

  async call(method, payload, contentType = 'application/json') {
    if (!this.configured) throw new Error('BITRIX_NOT_CONFIGURED');
    const response = await fetch(`${this.webhookBase}/${method}.json`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: contentType === 'application/json' ? JSON.stringify(payload) : payload,
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(`BITRIX: ${data.error_description || data.error || response.status}`);
    return data.result;
  }

  async addCheckComment({ orderId, text, files }) {
    const batches = files.length ? Array.from({ length: Math.ceil(files.length / 10) }, (_, i) => files.slice(i * 10, i * 10 + 10)) : [[]];
    for (let i = 0; i < batches.length; i++) {
      await this.call('crm.timeline.comment.add', { fields: {
        ENTITY_ID: Number(orderId),
        ENTITY_TYPE: 'dynamic_1052',
        COMMENT: i === 0 ? text : `Продолжение фотографий ${i + 1}/${batches.length}`,
        FILES: batches[i].map(file => [file.filename, file.buffer.toString('base64')]),
      }});
    }
  }

  async proxy(method, body, contentType) {
    if (!/^[a-z0-9._-]+\.json$/i.test(method)) throw new Error('INVALID_METHOD');
    if (!this.configured) throw new Error('BITRIX_NOT_CONFIGURED');
    return fetch(`${this.webhookBase}/${method}`, { method: 'POST', headers: { 'Content-Type': contentType }, body });
  }
}

module.exports = { BitrixClient };

