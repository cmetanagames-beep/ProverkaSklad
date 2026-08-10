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

  async updateWarehousePhotos({ orderId, warehouse, files }) {
    if (!files.length) return;
    const photoFields = {
      'Балашиха': 'ufCrm19_1752654317973',
      'Мытищи': 'ufCrm19_1761641310794',
    };
    const field = photoFields[warehouse];
    if (!field) throw new Error(`UNKNOWN_WAREHOUSE: ${warehouse}`);
    await this.call('crm.item.update', {
      entityTypeId: 1052,
      id: Number(orderId),
      fields: {
        [field]: files.map(file => [file.filename, file.buffer.toString('base64')]),
      },
    });
  }

  async proxy(method, body, contentType) {
    if (!/^[a-z0-9._-]+\.json$/i.test(method)) throw new Error('INVALID_METHOD');
    if (!this.configured) throw new Error('BITRIX_NOT_CONFIGURED');
    return fetch(`${this.webhookBase}/${method}`, { method: 'POST', headers: { 'Content-Type': contentType }, body });
  }
}

module.exports = { BitrixClient };

