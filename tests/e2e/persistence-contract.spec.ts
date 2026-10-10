import { expect, test, type Page } from '@playwright/test';
import { openTimeline } from '@/shared/testing/stream-browser';

async function incidentBucket(page: Page, replacement?: unknown) {
  return page.evaluate(
    (replacement) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const request = indexedDB.open('incident-room-fictional-incidents-v1', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(
            'incidents',
            replacement === undefined ? 'readonly' : 'readwrite',
          );
          const store = tx.objectStore('incidents');
          const action =
            replacement === undefined
              ? store.get('singleton')
              : store.put(replacement, 'singleton');
          let data: Record<string, unknown>;
          action.onsuccess = () => {
            data = replacement === undefined ? action.result : replacement;
          };
          tx.oncomplete = () => {
            db.close();
            resolve(data);
          };
          tx.onabort = () => {
            db.close();
            reject(new Error('Fixture transaction failed'));
          };
        };
      }),
    replacement,
  );
}
async function request(page: Page, path: string, body?: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const client = document.cookie
        .split('; ')
        .find((value) => value.startsWith('ir_fictional_client='))!
        .split('=')[1]!;
      const response = await fetch('/mock-api' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'x-fictional-client': client },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() };
    },
    { path, body },
  );
}

test('native authority stores retain singleton records, reject conflicting transactions and reopen after reload', async ({
  page,
}) => {
  await openTimeline(page);
  const requestId = await page.evaluate(() => crypto.randomUUID());
  const input = {
    title: 'Fictional transaction regression',
    description: 'Independently authored persistence exercise.',
    severity: 'P2',
    serviceIds: ['aurora-edge'],
    participantIds: ['demo-sage'],
  };
  const created = await request(page, '/incidents', { input, requestId });
  expect(created.status).toBe(200);
  const before = await incidentBucket(page);
  const conflicting = await request(page, '/incidents', {
    input: { ...input, title: 'Conflicting title' },
    requestId,
  });
  expect(conflicting.status).toBe(409);
  const after = await incidentBucket(page);
  expect(after.incidents).toEqual(before.incidents);
  expect(after.receipts).toEqual(before.receipts);
  expect(after.nextNumber).toBe(before.nextNumber);
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const reopened = await request(page, '/incidents/' + created.data.number);
  expect(reopened.status).toBe(200);
  expect(reopened.data).toEqual(created.data);
  const replay = await request(page, '/incidents', { input, requestId });
  expect(replay.status).toBe(200);
  expect(replay.data.id).toBe(created.data.id);

  // Validation must reject existing corrupt storage, never silently reseed or write over it.
  const saved = await incidentBucket(page);
  await incidentBucket(page, { ...saved, nextNumber: 'corrupt fixture' });
  const invalid = await request(page, '/incidents/' + created.data.number);
  expect(invalid.status).toBe(400);
  expect((await incidentBucket(page)).nextNumber).toBe('corrupt fixture');
  await incidentBucket(page, saved);
  const recovered = await request(page, '/incidents/' + created.data.number);
  expect(recovered.status).toBe(200);
  expect(recovered.data.id).toBe(created.data.id);
});
