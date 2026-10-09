import { test, expect, type Page } from '@playwright/test';
import { navigateApp, signOut } from './shell-helpers';
async function login(page: Page, email = 'river.vale@example.test') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Fictional-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
}
const inboxRows = (page: Page) =>
  page.getByRole('list', { name: 'Notifications', exact: true }).locator(':scope > li');
test('native confirmation is named, traps focus, cancels safely and fits all accepted widths and system preferences', async ({
  page,
}) => {
  const native: string[] = [];
  page.on('dialog', (dialog) => {
    native.push(dialog.type());
    void dialog.dismiss();
  });
  await login(page);
  const opener = page.getByRole('button', { name: 'Create Incident', exact: true });
  await opener.click();
  await page.getByLabel('Title (required)').fill('Retained fictional incident draft');
  const form = page.getByRole('dialog', { name: 'Create Incident', exact: true });
  for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Discard incident draft?', exact: true });
    await expect(dialog).toHaveAccessibleDescription(/has not been created/);
    const safe = dialog.getByRole('button', { name: 'Keep editing', exact: true });
    const discard = dialog.getByRole('button', { name: 'Discard changes', exact: true });
    await expect(safe).toBeFocused();
    await safe.press('Shift+Tab');
    await expect(discard).toBeFocused();
    await discard.press('Tab');
    await expect(safe).toBeFocused();
    await page
      .getByRole('button', { name: 'Commands', exact: true })
      .evaluate((e) => (e as HTMLElement).focus());
    await expect(safe).toBeFocused();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    for (const button of await dialog.getByRole('button').all()) {
      const rect = (await button.boundingBox())!;
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(rect.height).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Title (required)')).toHaveValue(
      'Retained fictional incident draft',
    );
    await expect(form.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  }
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.mouse.click(1, 1);
  await expect(
    page.getByRole('dialog', { name: 'Discard incident draft?', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Title (required)')).toHaveValue(
    'Retained fictional incident draft',
  );
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(native).toEqual([]);
});
test('baseline inbox persists read state, switches recipients and never duplicates rows on reload', async ({
  page,
}) => {
  await login(page);
  await navigateApp(page, 'Notifications');
  await expect(inboxRows(page)).toHaveCount(2);
  await expect(page.locator('main').getByLabel('1 unread notifications')).toHaveText('1');
  await expect(
    inboxRows(page).filter({ has: page.getByText('Unread', { exact: true }) }),
  ).toHaveCount(1);
  await inboxRows(page)
    .filter({ hasText: 'Queue measurements discussion' })
    .getByRole('button', { name: 'Mark read', exact: true })
    .click();
  await expect(page.locator('main').getByLabel('0 unread notifications')).toHaveText('0');
  await page.reload();
  await expect(inboxRows(page)).toHaveCount(2);
  await expect(page.locator('main').getByLabel('0 unread notifications')).toHaveText('0');
  await signOut(page);
  await login(page, 'sage.linden@example.test');
  await navigateApp(page, 'Notifications');
  await expect(inboxRows(page)).toHaveCount(4);
  await expect(page.locator('main').getByLabel('3 unread notifications')).toHaveText('3');
  await expect(inboxRows(page).filter({ hasText: 'Sage Linden replied' })).toHaveCount(0);
  await expect(
    inboxRows(page).filter({ has: page.getByText('Unread', { exact: true }) }),
  ).toHaveCount(3);
  await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(page.locator('main').getByLabel('0 unread notifications')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Mark all as read', exact: true })).toBeDisabled();
  await page.reload();
  await expect(inboxRows(page)).toHaveCount(4);
  await expect(
    inboxRows(page).getByRole('button', { name: 'Mark unread', exact: true }),
  ).toHaveCount(4);
  await signOut(page);
  await login(page);
  await navigateApp(page, 'Notifications');
  await expect(inboxRows(page)).toHaveCount(2);
  await expect(page.locator('main').getByLabel('0 unread notifications')).toHaveText('0');
});
test('every seeded notification opens existing exact evidence and inbox rows fit supported widths', async ({
  page,
}) => {
  for (const email of ['river.vale@example.test', 'sage.linden@example.test']) {
    await login(page, email);
    await navigateApp(page, 'Notifications');
    await expect(inboxRows(page)).toHaveCount(email.startsWith('river') ? 2 : 4);
    for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(await page.locator('.notification-row a button, .notification-row a a').count()).toBe(
        0,
      );
    }
    const destinations = await inboxRows(page)
      .getByRole('link')
      .evaluateAll((links) =>
        links.map((link) => ({ text: link.textContent!, href: link.getAttribute('href')! })),
      );
    for (const destination of destinations) {
      await page.getByRole('link', { name: destination.text, exact: true }).click();
      await expect(page).toHaveURL((url) => url.pathname + url.search === destination.href);
      const url = new URL(page.url()),
        id = url.searchParams.get('message') ?? url.searchParams.get('event')!;
      await expect(
        page.locator('[data-entry-id]').filter({ hasText: 'Navigation target' }),
      ).toHaveAttribute('data-entry-id', id);
      await navigateApp(page, 'Notifications');
      await expect(inboxRows(page)).toHaveCount(destinations.length);
    }
    await signOut(page);
  }
});
