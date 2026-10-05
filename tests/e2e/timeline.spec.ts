import { expect, test, type Page } from '@playwright/test';
import { generateTimeline } from '@/features/timeline/fixtures';
import type { AuthorityData } from '@/features/timeline/authority';
import type { LocalData } from '@/features/timeline/local-work';

const incidentId = 'fictional-incident-2841';
const authorityKey = JSON.stringify(['demo-orbit', incidentId]);
const localKey = JSON.stringify(['demo-river', 'demo-orbit']);
async function room(page: Page, email = 'river.vale@example.test', number = 'INC-2841') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Fictional-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
  await page.goto(`/app/incidents/${number}`);
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
  await expect(page.locator('[data-entry-id]').first()).toBeVisible();
  if (number === 'INC-2841')
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
}
async function database<T>(page: Page, name: string, key: string, value?: T): Promise<T> {
  return page.evaluate(
    ({ name, key, value }) =>
      new Promise<T>((resolve, reject) => {
        const open = indexedDB.open(name, 1);
        open.onupgradeneeded = () => open.result.createObjectStore('records');
        open.onerror = () => reject(new Error('Fixture database unavailable'));
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction(
            'records',
            value === undefined ? 'readonly' : 'readwrite',
          );
          const store = transaction.objectStore('records');
          const request = value === undefined ? store.get(key) : store.put(value, key);
          let result: T;
          request.onsuccess = () => {
            result = (value === undefined ? request.result : value) as T;
          };
          transaction.oncomplete = () => {
            db.close();
            resolve(result);
          };
          transaction.onabort = () => {
            db.close();
            reject(new Error('Fixture transaction failed'));
          };
        };
      }),
    { name, key, value },
  );
}
async function fault(page: Page, mode: AuthorityData['fault']) {
  const data = await database<AuthorityData>(
    page,
    'incident-room-fictional-timeline-v1',
    authorityKey,
  );
  data.fault = mode;
  await database(page, 'incident-room-fictional-timeline-v1', authorityKey, data);
}
const rows = (page: Page) =>
  page.getByRole('list', { name: 'Timeline entries', exact: true }).getByRole('listitem');
async function send(page: Page, text: string) {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
}

test('history prepend preserves an actual reading anchor within 8px and DOM stays bounded', async ({
  page,
}) => {
  await room(page);
  const viewport = page.getByLabel('Timeline viewport', { exact: true });
  await viewport.evaluate((element) => {
    element.scrollTop = 400;
  });
  const anchor = await viewport.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const row = [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].find(
      (item) => item.getBoundingClientRect().top >= top + 40,
    )!;
    return { id: row.dataset.entryId!, offset: row.getBoundingClientRect().top - top };
  });
  await page.getByRole('button', { name: 'Load older history', exact: true }).click();
  await expect
    .poll(async () =>
      page
        .locator(`[data-entry-id="${anchor.id}"]`)
        .evaluate(
          (element) =>
            element.getBoundingClientRect().top -
            element.closest('.timeline-viewport')!.getBoundingClientRect().top,
        ),
    )
    .toBeGreaterThan(anchor.offset - 8);
  const after = await page
    .locator(`[data-entry-id="${anchor.id}"]`)
    .evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        element.closest('.timeline-viewport')!.getBoundingClientRect().top,
    );
  expect(Math.abs(after - anchor.offset)).toBeLessThanOrEqual(8);
  expect(await rows(page).count()).toBeLessThan(80);
});
test('measured growth above a historical anchor compensates geometry without dragging the reader', async ({
  page,
}) => {
  await room(page);
  const viewport = page.getByLabel('Timeline viewport', { exact: true });
  await viewport.evaluate((element) => {
    element.scrollTop = 800;
  });
  const anchor = await viewport.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const row = [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].find(
      (item) => item.getBoundingClientRect().top >= top + 50,
    )!;
    return { id: row.dataset.entryId!, offset: row.getBoundingClientRect().top - top };
  });
  await viewport.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const above = [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].find(
      (item) => item.getBoundingClientRect().bottom < top,
    )!;
    const expansion = document.createElement('p');
    expansion.textContent = 'Fictional asynchronous content expansion. '.repeat(30);
    above.append(expansion);
  });
  await expect
    .poll(async () =>
      Math.abs(
        (await page
          .locator(`[data-entry-id="${anchor.id}"]`)
          .evaluate(
            (element) =>
              element.getBoundingClientRect().top -
              element.closest('.timeline-viewport')!.getBoundingClientRect().top,
          )) - anchor.offset,
      ),
    )
    .toBeLessThanOrEqual(8);
});

test('optimistic send confirms exactly one logical row with stable identity and no lost draft', async ({
  page,
}) => {
  await room(page);
  const fixture = await database<AuthorityData>(
    page,
    'incident-room-fictional-timeline-v1',
    authorityKey,
  );
  fixture.responseDelayMs = 1000;
  await database(page, 'incident-room-fictional-timeline-v1', authorityKey, fixture);
  const text = 'Fictional confirmation once';
  await send(page, text);
  await expect(page.locator('[data-row-key^="local:"]').filter({ hasText: text })).toContainText(
    'Sending',
  );
  const optimisticKey = await page
    .locator('[data-row-key^="local:"]')
    .filter({ hasText: text })
    .getAttribute('data-row-key');
  await expect(page.getByText(text, { exact: true })).toHaveCount(1);
  await expect(page.locator('[data-row-key^="local:"]').filter({ hasText: text })).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (await database<LocalData>(page, 'incident-room-local-work-v1', localKey)).outbox.length,
    )
    .toBe(0);
  await expect(page.locator('[data-row-key^="local:"]').filter({ hasText: text })).toHaveAttribute(
    'data-row-key',
    optimisticKey!,
  );
  const data = await database<AuthorityData>(
    page,
    'incident-room-fictional-timeline-v1',
    authorityKey,
  );
  expect(
    data.entries.filter((entry) => entry.type === 'human_message' && entry.body === text),
  ).toHaveLength(1);
});

test('deterministic rejected Send retains failed body; explicit Retry uses the same mutation ID', async ({
  page,
}) => {
  await room(page);
  await fault(page, 'reject-once');
  await send(page, 'Fictional retry');
  await expect(page.getByRole('button', { name: 'Retry message', exact: true })).toBeEnabled();
  const pending = (await database<LocalData>(page, 'incident-room-local-work-v1', localKey))
    .outbox[0]!;
  await page.getByRole('button', { name: 'Retry message', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry message', exact: true })).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await database<LocalData>(page, 'incident-room-local-work-v1', localKey)).outbox.length,
    )
    .toBe(0);
  const data = await database<AuthorityData>(
    page,
    'incident-room-fictional-timeline-v1',
    authorityKey,
  );
  const created = data.entries.filter(
    (entry) =>
      entry.type === 'human_message' &&
      entry.originatingClientMutationId === pending.clientMutationId,
  );
  expect(created).toHaveLength(1);
  expect(await rows(page).filter({ hasText: 'Fictional retry' }).count()).toBe(1);
});

test('ambiguous outcome after authority persistence is checked and never resent', async ({
  page,
}) => {
  await room(page);
  await fault(page, 'ambiguous-once');
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/timeline') && request.method() === 'POST')
      requests.push(request.url());
  });
  await send(page, 'Fictional ambiguity found');
  await expect
    .poll(
      async () =>
        (await database<LocalData>(page, 'incident-room-local-work-v1', localKey)).outbox.length,
    )
    .toBe(0);
  expect(requests).toHaveLength(1);
  const data = await database<AuthorityData>(
    page,
    'incident-room-fictional-timeline-v1',
    authorityKey,
  );
  expect(
    data.entries.filter(
      (entry) => entry.type === 'human_message' && entry.body === 'Fictional ambiguity found',
    ),
  ).toHaveLength(1);
  await expect(page.getByText('Fictional ambiguity found', { exact: true })).toHaveCount(1);
});

test('draft and failed/unknown outbox survive reload; restoration checks before explicit same-ID Retry', async ({
  page,
}) => {
  await room(page);
  await fault(page, 'reject-once');
  await send(page, 'Fictional restored failure');
  await expect(page.getByRole('button', { name: 'Retry message', exact: true })).toBeEnabled();
  const data = await database<LocalData>(page, 'incident-room-local-work-v1', localKey);
  const id = data.outbox[0]!.clientMutationId;
  data.outbox[0]!.state = 'unknown';
  data.outbox[0]!.retryAllowed = false;
  await database(page, 'incident-room-local-work-v1', localKey, data);
  await page.getByLabel('Message', { exact: true }).fill('Fictional durable draft');
  await expect
    .poll(
      async () =>
        (await database<LocalData>(page, 'incident-room-local-work-v1', localKey)).drafts[
          incidentId
        ],
    )
    .toBe('Fictional durable draft');
  let posts = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/timeline') && request.method() === 'POST') posts++;
  });
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Fictional durable draft');
  await expect(page.getByRole('button', { name: 'Retry message', exact: true })).toBeEnabled();
  expect(posts).toBe(0);
  expect(
    (await database<LocalData>(page, 'incident-room-local-work-v1', localKey)).outbox[0]!
      .clientMutationId,
  ).toBe(id);
  await page.getByRole('button', { name: 'Retry message', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await database<LocalData>(page, 'incident-room-local-work-v1', localKey)).outbox.length,
    )
    .toBe(0);
  expect(posts).toBe(1);
});

test('old deep link uses a bounded target window, highlights tombstone and preserves URL', async ({
  page,
}) => {
  await room(page);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'GET' && request.url().includes('/timeline'))
      requests.push(request.url());
  });
  const id = `${incidentId}:evt-20`;
  const url = `/app/incidents/INC-2841?event=${encodeURIComponent(id)}&tracking=keep#context`;
  await page.goto(url);
  await expect(page.locator('.timeline-target')).toContainText('Navigation target');
  await expect(page.locator('.timeline-target')).toContainText('Deleted entry');
  await expect(page).toHaveURL(url);
  expect(requests.some((url) => url.includes('/locate?'))).toBe(true);
  expect(requests.filter((url) => url.includes('cursor=')).length).toBeLessThanOrEqual(2);
  expect(await rows(page).count()).toBeLessThan(80);
});

test('rapid URL target replacement supersedes navigation; missing target has no silent latest fallback', async ({
  page,
}) => {
  await room(page);
  const fixture = await database<AuthorityData>(
    page,
    'incident-room-fictional-timeline-v1',
    authorityKey,
  );
  fixture.locateDelayMs = 1000;
  await database(page, 'incident-room-fictional-timeline-v1', authorityKey, fixture);
  const oldRequest = page.waitForRequest(
    (request) =>
      request.url().includes('/locate?') && decodeURIComponent(request.url()).includes('evt-10'),
  );
  await page.evaluate(
    (id) => history.pushState(null, '', `?event=${encodeURIComponent(id)}`),
    `${incidentId}:evt-10`,
  );
  await oldRequest;
  await page.evaluate(
    (id) => history.pushState(null, '', `?event=${encodeURIComponent(id)}`),
    `${incidentId}:evt-100`,
  );
  await expect(page.locator('.timeline-target')).toHaveAttribute(
    'data-entry-id',
    `${incidentId}:evt-100`,
  );
  await page.evaluate(() => history.pushState(null, '', '?event=missing-event'));
  await expect(
    page.getByRole('status').filter({ hasText: 'Timeline target missing.' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/event=missing-event/);
  await expect(page.getByRole('button', { name: 'Go to latest', exact: true })).toBeEnabled();
});

test('10,000 server entries and target navigation keep a bounded real browser DOM; responsive compose stays usable', async ({
  page,
}) => {
  await room(page);
  const data = await database<AuthorityData>(
    page,
    'incident-room-fictional-timeline-v1',
    authorityKey,
  );
  data.entries = generateTimeline(incidentId, 10000);
  data.nextOrder = 10001;
  await database(page, 'incident-room-fictional-timeline-v1', authorityKey, data);
  await page.reload();
  await expect(page.locator(`[data-entry-id="${incidentId}:evt-10000"]`)).toBeAttached();
  expect(await rows(page).count()).toBeLessThan(80);
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await rows(page).count()).toBeLessThan(80);
  }
  await send(page, 'Fictional mobile compose');
  await expect(page.getByText('Fictional mobile compose', { exact: true })).toHaveCount(1);
});

test('nonparticipant and resolved Timeline are readable but cannot compose', async ({ page }) => {
  await room(page, 'sage.linden@example.test', 'INC-2843');
  await expect(page.getByRole('note')).toContainText('Read-only Timeline');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
  await page.goto('/app/incidents/INC-2845');
  await expect(page.getByRole('note')).toContainText('Resolved');
  await expect(page.getByRole('list', { name: 'Timeline entries', exact: true })).toBeVisible();
  await expect(page.getByLabel('Message', { exact: true })).toHaveCount(0);
});

test('logout clears identity drafts/outbox and another user cannot restore them', async ({
  page,
}) => {
  await room(page);
  await fault(page, 'reject-once');
  await send(page, 'Private fictional local work');
  await expect(page.getByRole('button', { name: 'Retry message', exact: true })).toBeEnabled();
  await page.getByLabel('Message', { exact: true }).fill('Private fictional draft');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  const data = await database<LocalData>(page, 'incident-room-local-work-v1', localKey);
  expect(data.outbox).toHaveLength(0);
  expect(data.drafts).toEqual({});
  await room(page, 'sage.linden@example.test');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  await expect(page.getByText('Private fictional local work', { exact: true })).toHaveCount(0);
});
