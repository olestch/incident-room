import { openDemo, closeDemo, navigateApp } from './shell-helpers';
import { test, expect, type Page } from '@playwright/test';
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('river.vale@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Fictional-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
}
async function controls(page: Page) {
  await openDemo(page);
}
test('demo latency and seeded failures affect actual authority Search requests', async ({
  page,
}) => {
  await login(page);
  await controls(page);
  await page.getByLabel('Request latency').selectOption('2000');
  await closeDemo(page);
  await navigateApp(page, 'Search');
  const search = page.getByRole('searchbox', { name: 'Search accessible content' });
  const response = page.waitForResponse((r) => r.url().includes('/mock-api/search'));
  await search.fill('Aurora');
  await expect(page.getByText(/Searching/).first()).toBeVisible();
  expect((await response).status()).toBe(200);
  await controls(page);
  await page.getByLabel('Failure rate').selectOption('30');
  await closeDemo(page);
  const failure = page.waitForResponse(
    (r) => r.url().includes('/mock-api/search') && r.status() === 503,
  );
  await search.fill('Cedar');
  await failure;
  await controls(page);
  await page.getByRole('button', { name: 'Clear simulations' }).click();
  await expect(
    page.getByText('0 ms · 0% failures · realtime connected', { exact: false }),
  ).toBeVisible();
});
test('disconnect, persist missed activity, and reconnect through real resync', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.goto('/app/incidents/INC-2841');
  await expect(page.getByLabel('Realtime connection', { exact: true })).toHaveText('Connected');
  await controls(page);
  await page.getByRole('button', { name: 'Disconnect realtime', exact: true }).click();
  await expect(page.getByLabel('Realtime connection', { exact: true })).toHaveText('Offline');
  await page.getByRole('button', { name: 'Generate persistent event' }).click();
  await expect(
    page.getByText('Generated monitoring activity in INC-2841.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.locator('[data-entry-id]').filter({ hasText: 'Demo activity 4001' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Reconnect realtime', exact: true }).click();
  await expect(page.getByLabel('Realtime connection', { exact: true })).toHaveText('Connected');
  await expect(
    page.locator('[data-entry-id]').filter({ hasText: 'Demo activity 4001' }),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    page.locator('[data-entry-id]').filter({ hasText: 'Demo activity 4001' }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});
test('confirmed 50k dataset uses bounded DOM and reloadable old target', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  await controls(page);
  await page.getByLabel('Timeline stress size').selectOption('50000');
  const dataset = page.waitForResponse(
    (r) =>
      r.url().includes('/mock-api/incidents/INC-2841/timeline') && r.request().method() === 'GET',
  );
  const transport = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/mock-api/incidents/INC-2841/realtime/stream',
  );
  await page.getByRole('button', { name: 'Replace showcase dataset' }).click();
  await page
    .getByRole('dialog', { name: 'Replace showcase dataset?' })
    .getByRole('button', { name: 'Replace dataset', exact: true })
    .click();
  expect((await (await dataset).json()).total).toBe(50000);
  // Initial history and transport readiness complete independently after dataset replacement.
  expect((await transport).status()).toBe(200);
  await expect(page.getByLabel('Realtime connection', { exact: true })).toHaveText('Connected');
  await expect(page.locator('[data-entry-id]').first()).toBeVisible();
  expect(await page.locator('[data-entry-id]').count()).toBeLessThan(80);
  await expect(page.locator('[data-entry-id="fictional-incident-2841:evt-50000"]')).toBeVisible();
  const viewport = page.getByLabel('Timeline viewport', { exact: true });
  await viewport.press('Home');
  await expect(page.locator('[data-entry-id]').first()).toBeVisible();
  expect(await page.locator('[data-entry-id]').count()).toBeLessThan(80);
  await viewport.press('End');
  await expect(page.locator('[data-entry-id="fictional-incident-2841:evt-50000"]')).toBeVisible();
  if (await page.getByRole('dialog', { name: 'Demo tools', exact: true }).isVisible())
    await closeDemo(page);
  await expect(page.getByRole('dialog', { name: 'Demo tools', exact: true })).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/app/incidents/INC-2841?event=fictional-incident-2841:evt-42');
  const target = page.locator('[data-entry-id="fictional-incident-2841:evt-42"]');
  await expect(target).toBeInViewport();
  const offset = () =>
    target.evaluate(
      (element) =>
        element.getBoundingClientRect().top -
        element.closest('.timeline-viewport')!.getBoundingClientRect().top,
    );
  const before = await offset();
  await viewport.evaluate((element) => element.setAttribute('data-mount-check', 'retained'));
  await page.getByRole('button', { name: 'Incident context', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Incident context', exact: true })
    .getByRole('button', { name: 'Close Incident context' })
    .click();
  await expect(viewport).toHaveAttribute('data-mount-check', 'retained');
  await expect.poll(async () => Math.abs((await offset()) - before)).toBeLessThanOrEqual(8);
  expect(await page.locator('[data-entry-id]').count()).toBeLessThan(80);
  await page.goto(
    '/app/incidents/INC-2841?event=fictional-incident-2841:evt-42&thread=fictional-incident-2841:evt-42',
  );
  await expect(page.getByRole('heading', { name: 'Thread', exact: true })).toBeVisible();
  expect(await page.locator('[data-entry-id]').count()).toBeLessThan(160);
  expect(errors).toEqual([]);
});
test('reset restores seed, clears generated persistent work and requires single app tab', async ({
  page,
  context,
}) => {
  await login(page);
  await controls(page);
  const other = await context.newPage();
  await other.goto('/app/incidents');
  await expect(other.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Demo tools', exact: true })
    .getByRole('button', { name: 'Reset Demo data', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Reset Demo data?', exact: true })
    .getByRole('button', { name: 'Reset Demo data', exact: true })
    .click();
  await expect(page.getByText('Demo operation unavailable.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Current user')).toContainText('River Vale');
  await page
    .getByRole('dialog', { name: 'Reset Demo data?', exact: true })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await other.close();
  await page.getByRole('button', { name: 'Generate persistent event' }).click();
  await expect(page.getByText('Generated monitoring activity', { exact: false })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Demo tools', exact: true })
    .getByRole('button', { name: 'Reset Demo data', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Reset Demo data?', exact: true })
    .getByRole('button', { name: 'Reset Demo data', exact: true })
    .click();
  await expect(page).toHaveURL(/\/login/);
  await login(page);
  const baseline = page.waitForResponse(
    (r) =>
      r.url().includes('/mock-api/incidents/INC-2841/timeline') && r.request().method() === 'GET',
  );
  await page.goto('/app/incidents/INC-2841');
  expect((await (await baseline).json()).total).toBe(4000);
  await expect(page.getByLabel('Realtime connection', { exact: true })).toHaveText('Connected');
  await expect(page.locator('[data-entry-id="fictional-incident-2841:evt-4000"]')).toBeVisible();
  await expect(page.locator('[data-entry-id]').filter({ hasText: 'Demo activity' })).toHaveCount(0);
  await navigateApp(page, 'Notifications');
  await expect(
    page.getByRole('list', { name: 'Notifications', exact: true }).getByRole('listitem'),
  ).toHaveCount(2);
  await expect(page.locator('main').getByLabel('1 unread notifications')).toHaveText('1');
});
test('reviewer journeys and responsive keyboard controls remain usable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.goto('/app/incidents/INC-2841');
  await expect(page.getByLabel('Realtime connection', { exact: true })).toHaveText('Connected');
  await page
    .getByRole('button', { name: 'Open Thread for fictional-incident-2841:evt-4000', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Thread', exact: true })).toBeVisible();
  await expect(page.getByText(/Fictional contextual reply 8\./)).toBeVisible();
  await page.getByRole('button', { name: 'Back to Timeline / Close Thread', exact: true }).focus();
  await page.getByRole('button', { name: 'Back to Timeline / Close Thread', exact: true }).click();
  await navigateApp(page, 'Search');
  await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search accessible content' }).fill('Aurora');
  await expect(page.getByText(/results shown/)).toBeVisible();
  await navigateApp(page, 'Notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await controls(page);
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByLabel('Request latency').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command Palette', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear simulations' }).click();
  await page.goto('/app/incidents/INC-2865/postmortem');
  await page.getByRole('button', { name: 'Initiate Postmortem', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Postmortem editor' })).toBeVisible();
  expect(errors).toEqual([]);
});
