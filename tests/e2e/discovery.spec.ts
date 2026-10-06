import { test, expect, type Page, type BrowserContext } from '@playwright/test';
const incident = 'fictional-incident-2841';
async function searchCounters(page: Page) {
  return page.evaluate(
    (incident) =>
      new Promise<{ started: number; completed: number }>((resolve, reject) => {
        const open = indexedDB.open('incident-room-fictional-timeline-v1', 1);
        open.onerror = () => reject(new Error('Fixture unavailable'));
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction('records', 'readonly'),
            get = tx.objectStore('records').get(JSON.stringify(['demo-orbit', incident]));
          get.onsuccess = () => resolve(get.result.searchControls);
          tx.oncomplete = () => db.close();
          tx.onabort = () => reject(new Error('Fixture read failed'));
        };
      }),
    incident,
  );
}
async function login(page: Page, email = 'river.vale@example.test') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Fictional-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
}
async function room(page: Page) {
  await page.goto('/app/incidents/INC-2841');
  await expect(page.getByLabel('Realtime connection', { exact: true })).toHaveText('Connected');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
}
async function pair(context: BrowserContext, page: Page) {
  await login(page);
  await room(page);
  await context.clearCookies();
  const second = await context.newPage();
  await login(second, 'sage.linden@example.test');
  await second.getByRole('link', { name: 'Notifications', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(second.getByLabel('0 unread notifications', { exact: true })).toBeVisible();
  return second;
}
async function mention(page: Page, index = 1) {
  await page
    .getByLabel('Message', { exact: true })
    .fill(`Fictional recipient evidence ${index} @Sage Linden [demo-sage]`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const row = page
    .locator('[data-entry-id]')
    .filter({ hasText: `Fictional recipient evidence ${index}` });
  await expect(row).toHaveAttribute('data-entry-id', /^fictional-incident-2841:msg-/);
}
async function search(page: Page, query: string, type?: string) {
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  if (type) await page.getByLabel('Result type', { exact: true }).selectOption(type);
  await page.getByLabel('Search accessible content', { exact: true }).fill(query);
  await expect(page.getByRole('list', { name: 'Search results' })).toBeVisible();
}
async function searchPolicy(page: Page, delayMs: number, failOnce = false) {
  await page.evaluate(
    ({ delayMs, failOnce, incident }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('incident-room-fictional-timeline-v1', 1);
        open.onerror = () => reject(new Error('Fixture open failed'));
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction('records', 'readwrite'),
            store = tx.objectStore('records'),
            key = JSON.stringify(['demo-orbit', incident]),
            get = store.get(key);
          get.onsuccess = () => {
            const data = get.result;
            data.searchControls = {
              ...data.searchControls,
              delayMs,
              failOnce: false,
              failuresRemaining: failOnce ? 2 : 0,
            };
            store.put(data, key);
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
    { delayMs, failOnce, incident },
  );
}
test('Search older Timeline message reuses locator/window/highlight and preserves URL query', async ({
  page,
}) => {
  await login(page);
  await search(page, 'Fictional response update 8.', 'timeline_message');
  const target = `${incident}:evt-8`;
  const link = page
    .getByRole('list', { name: 'Search results' })
    .locator(`a[href*="${encodeURIComponent(target)}"]`)
    .first();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`event=${encodeURIComponent(target)}`));
  await expect(page.locator(`[data-entry-id="${target}"]`)).toContainText('Navigation target');
});
test('Search unopened old Thread target opens exact bounded window', async ({ page }) => {
  await login(page);
  await search(page, 'Fictional contextual reply 800.', 'thread_message');
  const target = `${incident}:reply-42-800`;
  await page
    .getByRole('list', { name: 'Search results' })
    .locator(`a[href*="${encodeURIComponent(target)}"]`)
    .click();
  await expect(page).toHaveURL(new RegExp(`message=${encodeURIComponent(target)}`));
  const surface = page.getByRole('complementary', { name: 'Thread', exact: true });
  await expect(surface.locator(`[data-entry-id="${target}"]`)).toContainText('Navigation target');
  expect(await surface.locator('[data-entry-id]').count()).toBeLessThan(80);
});
test('workspace user Search opens an authorized read-only Profile and existing participant filter', async ({
  page,
}) => {
  await login(page);
  await search(page, 'Sage', 'user');
  await page
    .getByRole('list', { name: 'Search results' })
    .getByRole('link', { name: 'Sage Linden', exact: true })
    .click();
  await expect(page).toHaveURL('/app/profile/demo-sage');
  await expect(page.getByRole('heading', { name: 'Sage Linden', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View accessible incidents involving Sage Linden' }).click();
  await expect(page).toHaveURL('/app/incidents?participant=demo-sage');
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
  await page.goto('/app/profile/foreign-user');
  await expect(page.getByText('Profile unavailable in your workspace.')).toBeVisible();
});
test('Search cancels delayed A and keeps B results and input focus authoritative', async ({
  page,
}) => {
  await login(page);
  await room(page);
  await searchPolicy(page, 2500);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  const input = page.getByLabel('Search accessible content', { exact: true });
  const requested = page.waitForRequest(
    (request) =>
      request.url().includes('/mock-api/search?') &&
      new URL(request.url()).searchParams.get('q') === 'Aurora',
  );
  await input.fill('Aurora');
  await requested;
  await expect.poll(() => searchCounters(page)).toMatchObject({ started: 1 });
  await searchPolicy(page, 0);
  await input.fill('INC-2841');
  await expect(page.getByRole('list', { name: 'Search results' })).toContainText('INC-2841');
  await expect(input).toBeFocused();
  await expect(
    page.getByRole('list', { name: 'Search results' }).locator(':scope > li'),
  ).toHaveCount(1);
  await expect(page).toHaveURL(/q=INC-2841/);
  await expect.poll(() => searchCounters(page)).toMatchObject({ completed: 2 });
  await expect(
    page.getByRole('list', { name: 'Search results' }).locator(':scope > li'),
  ).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel('Search accessible content', { exact: true })).toHaveValue(
    'INC-2841',
  );
  await expect(
    page.getByRole('list', { name: 'Search results' }).locator(':scope > li'),
  ).toHaveCount(1);
});
test('Search minimum, empty results, pagination and refresh remain distinct', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  const input = page.getByLabel('Search accessible content', { exact: true });
  await expect(page.getByText('Search incidents, messages and workspace users.')).toBeVisible();
  await input.fill('x');
  await expect(page.getByText('Enter at least two characters.')).toBeVisible();
  await input.fill('unmatched-orthoclase');
  await expect(page.getByRole('status').filter({ hasText: /0 results shown/ })).toBeVisible();
  await input.fill('Aurora');
  const list = page.getByRole('list', { name: 'Search results' });
  await expect(list).toBeVisible();
  const before = await list.locator(':scope > li').count();
  await page.getByRole('button', { name: 'Load more results' }).click();
  await expect.poll(() => list.locator(':scope > li').count()).toBeGreaterThan(before);
  await page.getByRole('button', { name: 'Refresh Search' }).click();
  await expect(list).toBeVisible();
});
test('Search error preserves query and retries without fabricated empty result', async ({
  page,
}) => {
  await login(page);
  await room(page);
  await searchPolicy(page, 0, true);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await page.getByLabel('Result type', { exact: true }).selectOption('incident');
  await page.getByLabel('Search accessible content', { exact: true }).fill('INC-2841');
  await expect(page.getByRole('button', { name: 'Retry Search' })).toBeVisible();
  await expect(page.getByText('Search unavailable. Your query is preserved.')).toBeVisible();
  await searchPolicy(page, 0);
  await page.getByRole('button', { name: 'Retry Search' }).click();
  await expect(page.getByRole('list', { name: 'Search results' })).toContainText('INC-2841');
});
test('notification live delivery is recipient-only, unique and follows exact Timeline target', async ({
  page,
  context,
}) => {
  const second = await pair(context, page);
  const stream = await second.waitForRequest((request) =>
    request.url().includes('/mock-api/realtime/stream?'),
  );
  const client = new URL(stream.url()).searchParams.get('client')!;
  await second.evaluate(
    (client) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('incident-room-fictional-journal-v1', 1);
        open.onerror = () => reject(new Error('Journal unavailable'));
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction('records', 'readwrite'),
            store = tx.objectStore('records'),
            get = store.get('demo-orbit');
          get.onsuccess = () => {
            const data = get.result;
            data.controls[client] = { duplicate: true, reverse: true };
            store.put(data, 'demo-orbit');
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(new Error('Fixture failed'));
        };
      }),
    client,
  );
  await mention(page);
  await expect(second.getByLabel('1 unread notifications', { exact: true })).toBeVisible();
  const items = second
    .getByRole('list', { name: 'Notifications', exact: true })
    .locator(':scope > li');
  await expect(items).toHaveCount(1);
  await expect(page.getByLabel('0 unread notifications', { exact: true })).toBeVisible();
  const link = items.getByRole('link');
  const href = await link.getAttribute('href');
  expect(href).toContain('?event=');
  await link.click();
  await expect(second).toHaveURL(
    (url) => url.pathname === '/app/incidents/INC-2841' && Boolean(url.searchParams.get('event')),
  );
  const target = new URL(second.url()).searchParams.get('event')!;
  await expect(second.locator(`[data-entry-id="${target}"]`)).toContainText('Navigation target');
  await expect(second.getByLabel('0 unread notifications', { exact: true })).toBeVisible();
});
test('mark unread and bulk read converge badge without one request per record', async ({
  page,
  context,
}) => {
  const second = await pair(context, page);
  await mention(page, 1);
  await mention(page, 2);
  await expect(second.getByLabel('2 unread notifications', { exact: true })).toBeVisible();
  const rows = second
    .getByRole('list', { name: 'Notifications', exact: true })
    .locator(':scope > li');
  await expect(rows).toHaveCount(2);
  await rows.first().getByRole('button', { name: 'Mark read', exact: true }).click();
  await expect(second.getByLabel('1 unread notifications', { exact: true })).toBeVisible();
  await rows.first().getByRole('button', { name: 'Mark unread', exact: true }).click();
  await expect(second.getByLabel('2 unread notifications', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(second.getByLabel('0 unread notifications', { exact: true })).toBeVisible();
  await expect(
    rows.filter({ has: second.getByRole('button', { name: 'Mark read', exact: true }) }),
  ).toHaveCount(0);
});
test('failed read mutation preserves canonical navigation and a visible retry notice', async ({
  page,
  context,
}) => {
  const second = await pair(context, page);
  await mention(page);
  const link = second.getByRole('list', { name: 'Notifications', exact: true }).getByRole('link');
  await expect(link).toBeVisible();
  await second.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('incident-room-fictional-notifications-v1', 1);
        open.onerror = () => reject(new Error('Notification fixture unavailable'));
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction('records', 'readwrite'),
            store = tx.objectStore('records'),
            get = store.get('demo-orbit');
          get.onsuccess = () => {
            const data = get.result;
            data.failOnce = true;
            store.put(data, 'demo-orbit');
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(new Error('Fixture failed'));
        };
      }),
  );
  await link.click();
  await expect(second).toHaveURL((url) => Boolean(url.searchParams.get('event')));
  await expect(second.getByRole('button', { name: 'Dismiss read notice' })).toBeVisible();
  await expect(second.getByLabel('1 unread notifications', { exact: true })).toBeVisible();
  await second.getByRole('link', { name: 'Notifications', exact: true }).click();
  await second.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(second.getByLabel('0 unread notifications', { exact: true })).toBeVisible();
});
test('recipient logout then another identity never restores previous inbox or unread badge', async ({
  page,
  context,
}) => {
  const second = await pair(context, page);
  await mention(page);
  await expect(second.getByLabel('1 unread notifications', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await login(second);
  await second.getByRole('link', { name: 'Notifications', exact: true }).click();
  await expect(second.getByLabel('0 unread notifications', { exact: true })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(second.getByText('No notifications.', { exact: true })).toBeVisible();
  await expect(
    second.getByRole('list', { name: 'Notifications', exact: true }).locator(':scope > li'),
  ).toHaveCount(0);
  await expect(second.getByText('Fictional recipient evidence 1', { exact: true })).toHaveCount(0);
});
test('notification disconnect and expired checkpoint recover through existing resync', async ({
  page,
  context,
}) => {
  const second = await pair(context, page);
  await second.evaluate(() => window.dispatchEvent(new Event('offline')));
  await mention(page);
  await expect(second.getByLabel('0 unread notifications', { exact: true })).toBeVisible();
  await second.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('incident-room-fictional-journal-v1', 1);
        open.onerror = () => reject(new Error('Journal unavailable'));
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction('records', 'readwrite'),
            store = tx.objectStore('records'),
            get = store.get('demo-orbit');
          get.onsuccess = () => {
            const data = get.result;
            data.expireBefore = data.highWater;
            store.put(data, 'demo-orbit');
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(new Error('Expiry failed'));
        };
      }),
  );
  await second.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(second.getByLabel('1 unread notifications', { exact: true })).toBeVisible();
  await expect(
    second.getByRole('list', { name: 'Notifications', exact: true }).locator(':scope > li'),
  ).toHaveCount(1);
});
test('Thread reply notification uses Phase 6 root/message destination', async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto(`/app/incidents/INC-2841?thread=${encodeURIComponent(`${incident}:evt-4000`)}`);
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  await expect(thread.getByLabel('Message', { exact: true })).toBeEnabled();
  await context.clearCookies();
  const second = await context.newPage();
  await login(second, 'sage.linden@example.test');
  await second.getByRole('link', { name: 'Notifications', exact: true }).click();
  await thread
    .getByLabel('Message', { exact: true })
    .fill('Fictional contextual notification evidence');
  await thread.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(second.getByLabel('1 unread notifications', { exact: true })).toBeVisible();
  await second.getByRole('list', { name: 'Notifications', exact: true }).getByRole('link').click();
  await expect(second).toHaveURL((url) =>
    Boolean(url.searchParams.get('thread') && url.searchParams.get('message')),
  );
  const id = new URL(second.url()).searchParams.get('message')!;
  await expect(second.locator(`[data-entry-id="${id}"]`)).toContainText('Navigation target');
});
test('palette shortcut, keyboard remote Incident navigation and focus restore', async ({
  page,
}) => {
  await login(page);
  const trigger = page.getByRole('button', { name: 'Commands', exact: true });
  await trigger.focus();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command Palette' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill('INC-2841');
  await expect(dialog.getByRole('option', { name: /INC-2841 ·/ })).toBeVisible();
  await input.press('Enter');
  await expect(page).toHaveURL('/app/incidents/INC-2841');
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});
test('palette current Thread commands use canonical URL and creation uses existing dialog', async ({
  page,
}, testInfo) => {
  await login(page);
  await page.goto(`/app/incidents/INC-2841?thread=${encodeURIComponent(`${incident}:evt-4000`)}`);
  await expect(page.getByRole('complementary', { name: 'Thread', exact: true })).toBeVisible();
  await page
    .getByRole('button', {
      name: testInfo.project.name === 'mobile-chromium' ? 'Thread commands' : 'Commands',
      exact: true,
    })
    .click();
  await page
    .getByRole('combobox', { name: 'Find a command or Incident' })
    .fill('Close current Thread');
  await page.getByRole('combobox', { name: 'Find a command or Incident' }).press('Enter');
  await expect(page).toHaveURL('/app/incidents/INC-2841');
  await expect(page.getByRole('complementary', { name: 'Thread', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Commands', exact: true }).click();
  await page.getByRole('combobox', { name: 'Find a command or Incident' }).fill('Create Incident');
  await page.getByRole('combobox', { name: 'Find a command or Incident' }).press('Enter');
  await expect(page.getByRole('dialog', { name: 'Create Incident', exact: true })).toBeVisible();
});
test('mobile entries and palette are visible without overflow; editable shortcut stays owned', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  const input = page.getByLabel('Search accessible content', { exact: true });
  await input.focus();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command Palette' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Commands', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Command Palette' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Close palette' }).click();
  await page.getByRole('link', { name: 'Notifications', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
});
