const toBitrixConfigFieldName = (code) => {
  const match = /^ufCrm(\d+)(.*)$/i.exec(String(code || ''));
  if (!match) return code;
  const suffix = match[2].replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLocaleUpperCase('en');
  return `UF_CRM_${match[1]}${suffix.startsWith('_') ? suffix : `_${suffix}`}`;
};

class BitrixClient {
  constructor(webhookBase) {
    this.webhookBase = webhookBase;
    this.acceptedVerificationStageId = null;
    this.driverShippedStageId = null;
    this.itemFields = null;
  }
  get configured() {
    return Boolean(this.webhookBase);
  }

  async call(method, payload, contentType = 'application/json') {
    if (!this.configured) throw new Error('BITRIX_NOT_CONFIGURED');
    const response = await fetch(`${this.webhookBase}/${method}.json`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: contentType === 'application/json' ? JSON.stringify(payload) : payload,
    });
    const data = await response.json();
    if (!response.ok || data.error)
      throw new Error(`BITRIX: ${data.error_description || data.error || response.status}`);
    return data.result;
  }

  async updateWarehousePhotos({ orderId, warehouse, files }) {
    if (!files.length) return;
    const photoFields = {
      Балашиха: 'ufCrm19_1752654317973',
      Мытищи: 'ufCrm19_1761641310794',
    };
    const field = photoFields[warehouse];
    if (!field) throw new Error(`UNKNOWN_WAREHOUSE: ${warehouse}`);
    await this.call('crm.item.update', {
      entityTypeId: 1052,
      id: Number(orderId),
      fields: {
        [field]: files.map((file) => [file.filename, file.buffer.toString('base64')]),
      },
    });
  }

  async updateCombinedPhotos({ orderId, files }) {
    if (!files.length) return;
    const field = process.env.BITRIX_COMBINED_PHOTOS_FIELD || 'ufCrm19_1786441124042';
    return this.call('crm.item.update', {
      entityTypeId: 1052,
      id: Number(orderId),
      fields: { [field]: files.map((file) => [file.filename, file.buffer.toString('base64')]) },
    });
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

  async getItem(orderId) {
    return this.call('crm.item.get', { entityTypeId: 1052, id: Number(orderId) });
  }

  async findItemByOrderNumber(orderNumber) {
    const rawReference = String(orderNumber || '').trim();
    const digits = rawReference.replace(/\D/g, '');
    if (!digits) throw new Error('BITRIX_ORDER_NUMBER_REQUIRED');
    const formattedReference = `АФУТ-${digits.padStart(6, '0')}`;
    const references = [...new Set([rawReference, formattedReference])];
    const definitionsResult = await this.getItemFields();
    const definitions = definitionsResult.fields || definitionsResult;
    const numberField = Object.entries(definitions).find(
      ([, definition]) =>
        String(definition.title || '')
          .trim()
          .toLocaleLowerCase('ru') === 'номер счета'
    )?.[0];
    for (const reference of references) {
      const normalizedReference = reference.toLocaleUpperCase('ru');
      const result = await this.call('crm.item.list', {
        entityTypeId: 1052,
        filter: numberField ? { [numberField]: reference } : { '%title': reference },
        select: ['id', 'title', ...(numberField ? [numberField] : [])],
        order: { id: 'DESC' },
      });
      const items = Array.isArray(result) ? result : result.items || [];
      const item = items.find((candidate) =>
        numberField
          ? String(candidate[numberField] || '')
              .trim()
              .toLocaleUpperCase('ru') === normalizedReference
          : String(candidate.title || '')
              .toLocaleUpperCase('ru')
              .includes(normalizedReference)
      );
      if (item?.id) return this.getItem(item.id);
    }
    throw new Error(`BITRIX_ORDER_NOT_FOUND: ${formattedReference}`);
  }

  async getItemFields() {
    if (!this.itemFields) this.itemFields = await this.call('crm.item.fields', { entityTypeId: 1052 });
    return this.itemFields;
  }

  async updateItem(orderId, fields) {
    return this.call('crm.item.update', { entityTypeId: 1052, id: Number(orderId), fields });
  }

  async completeDriverDelivery({ orderId, file }) {
    const photoField = 'ufCrm19ExpeditorReceipt';
    if (file)
      await this.call('crm.item.update', {
        entityTypeId: 1052,
        id: Number(orderId),
        fields: { [photoField]: [[file.filename, file.buffer.toString('base64')]] },
      });
    await this.moveToAcceptedVerification(orderId);
  }

  async ensureDeliveryFields() {
    const typeResult = await this.call('crm.type.getByEntityTypeId', { entityTypeId: 1052 });
    const type = typeResult.type || typeResult;
    if (!type?.id) throw new Error('BITRIX_SMART_PROCESS_NOT_FOUND: 1052');
    const entityId = `CRM_${type.id}`;
    const listResult = await this.call('userfieldconfig.list', {
      moduleId: 'crm',
      filter: { entityId },
    });
    const fields = Array.isArray(listResult) ? listResult : listResult.fields || [];
    const ensureField = async ({ title, postfix, userTypeId, multiple }) => {
      const fieldName = `UF_CRM_${type.id}_${postfix}`;
      let field = fields.find(
        (item) =>
          String(item.fieldName || item.FIELD_NAME || '').toLocaleUpperCase('ru') === fieldName ||
          String(item.editFormLabel?.ru || item.listColumnLabel?.ru || '')
            .trim()
            .toLocaleLowerCase('ru') === title.toLocaleLowerCase('ru')
      );
      let created = false;
      if (field) return { field, created };
      const added = await this.call('userfieldconfig.add', {
        moduleId: 'crm',
        field: {
          entityId,
          fieldName,
          userTypeId,
          multiple,
          mandatory: 'N',
          showInList: 'Y',
          editInList: 'Y',
          editFormLabel: { ru: title },
          listColumnLabel: { ru: title },
          listFilterLabel: { ru: title },
        },
      });
      field = added.field || added;
      created = true;
      fields.push(field);
      return { field, created };
    };
    const photo = await ensureField({
      title: 'Фото экспедиторской расписки',
      postfix: 'EXPEDITOR_RECEIPT',
      userTypeId: 'file',
      multiple: 'Y',
    });
    const company = await ensureField({
      title: 'Название транспортной компании',
      postfix: 'DELIVERY_COMPANY_NAME',
      userTypeId: 'string',
      multiple: 'N',
    });
    this.itemFields = null;
    const itemFieldsResult = await this.getItemFields();
    const itemFields = itemFieldsResult.fields || itemFieldsResult;
    const codeByTitle = (title) =>
      Object.entries(itemFields).find(
        ([, definition]) =>
          String(definition.title || definition.formLabel || '')
            .trim()
            .toLocaleLowerCase('ru') === title.toLocaleLowerCase('ru')
      )?.[0];
    const photoCode = codeByTitle('Фото экспедиторской расписки');
    const companyCode = codeByTitle('Название транспортной компании');
    const trackCode = codeByTitle('Трек номер');
    const termsCode = codeByTitle('Условия доставки');
    if (!photoCode || !companyCode || !trackCode || !termsCode) throw new Error('BITRIX_DELIVERY_FIELD_CODE_NOT_FOUND');
    const configNameByTitle = (title, fallback) =>
      fields.find(
        (field) =>
          String(field.editFormLabel?.ru || field.listColumnLabel?.ru || '')
            .trim()
            .toLocaleLowerCase('ru') === title.toLocaleLowerCase('ru')
      )?.fieldName || toBitrixConfigFieldName(fallback);
    const photoConfigName = configNameByTitle('Фото экспедиторской расписки', photoCode);
    const companyConfigName = configNameByTitle('Название транспортной компании', companyCode);
    const trackConfigName = configNameByTitle('Трек номер', trackCode);
    const termsConfigName = configNameByTitle('Условия доставки', termsCode);

    const extras = { categoryId: 31 };
    const configuration = await this.call('crm.item.details.configuration.get', {
      entityTypeId: 1052,
      scope: 'C',
      extras,
    });
    if (!Array.isArray(configuration)) throw new Error('BITRIX_COMMON_CARD_CONFIGURATION_NOT_FOUND');
    const targetCodes = new Set([photoCode, companyCode, photoConfigName, companyConfigName]);
    const data = configuration.map((section) => ({
      ...section,
      elements: (section.elements || []).filter((element) => !targetCodes.has(element.name)),
    }));
    const insertAfter = (anchor, fieldCode) => {
      for (const section of data) {
        const index = section.elements.findIndex((element) => element.name === anchor);
        if (index < 0) continue;
        section.elements.splice(index + 1, 0, { name: fieldCode, optionFlags: 1 });
        return true;
      }
      return false;
    };
    if (!insertAfter(trackConfigName, photoConfigName) || !insertAfter(termsConfigName, companyConfigName))
      throw new Error('BITRIX_CARD_ANCHOR_NOT_FOUND');
    await this.call('crm.item.details.configuration.set', {
      entityTypeId: 1052,
      scope: 'C',
      extras,
      data,
    });
    return {
      entityId,
      photo: { created: photo.created, fieldId: String(photo.field.id || ''), fieldCode: photoCode },
      company: { created: company.created, fieldId: String(company.field.id || ''), fieldCode: companyCode },
      layoutUpdated: true,
    };
  }

  async moveToDriverShipped(orderId) {
    if (!this.driverShippedStageId) {
      this.driverShippedStageId = String(process.env.BITRIX_DRIVER_SHIPPED_STAGE_ID || 'DT1052_31:SUCCESS').trim();
      if (!this.driverShippedStageId) {
        const stages = await this.call('crm.status.list', { filter: { ENTITY_ID: 'DYNAMIC_1052_STAGE_31' } });
        const target = stages.find((stage) => /^груз\s+отправлен(?:\s+\d+)?$/i.test(String(stage.NAME || '').trim()));
        if (!target) throw new Error('BITRIX_STAGE_NOT_FOUND: Груз отправлен');
        this.driverShippedStageId = target.STATUS_ID;
      }
    }
    return this.call('crm.item.update', {
      entityTypeId: 1052,
      id: Number(orderId),
      fields: { stageId: this.driverShippedStageId },
    });
  }

  async resetDriverDelivery(orderId) {
    const stages = await this.call('crm.status.list', { filter: { ENTITY_ID: 'DYNAMIC_1052_STAGE_31' } });
    const target = stages.find((stage) => /^передан\s+на\s+сборку$/i.test(String(stage.NAME || '').trim()));
    if (!target) throw new Error('BITRIX_STAGE_NOT_FOUND: Передан на сборку');
    return this.call('crm.item.update', {
      entityTypeId: 1052,
      id: Number(orderId),
      fields: { stageId: target.STATUS_ID, ufCrm19ExpeditorReceipt: [] },
    });
  }

  async deleteComment({ orderId, commentId }) {
    return this.call('crm.timeline.comment.delete', {
      id: Number(commentId),
      ownerTypeId: 1052,
      ownerId: Number(orderId),
    });
  }

  async clearWarehousePhotos({ orderId, warehouse }) {
    const photoFields = {
      Балашиха: 'ufCrm19_1752654317973',
      Мытищи: 'ufCrm19_1761641310794',
    };
    const field = photoFields[warehouse];
    if (!field) throw new Error(`UNKNOWN_WAREHOUSE: ${warehouse}`);
    return this.call('crm.item.update', {
      entityTypeId: 1052,
      id: Number(orderId),
      fields: { [field]: [] },
    });
  }

  async clearCombinedPhotos(orderId) {
    const field = process.env.BITRIX_COMBINED_PHOTOS_FIELD || 'ufCrm19_1786441124042';
    return this.call('crm.item.update', {
      entityTypeId: 1052,
      id: Number(orderId),
      fields: { [field]: [] },
    });
  }

  async moveToAcceptedVerification(orderId) {
    if (!this.acceptedVerificationStageId) {
      const stages = await this.call('crm.status.list', { filter: { ENTITY_ID: 'DYNAMIC_1052_STAGE_31' } });
      const target = stages.find((stage) => /^принято на проверку$/i.test(String(stage.NAME || '').trim()));
      if (!target) throw new Error('BITRIX_STAGE_NOT_FOUND: Принято на проверку');
      this.acceptedVerificationStageId = target.STATUS_ID;
    }
    return this.call('crm.item.update', {
      entityTypeId: 1052,
      id: Number(orderId),
      fields: { stageId: this.acceptedVerificationStageId },
    });
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
