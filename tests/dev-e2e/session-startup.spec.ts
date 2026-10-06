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
  await page.getByRole('link', { name: 'Incidents', exact: true }).click();
  await stableApp(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.goto('/app/incidents');
  await expect(page).toHaveURL('/login?returnTo=%2Fapp%2Fincidents');
  const paths = navigations(page);
  await signIn(page);
  await stableApp(page);
  expect(paths).toEqual(['/app/incidents']);
});
