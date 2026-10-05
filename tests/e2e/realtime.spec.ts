import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { AuthorityData } from '@/features/timeline/authority';
import type { TimelineEntry } from '@/entities/timeline/model';

const incidentId = 'fictional-incident-2841';
const roomKey = JSON.stringify(['demo-orbit', incidentId]);
const connection = (page: Page) => page.getByLabel('Realtime connection', { exact: true });
const row = (page: Page, body: string) => page.locator('[data-entry-id]').filter({ hasText: body });
async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Fictional-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
  const incidentLink = page.getByRole('link', { name: /^INC-2841 ·/ });
  const items = page.getByRole('list', { name: 'Incidents', exact: true }).locator(':scope > li');
  for (let pageIndex = 0; pageIndex < 3 && (await incidentLink.count()) === 0; pageIndex++) {
    const loaded = await items.count();
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect.poll(() => items.count()).toBeGreaterThan(loaded);
  }
  await incidentLink.click();
  await expect(connection(page)).toHaveText('Connected');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
}
async function pair(context: BrowserContext, a: Page) {
  await login(a, 'river.vale@example.test');
  // Two independent application clients share only fictional-server origin storage.
  // Adapter A already captured its lease; B obtains its own auth correlation handle.
  await context.clearCookies();
  const b = await context.newPage();
  await login(b, 'sage.linden@example.test');
  return b;
}
async function source(page: Page, update?: { delay?: number; corrections?: TimelineEntry[] }) {
  return page.evaluate(
    ({ key, update }) =>
      new Promise<AuthorityData>((resolve, reject) => {
        const open = indexedDB.open('incident-room-fictional-timeline-v1', 1);
        open.onerror = () => reject(new Error('Fixture unavailable'));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('records', 'readwrite');
          const store = tx.objectStore('records');
          const get = store.get(key);
          let data: AuthorityData;
          get.onsuccess = () => {
            data = get.result;
            if (update?.delay !== undefined) data.responseDelayMs = update.delay;
            for (const entry of update?.corrections ?? []) {
              const index = data.entries.findIndex((value) => value.id === entry.id);
              if (index >= 0 && data.entries[index]!.revision < entry.revision)
                data.entries[index] = entry;
              data.changes.push({
                kind: entry.tombstone ? 'timeline_tombstoned' : 'timeline_updated',
                entry,
              });
            }
            store.put(data, key);
          };
          tx.oncomplete = () => {
            db.close();
            resolve(data);
          };
          tx.onabort = () => {
            db.close();
            reject(new Error('Fixture write failed'));
          };
        };
      }),
    { key: roomKey, update },
  );
}
async function controls(
  page: Page,
  input: {
    failure?: boolean;
    duplicate?: boolean;
    reverse?: boolean;
    drop?: boolean;
    malformed?: boolean;
  },
) {
  await page.evaluate(
    (input) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('incident-room-fictional-journal-v1', 1);
        open.onerror = () => reject(new Error('Fixture unavailable'));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('records', 'readwrite');
          const store = tx.objectStore('records');
          const get = store.get('demo-orbit');
          get.onsuccess = () => {
            const data = get.result;
            data.controls[sessionStorage.getItem('ir_realtime_client')!] = input;
            store.put(data, 'demo-orbit');
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(new Error('Fixture write failed'));
          };
        };
      }),
    input,
  );
}
async function send(page: Page, body: string) {
  await page.getByLabel('Message', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
}
async function hint(page: Page, online: boolean) {
  await page.evaluate(
    (online) => window.dispatchEvent(new Event(online ? 'online' : 'offline')),
    online,
  );
}

test('A live message converges to independent B without reload, with compact accessible presence', async ({
  context,
  page,
}) => {
  const b = await pair(context, page);
  await expect(page.getByLabel('Incident presence')).toContainText('2 people viewing');
  await page.getByLabel('Incident presence').locator('summary').click();
  await expect(page.getByLabel('Incident presence')).toContainText('Sage Linden');
  await send(page, 'Fictional live mitigation reached both clients');
  await expect(row(b, 'Fictional live mitigation reached both clients')).toHaveCount(1);
  await expect(connection(b)).toHaveText('Connected');
  // Exercise an actual document reload separately from ordinary list-to-room navigation.
  await b.reload();
  await expect(connection(b)).toHaveText('Connected');
  await expect(row(b, 'Fictional live mitigation reached both clients')).toHaveCount(1);
  await expect
    .poll(() => b.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});
test('disconnect preserves history/draft; online recovery resyncs missed events once before Connected', async ({
  context,
  page,
}) => {
  const b = await pair(context, page);
  await b.getByLabel('Message', { exact: true }).fill('Fictional draft remains offline');
  await hint(b, false);
  await expect(connection(b)).toHaveText('Offline');
  await expect(b.locator('[data-entry-id]').first()).toBeVisible();
  await send(page, 'Fictional activity while B disconnected');
  await expect(row(page, 'Fictional activity while B disconnected')).toHaveCount(1);
  await expect(row(b, 'Fictional activity while B disconnected')).toHaveCount(0);
  await hint(b, true);
  await expect(connection(b)).toHaveText('Connected');
  await expect(row(b, 'Fictional activity while B disconnected')).toHaveCount(1);
  await expect(b.getByLabel('Message', { exact: true })).toHaveValue(
    'Fictional draft remains offline',
  );
});
test('duplicate/reversed/malformed delivery converges to newest correction and tombstone without browser errors', async ({
  context,
  page,
}) => {
  const b = await pair(context, page);
  const errors: string[] = [];
  b.on('pageerror', (error) => errors.push(error.message));
  await controls(b, { duplicate: true, reverse: true, malformed: true });
  await send(page, 'Fictional source before correction');
  await expect(row(b, 'Fictional source before correction')).toHaveCount(1);
  const original = (await source(page)).entries.find(
    (entry) =>
      entry.type === 'human_message' && entry.body === 'Fictional source before correction',
  )!;
  if (original.type !== 'human_message') throw new Error('Missing fictional message');
  const newer = { ...original, revision: 5, body: 'Fictional corrected source wins' };
  await source(page, { corrections: [newer, { ...original, revision: 4 }] });
  await expect(row(b, 'Fictional corrected source wins')).toHaveCount(1);
  const deleted = {
    ...newer,
    revision: 7,
    tombstone: { deletedAt: original.createdAt, reason: 'Fictional server tombstone' },
  };
  await source(page, { corrections: [deleted, { ...newer, revision: 6 }] });
  const tombstone = b.locator(`[data-entry-id="${original.id}"]`);
  await expect(tombstone).toContainText('Deleted entry');
  await expect(tombstone).not.toContainText(newer.body);
  expect(errors).toEqual([]);
});
test('immediate realtime echo confirms one optimistic row before delayed HTTP acknowledgment', async ({
  page,
}) => {
  await login(page, 'river.vale@example.test');
  await source(page, { delay: 5000 });
  let httpDone = false;
  const response = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/timeline'),
  );
  void response.then(() => {
    httpDone = true;
  });
  await send(page, 'Fictional realtime echo beats HTTP');
  await expect(row(page, 'Fictional realtime echo beats HTTP')).toHaveCount(1);
  expect(httpDone).toBe(false);
  const confirmedKey = await row(page, 'Fictional realtime echo beats HTTP').getAttribute(
    'data-row-key',
  );
  await response;
  await expect(row(page, 'Fictional realtime echo beats HTTP')).toHaveCount(1);
  await expect(row(page, 'Fictional realtime echo beats HTTP')).toHaveAttribute(
    'data-row-key',
    confirmedKey!,
  );
});
test('old reader stays anchored, counts only logical arrivals and New updates returns to newest', async ({
  context,
  page,
}) => {
  const b = await pair(context, page);
  const viewport = b.getByLabel('Timeline viewport', { exact: true });
  await viewport.evaluate((element) => {
    element.scrollTop = 600;
  });
  // Native scroll fires before the virtual range's next React commit. Capture an
  // actually visible row, never an old overscan node far below the viewport.
  await expect
    .poll(() =>
      viewport.evaluate((element) => {
        const frame = element.getBoundingClientRect();
        return [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].some((node) => {
          const box = node.getBoundingClientRect();
          return box.top >= frame.top + 30 && box.top < frame.bottom - 30;
        });
      }),
    )
    .toBe(true);
  const anchor = await viewport.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const top = frame.top;
    const node = [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].find(
      (node) =>
        node.getBoundingClientRect().top >= top + 30 &&
        node.getBoundingClientRect().top < frame.bottom - 30,
    )!;
    return { id: node.dataset.entryId!, offset: node.getBoundingClientRect().top - top };
  });
  await controls(b, { duplicate: true, reverse: true });
  await send(page, 'Fictional newest activity for older reader');
  await expect(b.getByRole('button', { name: 'New updates (1)', exact: true })).toBeVisible();
  const offset = await b
    .locator(`[data-entry-id="${anchor.id}"]`)
    .evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        element.closest('.timeline-viewport')!.getBoundingClientRect().top,
    );
  expect(Math.abs(offset - anchor.offset)).toBeLessThanOrEqual(8);
  await b.getByRole('button', { name: 'New updates (1)', exact: true }).click();
  await expect(row(b, 'Fictional newest activity for older reader')).toBeVisible();
  await expect(b.getByRole('button', { name: /New updates/ })).toHaveCount(0);
});
test('transport failure displays Reconnecting while retaining content and recovers through sync', async ({
  page,
}) => {
  await login(page, 'river.vale@example.test');
  await controls(page, { failure: true });
  await expect(connection(page)).toHaveText('Reconnecting…');
  await expect(page.locator('[data-entry-id]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
  await controls(page, { failure: false });
  await expect(connection(page)).toHaveText('Connected');
});
test('presence leaves on room departure and typing expires without creating Timeline history', async ({
  context,
  page,
}) => {
  const b = await pair(context, page);
  const initial = (await source(page)).entries.length;
  await page.getByLabel('Message', { exact: true }).fill('Fictional unsent typing');
  await expect(b.getByLabel('Timeline typing')).toHaveText('River Vale is typing…');
  await expect(page.getByLabel('Timeline typing')).toHaveText('');
  await expect(b.getByLabel('Timeline typing')).toHaveText('', { timeout: 10_000 });
  expect((await source(page)).entries).toHaveLength(initial);
  await b.getByRole('link', { name: 'Back to incidents', exact: true }).click();
  await expect(page.getByLabel('Incident presence')).toContainText('1 person viewing');
});
test('expired checkpoint uses authoritative windows, keeps draft and converges a missed correction', async ({
  context,
  page,
}) => {
  const b = await pair(context, page);
  await send(page, 'Fictional checkpoint source');
  await expect(row(b, 'Fictional checkpoint source')).toHaveCount(1);
  await b.getByLabel('Message', { exact: true }).fill('Fictional preserved snapshot draft');
  await hint(b, false);
  await expect(connection(b)).toHaveText('Offline');
  const original = (await source(page)).entries.find(
    (entry) => entry.type === 'human_message' && entry.body === 'Fictional checkpoint source',
  )!;
  if (original.type !== 'human_message') throw new Error('Missing source');
  await source(page, {
    corrections: [{ ...original, revision: 2, body: 'Fictional corrected after expiration' }],
  });
  await expect(row(page, 'Fictional corrected after expiration')).toHaveCount(1);
  await b.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('incident-room-fictional-journal-v1', 1);
        open.onerror = () => reject(new Error('Fixture unavailable'));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('records', 'readwrite');
          const store = tx.objectStore('records');
          const get = store.get('demo-orbit');
          get.onsuccess = () => {
            const data = get.result;
            data.expireBefore = data.highWater;
            store.put(data, 'demo-orbit');
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
  await hint(b, true);
  await expect(connection(b)).toHaveText('Connected');
  await expect(row(b, 'Fictional corrected after expiration')).toHaveCount(1);
  await expect(b.getByLabel('Message', { exact: true })).toHaveValue(
    'Fictional preserved snapshot draft',
  );
});

test('workspace metadata stream updates the active Incident List without incident presence', async ({
  context,
  page,
}) => {
  const b = await pair(context, page);
  await b.getByRole('link', { name: 'Back to incidents', exact: true }).click();
  await expect(b.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
  await send(page, 'Fictional incident update promotes recent sorting');
  await expect(
    b.getByRole('list', { name: 'Incidents', exact: true }).getByRole('listitem').first(),
  ).toContainText('INC-2841');
  await expect(page.getByLabel('Incident presence')).toContainText('1 person viewing');
});

test('dropped live delivery recovers from watermark and does not cancel an active URL target', async ({
  context,
  page,
}) => {
  const b = await pair(context, page);
  const target = `${incidentId}:evt-20`;
  await b.goto(`/app/incidents/INC-2841?event=${encodeURIComponent(target)}&keep=yes#context`);
  await expect(b.getByText('Navigation target', { exact: true })).toBeVisible();
  await expect(connection(b)).toHaveText('Connected');
  await controls(b, { drop: true });
  await send(page, 'Fictional dropped event recovered authoritatively');
  await expect(b.getByRole('button', { name: 'New updates (1)', exact: true })).toBeVisible();
  await expect(b).toHaveURL(/event=.*keep=yes#context/);
  await expect(b.locator(`[data-entry-id="${target}"]`)).toBeVisible();
  await b.getByRole('button', { name: 'New updates (1)', exact: true }).click();
  await expect(row(b, 'Fictional dropped event recovered authoritatively')).toBeVisible();
  await expect(b).toHaveURL(/\?keep=yes#context$/);
});

test('terminal session expiry during reconnect stops subscriptions and quarantines durable draft', async ({
  page,
}) => {
  await login(page, 'river.vale@example.test');
  await page.getByLabel('Message', { exact: true }).fill('Fictional draft retained after expiry');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string | null>((resolve) => {
            const open = indexedDB.open('incident-room-local-work-v1', 1);
            open.onsuccess = () => {
              const db = open.result;
              const tx = db.transaction('records', 'readonly');
              const get = tx
                .objectStore('records')
                .get(JSON.stringify(['demo-river', 'demo-orbit']));
              get.onsuccess = () => {
                const body = get.result?.drafts?.['fictional-incident-2841'] ?? null;
                db.close();
                resolve(body);
              };
            };
          }),
      ),
    )
    .toBe('Fictional draft retained after expiry');
  await hint(page, false);
  await expect(connection(page)).toHaveText('Offline');
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('incident-room-fictional-authority-v1', 1);
        open.onerror = () => reject(new Error('Fixture unavailable'));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('auth-authority', 'readwrite');
          const store = tx.objectStore('auth-authority');
          const get = store.get('singleton');
          get.onsuccess = () => {
            const data = get.result;
            for (const lease of Object.values(data.clients) as {
              expiresAt: number;
              refreshUntil: number;
            }[]) {
              lease.expiresAt = 0;
              lease.refreshUntil = 0;
            }
            store.put(data, 'singleton');
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
  await hint(page, true);
  await expect(page).toHaveURL(/\/login\?.*reason=expired/);
  await expect(connection(page)).toHaveCount(0);
  await expect(page.getByText('Your session expired. Please sign in again.')).toBeVisible();
});
