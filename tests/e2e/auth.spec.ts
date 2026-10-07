import { navigateApp, signOut } from './shell-helpers';
import { expect, test, type Page } from '@playwright/test';

const password = 'Fictional-pass-42';
async function signIn(page: Page, email = 'river.vale@example.test') {
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Password', { exact: true }).press('Enter');
}
async function expireAuthority(page: Page, refreshEligible: boolean) {
  // Test-only fixture: mutate only fictional authority leases, never expose a product control.
  await page.evaluate(async (eligible) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('incident-room-fictional-authority-v1', 1);
      open.onerror = () => reject(new Error('Unable to open fictional authority'));
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('auth-authority', 'readwrite');
        const store = tx.objectStore('auth-authority');
        const get = store.get('singleton');
        get.onsuccess = () => {
          const data = get.result;
          for (const lease of Object.values(data.clients) as {
            expiresAt: number;
            refreshUntil: number;
          }[]) {
            lease.expiresAt = 0;
            if (!eligible) lease.refreshUntil = 0;
          }
          store.put(data, 'singleton');
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(new Error('Unable to change fictional lease'));
        };
      };
    });
  }, refreshEligible);
}

test('protected redirect, login, reload, logout and identity switch stay isolated', async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/app/incidents');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp%2Fincidents/);
  await signIn(page);
  await expect(page).toHaveURL('/app/incidents');
  await expect(page.getByLabel('Current user')).toContainText('River Vale');
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Current user')).toContainText('River Vale');
  await signOut(page);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByLabel('Current user')).toHaveCount(0);
  await page.goto('/app/incidents');
  await expect(page).toHaveURL(/\/login\?/);
  await signIn(page, 'sage.linden@example.test');
  await expect(page.getByLabel('Current user')).toContainText('Sage Linden');
  await expect(page.getByLabel('Current user')).not.toContainText('River Vale');
  // Workspace incident commanders remain readable; only identity-owned profile changes.
  await navigateApp(page, 'My Incidents');
  await expect(page.getByRole('checkbox', { name: 'Assigned to me', exact: true })).toBeChecked();
  expect(browserErrors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('preserves the exact deep query and hash through auth and public-page navigation', async ({
  page,
}) => {
  const destination = '/app/incidents/INC-2841?event=evt-10&thread=evt-10#context';
  await page.goto(destination);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  const returnTo = new URL(page.url()).searchParams.get('returnTo');
  expect(returnTo).toBe(destination);
  await page.getByRole('link', { name: 'Forgot password?', exact: true }).click();
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await signIn(page);
  await expect(page).toHaveURL(destination);
  await expect(page.getByRole('heading', { name: /INC-2841/ })).toBeVisible();
});
test('unsafe external return falls back to the application', async ({ page }) => {
  await page.goto('/login?returnTo=https%3A%2F%2Fevil.example');
  await signIn(page);
  await expect(page).toHaveURL('/app/incidents');
});
test('registration creates a fictional identity that restores after reload', async ({
  page,
}, info) => {
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  await page.getByLabel('Display name').fill('Nova Reed');
  await page.getByLabel('Email', { exact: true }).fill(`nova-${info.project.name}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill('Another-fictional-42');
  await page.getByLabel('Confirm password').fill('Another-fictional-42');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page).toHaveURL('/app/incidents');
  await expect(page.getByLabel('Current user')).toContainText('Nova Reed');
  await page.reload();
  await expect(page.getByLabel('Current user')).toContainText('Nova Reed');
});
test('forgot password gives generic confirmation', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill('nobody@example.test');
  await page.getByRole('button', { name: 'Request password reset' }).click();
  await expect(
    page.getByText('If an account exists for this email', { exact: false }),
  ).toBeVisible();
});
test('expired access restores through refresh; terminal expiry redirects with reason and destination', async ({
  page,
}) => {
  await page.goto('/login');
  await signIn(page);
  await expect(page.getByLabel('Current user')).toContainText('River Vale');
  await expireAuthority(page, true);
  await page.reload();
  await expect(page.getByLabel('Current user')).toContainText('River Vale');
  await expect(page).toHaveURL('/app/incidents');
  await expireAuthority(page, false);
  await page.reload();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fapp%2Fincidents&reason=expired/);
  await expect(page.getByText('Your session expired. Please sign in again.')).toBeVisible();
  await expect(page.getByLabel('Current user')).toHaveCount(0);
});
test('authenticated login/register redirects, and unknown protected routes remain not found', async ({
  page,
}) => {
  await page.goto('/login');
  await signIn(page);
  await expect(page.getByLabel('Current user')).toBeVisible();
  await page.goto('/register');
  await expect(page).toHaveURL('/app/incidents');
  await page.goto('/app/unknown-route');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
test('auth forms remain keyboard-accessible without overflow on narrow and tablet viewports', async ({
  page,
}) => {
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/login', '/register', '/forgot-password']) {
      await page.goto(path);
      await expect(page.getByRole('form')).toBeVisible();
      await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
        'autocomplete',
        path === '/login' ? 'username' : 'email',
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    }
  }
});
