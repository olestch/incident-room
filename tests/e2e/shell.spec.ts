import { expect, test, type Page } from '@playwright/test';
import { closeDemo, navigateApp, openDemo } from './shell-helpers';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('river.vale@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Fictional-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Current user')).toContainText('River Vale');
}

test('shell is responsive at all acceptance widths with truthful navigation and controls', async ({
  page,
}) => {
  await login(page);
  for (const width of [320, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.locator('.shell-topbar').evaluate((node) => node.getBoundingClientRect().height),
    ).toBe(56);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByRole('link', { name: 'Search workspace', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Commands', exact: true })).toBeVisible();
    if (width < 1024) {
      await expect(page.locator('.shell-sidebar')).not.toBeVisible();
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true });
      await expect(drawer.getByRole('link', { name: 'Incidents', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('button', { name: 'Open navigation', exact: true }),
      ).toBeFocused();
    } else {
      const sidebar = page.locator('.shell-sidebar');
      expect(await sidebar.evaluate((node) => node.getBoundingClientRect().width)).toBe(
        width < 1280 ? 64 : 216,
      );
      const incidents = sidebar.getByRole('link', { name: 'Incidents', exact: true });
      await incidents.focus();
      await expect(incidents).toBeFocused();
      if (width === 1024) await expect(incidents.locator('.shell-nav-tooltip')).toBeVisible();
    }
  }
  await navigateApp(page, 'My Incidents');
  await expect(page).toHaveURL('/app/incidents?assignedToMe=true');
  await expect(page.getByLabel('Assigned to me')).toBeChecked();
});

test('user popover supports keyboard, Escape restoration, light dismissal and real profile navigation', async ({
  page,
}) => {
  await login(page);
  const trigger = page.getByRole('button', { name: 'User menu for River Vale', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'My profile', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await page.getByRole('link', { name: 'Incident Room', exact: true }).click();
  await expect(page.getByRole('link', { name: 'My profile', exact: true })).not.toBeVisible();
  await trigger.click();
  await page.getByRole('link', { name: 'My profile', exact: true }).click();
  await expect(page).toHaveURL('/app/profile/demo-river');
  await expect(page.getByRole('heading', { name: 'River Vale', exact: true })).toBeVisible();
});

test('Demo drawer retains configuration and feedback across closure and app navigation', async ({
  page,
}) => {
  await login(page);
  await expect(page.getByRole('button', { name: 'Simulation active', exact: true })).toHaveCount(0);
  await openDemo(page);
  await page.getByLabel('Request latency').selectOption('500');
  await closeDemo(page);
  await expect(page.getByRole('button', { name: 'Simulation active', exact: true })).toBeVisible();
  await navigateApp(page, 'Search');
  await openDemo(page);
  await expect(page.getByLabel('Request latency')).toHaveValue('500');
  await expect(
    page.getByText('Demo configuration applied. Fault schedule restarted.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear simulations', exact: true }).click();
  await closeDemo(page);
  await expect(page.getByRole('button', { name: 'Simulation active', exact: true })).toHaveCount(0);
});

test('native drawer contains keyboard focus and excludes palette shortcuts', async ({ page }) => {
  await login(page);
  await openDemo(page);
  const drawer = page.getByRole('dialog', { name: 'Demo tools', exact: true });
  const close = drawer.getByRole('button', { name: 'Close Demo tools', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(drawer.getByRole('button', { name: 'Reset Demo data', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command Palette', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
});

test('shell utilities and breakpoint changes preserve Thread identity, draft, URL and bounded stream DOM', async ({
  page,
}) => {
  await login(page);
  await page.goto('/app/incidents/INC-2841?thread=fictional-incident-2841:evt-4000');
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  await expect(thread).toBeVisible();
  const compose = thread.getByRole('textbox', { name: 'Message', exact: true });
  await expect(compose).toBeEnabled();
  await compose.fill('Fictional draft survives shell presentation');
  const url = page.url();
  // Opening utilities is available beside a docked Thread; mobile keeps its full-screen surface.
  await page.setViewportSize({ width: 1440, height: 900 });
  const node = await thread.elementHandle();
  await openDemo(page);
  await closeDemo(page);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await node?.evaluate((element) => element.isConnected)).toBe(true);
  await expect(compose).toHaveValue('Fictional draft survives shell presentation');
  expect(page.url()).toBe(url);
  expect(await page.locator('[data-entry-id]').count()).toBeLessThan(160);
});

test('shell Search and notifications use canonical destinations and skip link reaches main', async ({
  page,
}) => {
  await login(page);
  const skip = page.getByRole('link', { name: 'Skip to main content', exact: true });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  const inbox = page.getByRole('link', {
    name: 'Activity Inbox, 0 unread notifications',
    exact: true,
  });
  await expect(inbox).toBeVisible();
  await expect(inbox.locator('.shell-unread')).toHaveCount(0);
  await navigateApp(page, 'Search');
  await expect(page).toHaveURL('/app/search');
  await navigateApp(page, 'Notifications');
  await expect(page).toHaveURL('/app/notifications');
});
