import { navigateApp, signOut, openDemo } from './shell-helpers';
import { expect, test, type Page } from '@playwright/test';

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

async function signIn(page: Page) {
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill('river.vale@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Fictional-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

function navigations(page: Page) {
  const paths: string[] = [];
  page.on('request', (request) => {
    // Next may also replace history with the same URL without another document.
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      paths.push(new URL(request.url()).pathname);
  });
  return paths;
}

async function stableApp(page: Page) {
  await expect(page.getByLabel('Current user')).toContainText('River Vale');
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
  // Observation window only, after readiness: catch repeated document/guard bounces.
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL('/app/incidents');
  await expect(page.getByLabel('Current user')).toContainText('River Vale');
}

test('anonymous protected entry returns once after committed login and stays authenticated', async ({
  page,
}) => {
  const escaped: string[] = [];
  const intercepted: string[] = [];
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/mock-api/auth/')) {
      if (response.fromServiceWorker()) intercepted.push(path);
      else escaped.push(path);
    }
  });
  await page.goto('/app/incidents');
  await expect(page).toHaveURL('/login?returnTo=%2Fapp%2Fincidents');
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/app/incidents');
  const paths = navigations(page);
  await signIn(page);
  await stableApp(page);
  expect(paths).toEqual(['/app/incidents']);
  expect(intercepted).toContain('/mock-api/auth/login');
  expect(intercepted).toContain('/mock-api/auth/session');
  expect(escaped).toEqual([]);
});

test('authenticated full reload restores without visiting login', async ({ page }) => {
  await page.goto('/login');
  await signIn(page);
  await stableApp(page);
  const paths = navigations(page);
  const response = await page.reload();
  expect(await response?.text()).toContain('Restoring your session');
  await stableApp(page);
  expect(paths).toEqual(['/app/incidents']);
});

test('landing login, room navigation and a second logout/login cycle remain stable', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in to the fictional workspace' }).click();
  await signIn(page);
  await stableApp(page);
  await page
    .getByRole('list', { name: 'Incidents', exact: true })
    .getByRole('link')
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /INC-\d+/, level: 1 })).toBeVisible();
  await navigateApp(page, 'Incidents');
  await stableApp(page);
  await signOut(page);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.goto('/app/incidents');
  await expect(page).toHaveURL('/login?returnTo=%2Fapp%2Fincidents');
  const paths = navigations(page);
  await signIn(page);
  await stableApp(page);
  expect(paths).toEqual(['/app/incidents']);
});

test('development effect replay restores writable Timeline and Thread composers across reload', async ({
  page,
}) => {
  await page.goto('/login');
  await signIn(page);
  await stableApp(page);
  await page.goto('/app/incidents/INC-2841');
  const timeline = page.getByRole('form', { name: 'Timeline compose' });
  await expect(timeline.getByLabel('Message', { exact: true })).toBeEnabled();
  await timeline.getByLabel('Message', { exact: true }).fill('Development Timeline delivery');
  await timeline.getByRole('button', { name: 'Send', exact: true }).click();
  const entry = page
    .locator('[data-entry-id]')
    .filter({ hasText: 'Development Timeline delivery' });
  await expect(entry).toHaveCount(1);
  await expect(entry).toHaveAttribute('data-entry-id', /^fictional-incident-2841:msg-/);
  await entry.getByRole('button', { name: /^Open Thread for/ }).click();
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  await expect(thread.getByLabel('Message', { exact: true })).toBeEnabled();
  await thread.getByLabel('Message', { exact: true }).fill('Development Thread delivery');
  await thread.getByRole('button', { name: 'Send', exact: true }).click();
  const reply = thread
    .locator('[data-entry-id]')
    .filter({ hasText: 'Development Thread delivery' });
  await expect(reply).toHaveCount(1);
  await expect(reply).toHaveAttribute('data-entry-id', /:reply-/);
  await thread.getByLabel('Message', { exact: true }).fill('Retained development Thread draft');
  await thread.getByRole('button', { name: 'Back to Timeline / Close Thread' }).click();
  await expect(thread).toBeHidden();
  await expect(page).toHaveURL('/app/incidents/INC-2841');
  await entry.getByRole('button', { name: /^Open Thread for/ }).click();
  await expect(thread.getByLabel('Message', { exact: true })).toHaveValue(
    'Retained development Thread draft',
  );
  await expect(page).toHaveURL(/\?thread=fictional-incident-2841%3Amsg-/);
  await page.reload();
  await expect(thread.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(thread.getByLabel('Message', { exact: true })).toHaveValue(
    'Retained development Thread draft',
  );
  await expect(
    thread.locator('[data-entry-id]').filter({ hasText: 'Development Thread delivery' }),
  ).toHaveCount(1);
  await expect(page.getByLabel('Current user')).toContainText('River Vale');
});

for (const size of [10000, 50000]) {
  test(`development ${size} stress window remains scrollable and Reset Demo restores authentication`, async ({
    page,
  }) => {
    await page.goto('/login');
    await signIn(page);
    await stableApp(page);
    await openDemo(page);
    await page.getByLabel('Timeline stress size').selectOption(String(size));
    page.once('dialog', (dialog) => dialog.accept());
    const dataset = page.waitForResponse(
      (response) =>
        response.url().includes('/mock-api/incidents/INC-2841/timeline') &&
        response.request().method() === 'GET',
    );
    await page.getByRole('button', { name: 'Replace showcase dataset' }).click();
    expect((await (await dataset).json()).total).toBe(size);
    const viewport = page.getByLabel('Timeline viewport', { exact: true });
    await expect(
      page.locator(`[data-entry-id="fictional-incident-2841:evt-${size}"]`),
    ).toBeVisible();
    await viewport.press('Home');
    await expect(page.locator('[data-entry-id]').first()).toBeVisible();
    expect(await page.locator('[data-entry-id]').count()).toBeLessThan(80);
    await viewport.press('End');
    await expect(
      page.locator(`[data-entry-id="fictional-incident-2841:evt-${size}"]`),
    ).toBeVisible();
    const targetWindow = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === '/mock-api/incidents/INC-2841/timeline' &&
        url.searchParams.has('cursor') &&
        response.request().method() === 'GET'
      );
    });
    await page.goto('/app/incidents/INC-2841?event=fictional-incident-2841:evt-42');
    expect((await (await targetWindow).json()).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'fictional-incident-2841:evt-42' })]),
    );
    await expect(page.locator('[data-entry-id="fictional-incident-2841:evt-42"]')).toContainText(
      'Navigation target',
    );
    expect(await page.locator('[data-entry-id]').count()).toBeLessThan(80);
    await openDemo(page);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Reset Demo data' }).click();
    await expect(page).toHaveURL(/\/login/);
    await signIn(page);
    await stableApp(page);
    await page.goto('/app/incidents/INC-2841');
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await expect(page.getByLabel('Current user')).toContainText('River Vale');
  });
}
