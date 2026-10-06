import { expect, test } from '@playwright/test';

test('public shell supports keyboard access and a narrow viewport without runtime errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle('Incident Room');
  await expect(page.getByRole('heading', { name: 'Incident Room', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Realtime coordination, from investigation to Postmortem' }),
  ).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('an unknown route offers recovery to the public shell', async ({ page }) => {
  const response = await page.goto('/unavailable-foundation-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Return to Incident Room' }).click();
  await expect(page.getByRole('heading', { name: 'Incident Room', exact: true })).toBeVisible();
});
