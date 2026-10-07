import { expect, test } from '@playwright/test';

test('clean development browser hydrates public and auth pages and the authenticated redirect', async ({
  page,
}) => {
  const errors: string[] = [];
  const hydrationWarnings: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      ['error', 'warning'].includes(message.type()) &&
      /hydrat|didn.t match|server.rendered/i.test(message.text())
    )
      hydrationWarnings.push(message.text());
  });
  for (const path of ['/', '/login', '/register', '/forgot-password']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (path !== '/') await expect(page.getByLabel('Email', { exact: true })).toBeEditable();
  }
  await page.goto('/app/incidents');
  await expect(page).toHaveURL('/login?returnTo=%2Fapp%2Fincidents');
  await page.getByRole('button', { name: 'Use demo account' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Current user')).toContainText('River Vale');
  await page.goto('/register');
  await expect(page).toHaveURL('/app/incidents');
  await expect(page.getByLabel('Current user')).toContainText('River Vale');
  expect(hydrationWarnings).toEqual([]);
  expect(errors).toEqual([]);
});
