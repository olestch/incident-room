import { expect, test } from '@playwright/test';

test('public entry, anchors and static preview stay usable at all required widths', async ({
  page,
}) => {
  await page.goto('/');
  for (const width of [320, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Explore demo', exact: true })).toBeVisible();
    await expect(
      page.getByRole('figure', { name: 'Illustrative Incident Room preview' }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page.getByRole('button')).toHaveCount(0);
  }
  await page.getByRole('link', { name: 'See what’s inside' }).click();
  await expect(page).toHaveURL(/#capabilities$/);
  await page
    .getByRole('navigation', { name: 'Public navigation' })
    .getByRole('link', { name: 'Workflow', exact: true })
    .click();
  await expect(page).toHaveURL(/#workflow$/);
  await expect(page.getByRole('heading', { name: 'Resolved', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/olestch/incident-room',
  );
  await page.getByRole('link', { name: 'Enter demo workspace' }).click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
});

test('demo autofill waits for explicit submission and preserves a protected destination', async ({
  page,
}) => {
  await page.goto('/app/incidents/INC-2841?event=fictional-incident-2841%3Aevt-42');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  const loginURL = page.url();
  await page.getByRole('button', { name: 'Use demo account' }).click();
  await expect(page).toHaveURL(loginURL);
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('river.vale@example.test');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('Fictional-pass-42');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Show password', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await expect(page).toHaveURL(loginURL);
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('/app/incidents/INC-2841?event=fictional-incident-2841%3Aevt-42');
  await expect(page.getByLabel('Current user')).toContainText('River Vale');
});

test('all auth forms remain first and overflow-free at the required widths with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const path of ['/login', '/register', '/forgot-password']) {
    await page.goto(path);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    for (const width of [320, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const context = page.getByRole('complementary', { name: 'About Incident Room' });
      if (width < 1024) await expect(context).toBeHidden();
      else await expect(context).toBeVisible();
      if (path === '/login')
        await expect(page.getByRole('button', { name: 'Use demo account' })).toBeVisible();
      expect(
        await page
          .getByRole('button', {
            name:
              path === '/login'
                ? 'Sign in'
                : path === '/register'
                  ? 'Create an account'
                  : 'Request password reset',
            exact: true,
          })
          .evaluate((element) => getComputedStyle(element).transitionProperty),
      ).toBe('none');
    }
  }
});
