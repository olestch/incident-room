import { test, expect, type Page, type BrowserContext } from '@playwright/test';
const incident = 'fictional-incident-2841';
const populated = `${incident}:evt-4000`,
  empty = `${incident}:evt-3999`,
  large = `${incident}:evt-42`;
const surface = (page: Page) => page.getByRole('complementary', { name: 'Thread', exact: true });
const connection = (page: Page) => page.getByLabel('Realtime connection', { exact: true });
const rootButton = (page: Page, root: string) =>
  page.getByRole('button', { name: `Open Thread for ${root}`, exact: true });
const replyRow = (page: Page, body: string) =>
  surface(page).locator('[data-entry-id]').filter({ hasText: body });
async function login(page: Page, email = 'river.vale@example.test') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Fictional-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
  await page.goto('/app/incidents/INC-2841');
  await expect(connection(page)).toHaveText('Connected');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
}
async function open(page: Page, root = populated) {
  await rootButton(page, root).click();
  await expect(surface(page)).toBeVisible();
  await expect(surface(page).getByLabel('Message', { exact: true })).toBeEnabled();
}
async function direct(page: Page, root: string, message?: string) {
  await page.goto(
    `/app/incidents/INC-2841?thread=${encodeURIComponent(root)}${message ? `&message=${encodeURIComponent(message)}` : ''}`,
  );
  await expect(surface(page)).toBeVisible();
  await expect(surface(page).getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(connection(page)).toHaveText('Connected');
}
async function send(page: Page, body: string) {
  await surface(page).getByLabel('Message', { exact: true }).fill(body);
  await surface(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(surface(page).getByLabel('Message', { exact: true })).toHaveValue('');
  await expect(replyRow(page, body)).toHaveCount(1);
}
async function pair(context: BrowserContext, page: Page, root?: string, message?: string) {
  await login(page);
  // Direct navigation must precede B's cookie: each runtime captures its own auth
  // correlation handle. Reloading A after B logs in would silently adopt B's lease.
  if (root) await direct(page, root, message);
  await context.clearCookies();
  const second = await context.newPage();
  await login(second, 'sage.linden@example.test');
  await expect(page.getByRole('banner')).toContainText('River Vale');
  await expect(second.getByRole('banner')).toContainText('Sage Linden');
  return second;
}
async function controls(
  page: Page,
  input: { failure?: boolean; duplicate?: boolean; reverse?: boolean; drop?: boolean },
  expired = false,
) {
  await page.evaluate(
    ({ input, expired }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('incident-room-fictional-journal-v1', 1);
        open.onerror = () => reject(new Error('Fixture unavailable'));
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction('records', 'readwrite'),
            store = tx.objectStore('records'),
            get = store.get('demo-orbit');
          get.onsuccess = () => {
            const data = get.result;
            data.controls[sessionStorage.getItem('ir_realtime_client')!] = input;
            if (expired) data.expireBefore = data.highWater;
            store.put(data, 'demo-orbit');
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(new Error('Fixture transaction failed'));
          };
        };
      }),
    { input, expired },
  );
}
test('populated Thread open and close keeps Timeline reading context and restores focus', async ({
  page,
}) => {
  await login(page);
  await expect(rootButton(page, populated)).toHaveText('8 replies');
  const viewport = page.getByLabel('Timeline viewport', { exact: true });
  const before = await viewport.evaluate((node) => node.scrollTop);
  await open(page);
  await expect(surface(page).getByText(/Fictional contextual reply 8\./)).toBeVisible();
  await surface(page).getByRole('button', { name: 'Back to Timeline / Close Thread' }).click();
  await expect(surface(page)).toHaveCount(0);
  await expect(rootButton(page, populated)).toBeFocused();
  expect(await viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(before / 2);
  await page.goForward();
  await expect(surface(page)).toBeVisible();
  await page.goBack();
  await expect(surface(page)).toHaveCount(0);
});
test('first reply creates an empty Thread and summary changes to one confirmed reply', async ({
  page,
}) => {
  await login(page);
  await open(page, empty);
  await expect(
    surface(page).getByText('No replies yet. The first reply creates this Thread.'),
  ).toBeVisible();
  await send(page, 'Fictional first Thread reply');
  await surface(page).getByRole('button', { name: 'Back to Timeline / Close Thread' }).click();
  await expect(rootButton(page, empty)).toHaveText('1 replies');
});
test('Reply/cancel preserve body, send renders flat contextual reference and clears only handed-off draft', async ({
  page,
}) => {
  await login(page);
  await open(page);
  await surface(page).getByLabel('Message', { exact: true }).fill('Fictional contextual response');
  await surface(page).getByRole('button', { name: 'Reply', exact: true }).last().click();
  await expect(surface(page).getByLabel('Reply context')).toContainText('reply 8');
  await surface(page).getByRole('button', { name: 'Cancel reply', exact: true }).click();
  await expect(surface(page).getByLabel('Message', { exact: true })).toHaveValue(
    'Fictional contextual response',
  );
  await surface(page).getByRole('button', { name: 'Reply', exact: true }).last().click();
  await send(page, 'Fictional contextual response');
  await expect(surface(page).getByLabel('Reply context')).toHaveCount(0);
  await expect(
    replyRow(page, 'Fictional contextual response').getByRole('button', {
      name: `View reply reference ${incident}:reply-4000-8`,
    }),
  ).toBeVisible();
  expect(await surface(page).locator('li li').count()).toBe(0);
});
test('unloaded reference resolves with locator/window and highlights parent, never linear pagination', async ({
  page,
}) => {
  await login(page);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/threads/')) requests.push(request.url());
  });
  await direct(page, large);
  await surface(page)
    .getByRole('button', { name: `View reply reference ${incident}:reply-42-1`, exact: true })
    .last()
    .click();
  await expect(surface(page).getByText('Target found in Thread.', { exact: true })).toBeVisible();
  await expect(surface(page).locator(`[data-entry-id="${incident}:reply-42-1"]`)).toHaveClass(
    /timeline-target/,
  );
  expect(requests.filter((url) => url.includes('/messages?cursor=')).length).toBeLessThanOrEqual(2);
  await expect(page).toHaveURL(/message=fictional-incident-2841%3Areply-42-1/);
});
test('direct unloaded root resolves without repositioning Timeline or loading all its history', async ({
  page,
}) => {
  await login(page);
  const roots: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/timeline')) roots.push(request.url());
  });
  await direct(page, large);
  await expect(surface(page).getByText(`Root: ${large}`, { exact: true })).toBeVisible();
  await expect(
    page.getByLabel('Timeline viewport', { exact: true }).locator('[data-entry-id]').last(),
  ).toHaveAttribute('data-entry-id', populated);
  expect(roots.filter((url) => url.includes('/timeline?cursor=')).length).toBeLessThanOrEqual(1);
  await surface(page).getByRole('button', { name: 'View root in Timeline', exact: true }).click();
  await expect(surface(page)).toHaveCount(0);
  await expect(page.getByText('Target found in Timeline.', { exact: true })).toBeVisible();
  await expect(page.locator(`[data-entry-id="${large}"]`)).toHaveClass(/timeline-target/);
});
test('direct old Thread-message target mounts measured window with bounded DOM; older prepend retains target', async ({
  page,
}) => {
  await login(page);
  const target = `${incident}:reply-42-800`;
  await direct(page, large, target);
  await expect(surface(page).getByText('Target found in Thread.', { exact: true })).toBeVisible();
  const row = surface(page).locator(`[data-entry-id="${target}"]`);
  await expect(row).toHaveClass(/timeline-target/);
  expect(await surface(page).locator('[data-entry-id]').count()).toBeLessThan(80);
  await surface(page).getByRole('button', { name: 'Load older replies', exact: true }).click();
  await expect(row).toBeVisible();
  expect(await surface(page).locator('[data-entry-id]').count()).toBeLessThan(80);
});
test('two independent clients get one live confirmed reply and absolute summary even with duplicates/reordered transport', async ({
  context,
  page,
}) => {
  const second = await pair(context, page);
  await open(page);
  await open(second);
  await controls(page, { duplicate: true, reverse: true });
  await send(second, 'Fictional independent Thread echo');
  await expect(replyRow(page, 'Fictional independent Thread echo')).toHaveCount(1);
  await surface(page).getByRole('button', { name: 'Back to Timeline / Close Thread' }).click();
  await expect(rootButton(page, populated)).toHaveText('9 replies');
  await second.close();
});
test('Thread missed reply recovers through shared Phase 5 automatic reconnect/resync', async ({
  context,
  page,
}) => {
  const second = await pair(context, page);
  await open(page);
  await open(second);
  await controls(page, { failure: true });
  await expect(connection(page)).toHaveText('Reconnecting…');
  await send(second, 'Fictional missed contextual reply');
  await controls(page, { failure: false });
  // The existing runtime reconnects automatically. Retry can legitimately disappear
  // before a click once the transport is restored; wait for synchronization itself.
  await expect(connection(page)).toHaveText('Connected');
  await expect(replyRow(page, 'Fictional missed contextual reply')).toHaveCount(1);
  await second.close();
});
test('expired checkpoint repairs active Thread loaded window and recent replies without all-Thread snapshot', async ({
  context,
  page,
}) => {
  const second = await pair(context, page, large, `${incident}:reply-42-800`);
  await direct(second, large);
  await expect(surface(page).getByText('Target found in Thread.', { exact: true })).toBeVisible();
  await controls(page, { failure: true });
  await expect(connection(page)).toHaveText('Reconnecting…');
  await send(second, 'Fictional Thread snapshot repair');
  // Authority commit and journal ingestion are separate recoverable transactions. Await
  // publication before setting retention floor; otherwise floor=0 never expires A's cursor.
  await expect
    .poll(() =>
      second.evaluate(
        () =>
          new Promise<boolean>((resolve, reject) => {
            const open = indexedDB.open('incident-room-fictional-journal-v1', 1);
            open.onerror = () => reject(new Error('Fixture unavailable'));
            open.onsuccess = () => {
              const db = open.result,
                tx = db.transaction('records', 'readonly'),
                get = tx.objectStore('records').get('demo-orbit');
              let found = false;
              get.onsuccess = () => {
                found = get.result.events.some(
                  (e: { resourceType: string; payload: { body?: string } }) =>
                    e.resourceType === 'thread_message' &&
                    e.payload.body === 'Fictional Thread snapshot repair',
                );
              };
              tx.oncomplete = () => {
                db.close();
                resolve(found);
              };
              tx.onabort = () => {
                db.close();
                reject(new Error('Fixture read failed'));
              };
            };
          }),
      ),
    )
    .toBe(true);
  const snapshots: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/realtime/snapshot')) snapshots.push(request.url());
  });
  await controls(page, { failure: false }, true);
  await expect(connection(page)).toHaveText('Connected');
  expect(snapshots.length).toBeGreaterThan(0);
  expect(snapshots.every((url) => new URL(url).searchParams.get('thread') === large)).toBe(true);
  await surface(page).getByRole('button', { name: 'Latest replies', exact: true }).click();
  await expect(replyRow(page, 'Fictional Thread snapshot repair')).toHaveCount(1);
  await second.close();
});
test('Thread typing is scoped, distinct from Timeline and expires without durable message or history', async ({
  context,
  page,
}) => {
  const second = await pair(context, page);
  await open(page);
  await open(second);
  await surface(second).getByLabel('Message', { exact: true }).fill('Fictional typing only');
  await expect(surface(page).getByLabel('Thread typing', { exact: true })).toContainText(
    'Sage Linden is typing in this Thread',
  );
  await expect(page.getByLabel('Timeline typing', { exact: true })).toHaveText('');
  await expect(surface(page).getByLabel('Thread typing', { exact: true })).toHaveText('');
  await surface(second).getByRole('button', { name: 'Back to Timeline / Close Thread' }).click();
  await second.getByLabel('Message', { exact: true }).fill('Fictional Timeline typing');
  await expect(page.getByLabel('Timeline typing', { exact: true })).toContainText(
    'Sage Linden is typing',
  );
  await expect(surface(page).getByLabel('Thread typing', { exact: true })).toHaveText('');
  await second.close();
});
test('Thread draft and reply target survive close, other Thread, reload and responsive migration', async ({
  page,
}) => {
  await login(page);
  await open(page);
  await surface(page).getByRole('button', { name: 'Reply', exact: true }).last().click();
  await surface(page)
    .getByLabel('Message', { exact: true })
    .fill('Fictional retained Thread draft');
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(surface(page).getByLabel('Message', { exact: true })).toHaveValue(
    'Fictional retained Thread draft',
  );
  await expect(surface(page).getByLabel('Reply context')).toContainText('reply 8');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await surface(page).getByRole('button', { name: 'Back to Timeline / Close Thread' }).click();
  await open(page, empty);
  await expect(surface(page).getByLabel('Message', { exact: true })).toHaveValue('');
  await surface(page).getByRole('button', { name: 'Back to Timeline / Close Thread' }).click();
  await open(page);
  await expect(surface(page).getByLabel('Message', { exact: true })).toHaveValue(
    'Fictional retained Thread draft',
  );
  await page.reload();
  await expect(surface(page).getByLabel('Message', { exact: true })).toHaveValue(
    'Fictional retained Thread draft',
  );
  await expect(surface(page).getByLabel('Reply context')).toContainText('reply 8');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(surface(page).getByLabel('Message', { exact: true })).toHaveValue(
    'Fictional retained Thread draft',
  );
  await surface(page).getByRole('button', { name: 'Back to Timeline / Close Thread' }).click();
  await expect(surface(page)).toHaveCount(0);
});
test('missing target and unavailable root show explicit error but leave room usable', async ({
  page,
}) => {
  await login(page);
  await direct(page, populated, 'fictional-incident-2841:reply-missing');
  await expect(surface(page).getByText('Thread target missing.', { exact: true })).toBeVisible();
  await expect(surface(page).getByRole('button', { name: 'Retry message target' })).toBeVisible();
  await surface(page).getByRole('button', { name: 'Back to Timeline / Close Thread' }).click();
  await page.goto('/app/incidents/INC-2841?thread=fictional-incident-2841%3Aevt-missing');
  await expect(surface(page).getByText('Thread root unavailable.', { exact: true })).toBeVisible();
  await surface(page).getByRole('button', { name: 'Back to Timeline / Close Thread' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
});

test('live root and message tombstones retain readable Thread and semantic reference target', async ({
  page,
}) => {
  await login(page);
  const parent = `${incident}:reply-42-1`;
  await direct(page, large, parent);
  await expect(surface(page).getByText('Target found in Thread.', { exact: true })).toBeVisible();
  await page.evaluate(
    ({ incident, large }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('incident-room-fictional-timeline-v1', 1);
        open.onerror = () => reject(new Error('Fixture unavailable'));
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction('records', 'readwrite'),
            store = tx.objectStore('records'),
            get = store.get(JSON.stringify(['demo-orbit', incident]));
          get.onsuccess = () => {
            const data = get.result,
              entry = data.entries.find((e: { id: string }) => e.id === large);
            entry.revision++;
            entry.tombstone = {
              deletedAt: new Date().toISOString(),
              reason: 'Fictional source withdrawn',
            };
            if ('body' in entry) entry.body = '';
            if ('summary' in entry) entry.summary = '';
            data.changes.push({ kind: 'timeline_tombstoned', entry });
            store.put(data, JSON.stringify(['demo-orbit', incident]));
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
    { incident, large, parent },
  );
  await expect(
    surface(page).locator('.thread-root').getByText('Deleted entry', { exact: true }),
  ).toBeVisible();
  await page.evaluate(
    ({ incident, large, parent }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('incident-room-fictional-threads-v1', 1);
        open.onerror = () => reject(new Error('Fixture unavailable'));
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction('records', 'readwrite'),
            store = tx.objectStore('records'),
            get = store.get(JSON.stringify(['demo-orbit', incident]));
          get.onsuccess = () => {
            const data = get.result,
              message = data.messages[large].find((m: { id: string }) => m.id === parent);
            message.revision++;
            message.tombstone = {
              deletedAt: new Date().toISOString(),
              reason: 'Fictional reply withdrawn',
            };
            message.body = '';
            data.changes.push({
              resourceType: 'thread_message',
              kind: 'thread_message_tombstoned',
              payload: message,
            });
            store.put(data, JSON.stringify(['demo-orbit', incident]));
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
    { incident, large, parent },
  );
  const row = surface(page).locator(`[data-entry-id="${parent}"]`);
  await expect(row.getByText('Deleted message', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    surface(page).getByText('Target found: deleted message.', { exact: true }),
  ).toBeVisible();
  await surface(page).getByRole('button', { name: 'Latest replies', exact: true }).click();
  await send(page, 'Fictional discussion survives deleted root');
});
test('old Thread reader stays anchored, counts one new reply and explicitly returns to newest', async ({
  context,
  page,
}) => {
  const target = `${incident}:reply-42-800`;
  const second = await pair(context, page, large, target);
  await expect(surface(page).getByText('Target found in Thread.', { exact: true })).toBeVisible();
  await direct(second, large);
  await controls(page, { duplicate: true, reverse: true });
  const row = surface(page).locator(`[data-entry-id="${target}"]`);
  // Read both rectangles in one layout snapshot, not two protocol round trips.
  const relativeTop = () =>
    row.evaluate(
      (node) =>
        node.getBoundingClientRect().top -
        node.closest('[aria-label="Thread viewport"]')!.getBoundingClientRect().top,
    );
  const before = await relativeTop();
  await send(second, 'Fictional reply while reading older discussion');
  await expect(
    surface(page).getByRole('button', { name: 'New replies (1)', exact: true }),
  ).toBeVisible();
  expect(Math.abs((await relativeTop()) - before)).toBeLessThan(8);
  // Exercise the deliberate 8-second highlight lifecycle as well as message arrival.
  // This new assertion needs to observe that UX timer; no existing timeout is relaxed.
  await expect(row).not.toHaveClass(/timeline-target/, { timeout: 10_000 });
  await expect(row.getByText('Navigation target', { exact: true })).toBeVisible();
  expect(Math.abs((await relativeTop()) - before)).toBeLessThan(8);
  await expect(page).toHaveURL(/message=fictional-incident-2841%3Areply-42-800/);
  await surface(page).getByRole('button', { name: 'New replies (1)', exact: true }).click();
  await expect(replyRow(page, 'Fictional reply while reading older discussion')).toHaveCount(1);
  await expect(page).toHaveURL(
    (url) => url.searchParams.get('message') === null && url.searchParams.get('thread') === large,
  );
  await second.close();
});
