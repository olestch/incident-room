import { expect, type Page } from '@playwright/test';

export async function navigateApp(page: Page, name: string) {
  if (name === 'Search') {
    await page.getByRole('link', { name: 'Search workspace', exact: true }).click();
  } else if (name === 'Notifications') {
    await page.getByRole('link', { name: /^Activity Inbox,/ }).click();
  } else {
    const navigation = page.locator('.shell-sidebar').getByRole('link', { name, exact: true });
    if (await navigation.isVisible()) await navigation.click();
    else {
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Navigation', exact: true })
        .getByRole('link', { name, exact: true })
        .click();
    }
  }
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: /^User menu for / }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
}

export async function openDemo(page: Page) {
  const trigger = page
    .locator('.shell-sidebar')
    .getByRole('button', { name: 'Demo tools', exact: true });
  if (await trigger.isVisible()) await trigger.click();
  else {
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Navigation', exact: true })
      .getByRole('button', { name: 'Demo tools', exact: true })
      .click();
  }
  await expect(page.getByRole('dialog', { name: 'Demo tools', exact: true })).toBeVisible();
}
