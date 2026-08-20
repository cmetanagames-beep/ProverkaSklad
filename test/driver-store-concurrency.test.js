// @ts-check
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { DriverDeliveryStore } = require('../src/uploads/driver-delivery-store');

test('parallel driver completions leave one valid durable registry', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'akfix-driver-store-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'deliveries.json');
  const store = new DriverDeliveryStore(file, path.join(root, 'photos'));
  await store.init();
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      store.complete({
        login: `driver-${index % 3}`,
        orderId: `order-${index}`,
        completedAt: new Date().toISOString(),
      })
    )
  );
  const disk = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(Object.keys(disk).length, 12);
  const restarted = new DriverDeliveryStore(file, path.join(root, 'photos'));
  await restarted.init();
  assert.equal(restarted.listAll().length, 12);
  assert.deepEqual(
    (await fs.readdir(root)).filter((name) => name.endsWith('.tmp')),
    []
  );
});
