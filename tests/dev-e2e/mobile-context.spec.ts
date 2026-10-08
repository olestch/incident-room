import { expect, test } from '@playwright/test';

test('development effect replay keeps one mobile context sheet and the existing Timeline mount', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use demo account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
  await page.goto('/app/incidents/INC-2841');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const viewport = page.getByLabel('Timeline viewport', { exact: true });
  await viewport.evaluate((element) => element.setAttribute('data-mount-check', 'retained'));
  const trigger = page.getByRole('button', { name: 'Incident context', exact: true });
  const sheet = page.getByRole('dialog', { name: 'Incident context', exact: true });
  for (let cycle = 0; cycle < 2; cycle++) {
    await trigger.click();
    await expect(sheet).toHaveCount(1);
    await expect(sheet).toContainText('Commander');
    await expect(sheet.getByRole('button', { name: 'Close Incident context' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(viewport).toHaveAttribute('data-mount-check', 'retained');
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(
    page.getByRole('complementary', { name: 'Incident context', exact: true }),
  ).toBeVisible();
  await expect(viewport).toHaveAttribute('data-mount-check', 'retained');
  expect(errors).toEqual([]);
});
