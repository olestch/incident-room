import { test, expect } from '@playwright/test';
import { navigateApp } from './shell-helpers';
test('secondary navigation and inbox summary remain stable without development query errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use demo account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Current user')).toContainText('River Vale');
  await navigateApp(page, 'Notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(page.locator('main').getByLabel('0 unread notifications')).toHaveText('0');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(page.locator('main').getByLabel('0 unread notifications')).toHaveText('0');
  for (const name of ['Search', 'Team', 'Settings']) {
    await navigateApp(page, name);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
