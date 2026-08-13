Exit code: 0
Wall time: 0.9 seconds
Output:
class BitrixClient {
  constructor(webhookBase) { this.webhookBase = webhookBase; this.acceptedVerificationStageId = null; }
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

  async updateCombinedPhotos({ orderId, files }) {
    if (!files.length) return;
    const field = process.env.BITRIX_COMBINED_PHOTOS_FIELD || 'ufCrm19_1786441124042';
    return this.call('crm.item.update', { entityTypeId: 1052, id: Number(orderId), fields: { [field]: files.map(file => [file.filename, file.buffer.toString('base64')]) } });
  }

  async updateFinalPalletCount({ orderId, euro, american }) {
    const field = process.env.BITRIX_PALLET_COUNT_FIELD || 'ufCrm19_1752654651418';
    const euroCount = Number(euro || 0);
    const americanCount = Number(american || 0);
    const value = `Европалеты: ${euroCount}; Американские палеты: ${americanCount}; Всего: ${euroCount + americanCount}`;
    return this.call('crm.item.update', {
      entityTypeId: 1052,
      id: Number(orderId),
      fields: { [field]: value },
    });
  }

  async listComments(orderId) {
    return this.call('crm.timeline.comment.list', {
      filter: { ENTITY_ID: Number(orderId), ENTITY_TYPE: 'dynamic_1052' },
      select: ['ID', 'CREATED', 'AUTHOR_ID', 'COMMENT', 'FILES'],
      order: { ID: 'DESC' },
    });
  }

  async deleteComment({ orderId, commentId }) {
    return this.call('crm.timeline.comment.delete', {
      id: Number(commentId), ownerTypeId: 1052, ownerId: Number(orderId),
    });
  }

  async clearWarehousePhotos({ orderId, warehouse }) {
    const photoFields = {
      'Балашиха': 'ufCrm19_1752654317973',
      'Мытищи': 'ufCrm19_1761641310794',
    };
    const field = photoFields[warehouse];
    if (!field) throw new Error(`UNKNOWN_WAREHOUSE: ${warehouse}`);
    return this.call('crm.item.update', {
      entityTypeId: 1052, id: Number(orderId), fields: { [field]: [] },
    });
  }

  async clearCombinedPhotos(orderId) {
    const field = process.env.BITRIX_COMBINED_PHOTOS_FIELD || 'ufCrm19_1786441124042';
    return this.call('crm.item.update', {
      entityTypeId: 1052, id: Number(orderId), fields: { [field]: [] },
    });
  }

  async moveToAcceptedVerification(orderId) {
    if (!this.acceptedVerificationStageId) {
      const stages = await this.call('crm.status.list', { filter: { ENTITY_ID: 'DYNAMIC_1052_STAGE_31' } });
      const target = stages.find(stage => /^принято на проверку$/i.test(String(stage.NAME || '').trim()));
      if (!target) throw new Error('BITRIX_STAGE_NOT_FOUND: Принято на проверку');
      this.acceptedVerificationStageId = target.STATUS_ID;
    }
    return this.call('crm.item.update', { entityTypeId: 1052, id: Number(orderId), fields: { stageId: this.acceptedVerificationStageId } });
  }

  async proxy(method, body, contentType) {
    if (!/^[a-z0-9._-]+\.json$/i.test(method)) throw new Error('INVALID_METHOD');
    const allowed = new Set(['crm.status.list.json', 'crm.item.list.json', 'crm.item.fields.json']);
    if (!allowed.has(method)) throw new Error('METHOD_NOT_ALLOWED');
    if (!this.configured) throw new Error('BITRIX_NOT_CONFIGURED');
    return fetch(`${this.webhookBase}/${method}`, { method: 'POST', headers: { 'Content-Type': contentType }, body });
  }
}

module.exports = { BitrixClient };

