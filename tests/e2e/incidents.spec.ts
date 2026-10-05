import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, email = 'river.vale@example.test') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Fictional-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
}
test('filters, URL reload/history, cursor pagination and clear filters', async ({ page }) => {
  await login(page);
  await expect(
    page.getByRole('list', { name: 'Incidents', exact: true }).getByRole('listitem'),
  ).toHaveCount(12);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(
    page.getByRole('list', { name: 'Incidents', exact: true }).getByRole('listitem'),
  ).toHaveCount(24);
  await page.getByLabel('P1 · Critical', { exact: true }).click();
  await expect(page.getByLabel('P1 · Critical', { exact: true })).toBeChecked();
  await expect(page).toHaveURL(/severity=P1/);
  await page.getByLabel('Investigating', { exact: true }).click();
  await expect(page.getByLabel('Investigating', { exact: true })).toBeChecked();
  await expect(page).toHaveURL(/status=investigating/);
  const list = page.getByRole('list', { name: 'Incidents', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  for (const row of await list.getByRole('listitem').all()) {
    await expect(row).toContainText('P1 · Critical');
    await expect(row).toContainText('Investigating');
  }
  await page.reload();
  await expect(page.getByLabel('P1 · Critical')).toBeChecked();
  await expect(page.getByLabel('Investigating')).toBeChecked();
  await page.getByLabel('Sort', { exact: true }).selectOption('newest');
  await expect(page).toHaveURL(/sort=newest/);
  await page.goBack();
  await expect(page.getByLabel('Sort', { exact: true })).toHaveValue('updated');
  await page.goForward();
  await expect(page.getByLabel('Sort', { exact: true })).toHaveValue('newest');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.getByLabel('P1 · Critical')).not.toBeChecked();
  await expect(page.getByLabel('Investigating')).not.toBeChecked();
  await expect(list.getByRole('listitem')).toHaveCount(12);
  await page.goto(
    '/app/incidents?status=invalid,monitoring&severity=P4,bad&participant=unknown&from=2026-02-30&tracking=keep',
  );
  await expect(page.getByLabel('Monitoring', { exact: true })).toBeChecked();
  await expect(page.getByLabel('P4 · Low')).toBeChecked();
  await expect(page.getByLabel('Participant', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Created from (UTC)')).toHaveValue('');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page).toHaveURL(/tracking=keep/);
});
test('My Incidents uses current stable identity; dates and participant apply to createdAt', async ({
  page,
}) => {
  await login(page, 'sage.linden@example.test');
  await page.getByRole('link', { name: 'My Incidents', exact: true }).click();
  await expect(page).toHaveURL('/app/incidents?assignedToMe=true');
  await expect(page.getByLabel('Assigned to me')).toBeChecked();
  for (const row of await page
    .getByRole('list', { name: 'Incidents', exact: true })
    .getByRole('listitem')
    .all())
    await expect(row).toContainText(/Participants.*Sage Linden/);
  await page.getByLabel('Participant', { exact: true }).selectOption('demo-river');
  await page.getByLabel('Created from (UTC)').fill('2026-09-01');
  await page.getByLabel('Created through (UTC)').fill('2026-09-01');
  await expect(
    page.getByRole('list', { name: 'Incidents', exact: true }).getByRole('listitem'),
  ).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toContainText(
    'INC-2841',
  );
});
test('create validates, preserves state on resize, navigates to real detail and returns to updated list', async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await login(page, 'sage.linden@example.test');
  await page.getByRole('button', { name: 'Create Incident', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Incident', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Create Incident', exact: true }).click();
  await expect(page.getByText('Enter a title.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Title (required)')).toBeFocused();
  await page.getByLabel('Title (required)').fill('Fictional routing degradation');
  await page.getByLabel('Description', { exact: true }).fill('A clean-room test incident.');
  await page.getByLabel('Severity (required)').selectOption('P2');
  await page.getByLabel('Aurora Edge', { exact: true }).check();
  await page.getByLabel('River Vale', { exact: true }).check();
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByLabel('Title (required)')).toHaveValue('Fictional routing degradation');
  const box = await dialog.boundingBox();
  expect(box?.width).toBe(320);
  expect(box?.x).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: 'Create Incident', exact: true }).click();
  await expect(page).toHaveURL('/app/incidents/INC-2873');
  await expect(
    page.getByRole('heading', { name: /INC-2873.*Fictional routing degradation/ }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /INC-2873/ })).toBeFocused();
  await expect(page.getByLabel('Incident detail')).toContainText('Commander: Sage Linden');
  await expect(page.getByLabel('Incident detail')).toContainText(
    'Participants (2): Sage Linden, River Vale',
  );
  await expect(page.getByLabel('Incident detail')).toContainText('Triggered');
  await expect(page.getByLabel('Incident detail')).toContainText('Aurora Edge');
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
  await expect(
    page.getByText('No Timeline entries yet. The first message will start this incident history.'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Back to incidents', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toContainText(
    'INC-2873',
  );
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  expect(browserErrors).toEqual([]);
});
test('dirty close warns, keeps form on cancel, returns focus; detail missing and resolved states', async ({
  page,
}) => {
  await login(page);
  const trigger = page.getByRole('button', { name: 'Create Incident', exact: true });
  await trigger.click();
  await page.getByLabel('Title (required)').fill('Unsaved fictional work');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Title (required)')).toHaveValue('Unsaved fictional work');
  page.once('dialog', (dialog) => dialog.accept());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.goto('/app/incidents/INC-9999');
  await expect(page.getByLabel('Incident detail').getByRole('alert')).toContainText(
    'Incident not found.',
  );
  await page.goto('/app/incidents/INC-2845');
  await expect(page.getByLabel('Incident detail')).toContainText('Operational writes are closed.');
});

test('concurrent tabs allocate unique numbers and persist confirmed incidents across reload', async ({
  page,
  context,
}) => {
  await login(page, 'sage.linden@example.test');
  const other = await context.newPage();
  await other.goto('/app/incidents');
  await expect(other.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
  for (const [tab, title] of [
    [page, 'First fictional concurrent incident'],
    [other, 'Second fictional concurrent incident'],
  ] as const) {
    await tab.getByRole('button', { name: 'Create Incident', exact: true }).click();
    await tab.getByLabel('Title (required)').fill(title);
    await tab.getByLabel('Severity (required)').selectOption('P1');
  }
  await Promise.all(
    [page, other].map((tab) =>
      tab.getByRole('dialog').getByRole('button', { name: 'Create Incident', exact: true }).click(),
    ),
  );
  await expect(page).toHaveURL(/\/app\/incidents\/INC-287[34]$/);
  await expect(other).toHaveURL(/\/app\/incidents\/INC-287[34]$/);
  expect(page.url()).not.toBe(other.url());
  await page.reload();
  await expect(
    page.getByRole('heading', { name: /First fictional concurrent incident/ }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Back to incidents', exact: true }).click();
  const list = page.getByRole('list', { name: 'Incidents', exact: true });
  await expect(list).toContainText('First fictional concurrent incident');
  await expect(list).toContainText('Second fictional concurrent incident');
  await expect(page.getByRole('status').filter({ hasText: 'of 34 incidents' })).toBeVisible();
  await other.close();
});
