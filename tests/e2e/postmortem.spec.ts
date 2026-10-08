import { navigateApp } from './shell-helpers';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
const number = 'INC-2865';
async function login(page: Page, email = 'river.vale@example.test') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Fictional-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
}
async function initiate(page: Page, incident = number) {
  await login(page);
  await page.goto(`/app/incidents/${incident}`);
  if (await page.evaluate(() => matchMedia('(max-width: 63.99rem)').matches))
    await page.getByRole('button', { name: 'Incident context', exact: true }).click();
  await page.getByRole('link', { name: 'Create Postmortem', exact: true }).click();
  await expect(page.getByText('Postmortem has not been initiated.')).toBeVisible();
  await page.getByRole('button', { name: 'Initiate Postmortem', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Postmortem editor' })).toBeVisible();
}
async function pair(context: BrowserContext, page: Page) {
  await initiate(page);
  await context.clearCookies();
  const second = await context.newPage();
  await login(second, 'sage.linden@example.test');
  await second.goto(`/app/incidents/${number}/postmortem`);
  await expect(second.getByRole('form', { name: 'Postmortem editor' })).toBeVisible();
  return second;
}
async function save(page: Page, text: string) {
  await page.getByLabel('Summary', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Save Postmortem', exact: true }).click();
  await expect(
    page.getByRole('form', { name: 'Postmortem editor' }).getByText('Saved.', { exact: true }),
  ).toBeVisible();
}
async function createAction(page: Page) {
  await page.getByRole('button', { name: 'Add Action Item', exact: true }).click();
  const form = page.getByRole('form', { name: 'Create Action Item', exact: true });
  await form.getByLabel('Action title', { exact: true }).fill('Verify recovery guard');
  await form
    .getByLabel('Action description', { exact: true })
    .fill('Independent fictional follow-up.');
  await form.getByLabel('Assignee', { exact: true }).selectOption('demo-sage');
  await form.getByLabel('Due date', { exact: true }).fill('2026-11-03');
  await form.getByRole('button', { name: 'Create Action Item', exact: true }).click();
  await expect(
    page.getByRole('form', { name: 'Edit Action Item Verify recovery guard', exact: true }),
  ).toBeVisible();
  const editor = page.getByRole('form', {
    name: 'Edit Action Item Verify recovery guard',
    exact: true,
  });
  await editor.getByRole('button', { name: 'Edit Action Item', exact: true }).click();
  return editor;
}
test('resolved commander initiates shared draft, saves all structured sections and persists reload', async ({
  page,
}) => {
  await initiate(page);
  await page.getByLabel('Impact', { exact: true }).fill('Aurora edge users experienced delays.');
  await page.getByLabel('Root Cause', { exact: true }).fill('A fictional capacity boundary.');
  await page.getByLabel('Resolution', { exact: true }).fill('Restored the fictional worker pool.');
  await save(page, 'Recovered safely.');
  await page.reload();
  await expect(page.getByLabel('Summary', { exact: true })).toHaveValue('Recovered safely.');
  await expect(page.getByLabel('Impact', { exact: true })).toHaveValue(
    'Aurora edge users experienced delays.',
  );
  await expect(page.getByText(/Shared draft · Revision 2/)).toBeVisible();
});
test('active Incident has no Postmortem entry and direct route refuses creation/editing', async ({
  page,
}) => {
  await login(page);
  await page.goto('/app/incidents/INC-2841');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('INC-2841');
  await expect(page.getByRole('link', { name: /Postmortem/ })).toHaveCount(0);
  await page.goto('/app/incidents/INC-2841/postmortem');
  await expect(
    page.getByText('Postmortem is available only for Resolved incidents.'),
  ).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
});
test('nonparticipant workspace member reads existing Postmortem and Action Items with no mutations', async ({
  page,
  context,
}) => {
  await initiate(page, 'INC-2845');
  await save(page, 'Workspace-visible postmortem.');
  await createAction(page);
  await context.clearCookies();
  const reader = await context.newPage();
  await login(reader, 'sage.linden@example.test');
  await reader.goto('/app/incidents/INC-2845/postmortem');
  await expect(reader.getByText('Workspace-visible postmortem.')).toBeVisible();
  await expect(
    reader.getByText('Read-only · Workspace member viewing this Postmortem.'),
  ).toBeVisible();
  await expect(reader.getByRole('textbox')).toHaveCount(0);
  await expect(reader.getByRole('button', { name: /Save|Add Action|Initiate/ })).toHaveCount(0);
  await expect(
    reader.getByRole('article').filter({ hasText: 'Verify recovery guard' }),
  ).toBeVisible();
});
test('participant saves and clean second editor adopts confirmed realtime revision', async ({
  page,
  context,
}) => {
  const participant = await pair(context, page);
  await save(participant, 'Participant recovery notes.');
  await expect(page.getByLabel('Summary', { exact: true })).toHaveValue(
    'Participant recovery notes.',
  );
  await expect(page.getByText(/Based on revision 2/)).toBeVisible();
  await expect(page.getByText(/A newer server revision exists/)).toHaveCount(0);
});
test('dirty editor survives remote update; stale save conflicts and reload retains local reference', async ({
  page,
  context,
}) => {
  const second = await pair(context, page);
  await page.getByLabel('Summary', { exact: true }).fill('Local unsaved analysis.');
  await save(second, 'Newer server analysis.');
  await expect(page.getByText(/A newer server revision exists/)).toBeVisible();
  await expect(page.getByLabel('Summary', { exact: true })).toHaveValue('Local unsaved analysis.');
  await page.getByRole('button', { name: 'Save Postmortem', exact: true }).click();
  await expect(
    page.getByText('A newer Postmortem revision exists. Your local edits were not saved.'),
  ).toBeVisible();
  await expect(second.getByLabel('Summary', { exact: true })).toHaveValue('Newer server analysis.');
  await page.getByRole('button', { name: 'Review latest', exact: true }).click();
  await expect(page.getByLabel('Latest server version')).toContainText('Newer server analysis.');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await expect(page.getByLabel('Summary', { exact: true })).toHaveValue('Local unsaved analysis.');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await expect(page.getByLabel('Summary', { exact: true })).toHaveValue('Newer server analysis.');
  await page.getByText('Retained local reference (not saved)').click();
  await expect(page.getByText('Local unsaved analysis.', { exact: true })).toBeVisible();
});
test('Action Item date-only assignment/status persist and card controls fit mobile', async ({
  page,
}) => {
  await initiate(page);
  const item = await createAction(page);
  await item.getByLabel('Action status', { exact: true }).selectOption('in_progress');
  await item.getByRole('button', { name: 'Save Action Item', exact: true }).click();
  await expect(item.getByText('Saved.', { exact: true })).toBeVisible();
  await page.reload();
  const restored = page.getByRole('form', {
    name: 'Edit Action Item Verify recovery guard',
    exact: true,
  });
  await restored.getByRole('button', { name: 'Edit Action Item', exact: true }).click();
  await expect(restored.getByLabel('Due date', { exact: true })).toHaveValue('2026-11-03');
  await expect(restored.getByLabel('Assignee', { exact: true })).toHaveValue('demo-sage');
  await expect(restored.getByLabel('Action status', { exact: true })).toHaveValue('in_progress');
  await restored.getByLabel('Action status', { exact: true }).selectOption('done');
  await restored.getByRole('button', { name: 'Save Action Item', exact: true }).click();
  await expect(restored.getByText('Saved.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('Action Item realtime updates converge once and stale item update cannot overwrite', async ({
  page,
  context,
}) => {
  const second = await pair(context, page);
  const item = await createAction(page);
  const other = second.getByRole('form', {
    name: 'Edit Action Item Verify recovery guard',
    exact: true,
  });
  await expect(other).toBeVisible();
  await other.getByRole('button', { name: 'Edit Action Item', exact: true }).click();
  await other.getByLabel('Action description', { exact: true }).fill('My unsaved item work.');
  await item.getByLabel('Action status', { exact: true }).selectOption('done');
  await item.getByRole('button', { name: 'Save Action Item', exact: true }).click();
  await expect(item.getByText('Saved.', { exact: true })).toBeVisible();
  await expect(other.getByText(/A newer server revision exists/)).toBeVisible();
  await expect(other.getByLabel('Action description', { exact: true })).toHaveValue(
    'My unsaved item work.',
  );
  await other.getByRole('button', { name: 'Save Action Item', exact: true }).click();
  await expect(
    other.getByText('A newer Action Item revision exists. Your local edits were not saved.'),
  ).toBeVisible();
  second.once('dialog', (dialog) => dialog.accept());
  await other.getByRole('button', { name: 'Reload latest', exact: true }).click();
  await expect(other.getByLabel('Action status', { exact: true })).toHaveValue('done');
  await expect(second.getByRole('form', { name: /^Edit Action Item/ })).toHaveCount(1);
});
test('clean Action Item viewer receives confirmed status without refresh or duplicate', async ({
  page,
  context,
}) => {
  const second = await pair(context, page);
  const item = await createAction(page);
  const other = second.getByRole('form', {
    name: 'Edit Action Item Verify recovery guard',
    exact: true,
  });
  await expect(other).toBeVisible();
  await other.getByRole('button', { name: 'Edit Action Item', exact: true }).click();
  await item.getByLabel('Action status', { exact: true }).selectOption('done');
  await item.getByRole('button', { name: 'Save Action Item', exact: true }).click();
  await expect(other.getByLabel('Action status', { exact: true })).toHaveValue('done');
  await expect(second.getByRole('form', { name: /^Edit Action Item/ })).toHaveCount(1);
});
test('offline dirty form survives reconnect and expired journal snapshot restores confirmed resources', async ({
  page,
  context,
}) => {
  const second = await pair(context, page);
  await second.getByLabel('Impact', { exact: true }).fill('Offline local impact notes.');
  await second.evaluate(() => window.dispatchEvent(new Event('offline')));
  await save(page, 'Server recovery during disconnection.');
  await createAction(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('incident-room-fictional-journal-v1', 1);
        open.onerror = () => reject(new Error('Fixture unavailable'));
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction('records', 'readwrite'),
            store = tx.objectStore('records'),
            get = store.get('demo-orbit');
          get.onsuccess = () => {
            const data = get.result;
            data.expireBefore = data.highWater;
            store.put(data, 'demo-orbit');
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(new Error('Fixture write failed'));
          };
        };
      }),
  );
  await second.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(
    second.getByRole('form', { name: 'Edit Action Item Verify recovery guard', exact: true }),
  ).toBeVisible();
  await expect(second.getByText(/A newer server revision exists/)).toBeVisible();
  await expect(second.getByLabel('Impact', { exact: true })).toHaveValue(
    'Offline local impact notes.',
  );
  await second.getByRole('button', { name: 'Review latest', exact: true }).click();
  await expect(second.getByLabel('Latest server version')).toContainText(
    'Server recovery during disconnection.',
  );
});
test('Timeline selections are references, chronological, tombstone-safe and separately removable', async ({
  page,
}) => {
  await initiate(page);
  await page.getByRole('button', { name: 'Select Timeline entries', exact: true }).click();
  await page.getByRole('button', { name: 'Older Timeline choices', exact: true }).click();
  await page.getByRole('button', { name: 'Older Timeline choices', exact: true }).click();
  const prefix = 'fictional-incident-2865';
  await page.getByLabel(`Include ${prefix}:evt-20`, { exact: true }).check();
  await page.getByLabel(`Include ${prefix}:evt-8`, { exact: true }).check();
  await page.getByRole('button', { name: 'Save Postmortem', exact: true }).click();
  await expect(
    page.getByRole('form', { name: 'Postmortem editor' }).getByText('Saved.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  const selected = page.getByRole('list', { name: 'Selected Timeline entries', exact: true });
  await expect(selected.getByRole('listitem')).toHaveCount(2);
  await expect(selected.getByRole('listitem').first()).toContainText(
    'Fictional response update 8.',
  );
  await expect(selected.getByRole('listitem').last()).toContainText('Deleted entry');
  await selected
    .getByRole('listitem')
    .last()
    .getByRole('button', { name: 'Remove reference', exact: true })
    .click();
  await page.getByRole('button', { name: 'Save Postmortem', exact: true }).click();
  await expect(selected.getByRole('listitem')).toHaveCount(1);
});
test('assignment notification links to canonical Postmortem and does not spam on status update', async ({
  page,
  context,
}) => {
  const second = await pair(context, page);
  const item = await createAction(page);
  await item.getByLabel('Action status', { exact: true }).selectOption('done');
  await item.getByRole('button', { name: 'Save Action Item', exact: true }).click();
  await expect(item.getByText('Saved.', { exact: true })).toBeVisible();
  await navigateApp(second, 'Notifications');
  const inbox = second.getByRole('list', { name: 'Notifications', exact: true });
  await expect(inbox.getByRole('listitem')).toHaveCount(2);
  await inbox
    .getByRole('link', { name: `${number}: Action Item assigned to you`, exact: true })
    .click();
  await expect(second).toHaveURL(new RegExp(`${number}/postmortem$`));
  await expect(
    second
      .getByRole('form', { name: /^Edit Action Item/ })
      .getByLabel('Action status', { exact: true }),
  ).toHaveValue('done');
});
test('dirty local navigation and palette respect confirmation; no horizontal overflow', async ({
  page,
}) => {
  await initiate(page);
  await page.getByLabel('Summary', { exact: true }).fill('Unsaved navigation evidence.');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'Back to Incident Room', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${number}/postmortem$`));
  await expect(page.getByLabel('Summary', { exact: true })).toHaveValue(
    'Unsaved navigation evidence.',
  );
  await page.getByRole('button', { name: 'Commands', exact: true }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('option', { name: /Go to Incidents/ }).click();
  await expect(page).toHaveURL(new RegExp(`${number}/postmortem$`));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('link', { name: 'Back to Incident Room', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${number}$`));
});

test('closing an Action Item editor preserves unsaved values through responsive changes', async ({
  page,
}) => {
  await initiate(page);
  const item = await createAction(page);
  await item.getByLabel('Action description', { exact: true }).fill('Unsaved follow-up evidence.');
  await item.getByRole('button', { name: 'Close editor', exact: true }).click();
  await expect(item.getByText(/Unsaved changes/)).toBeVisible();
  for (const width of [320, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await item.getByRole('button', { name: 'Edit Action Item', exact: true }).click();
  await expect(item.getByLabel('Action description', { exact: true })).toHaveValue(
    'Unsaved follow-up evidence.',
  );
  await item.getByRole('button', { name: 'Save Action Item', exact: true }).click();
  await expect(item.getByText('Saved.', { exact: true })).toBeVisible();
});
test('secondary surfaces and palette fit supported widths and system contrast preferences', async ({
  page,
}) => {
  await initiate(page);
  await createAction(page);
  for (const path of [
    '/app/search?q=Aurora',
    '/app/notifications',
    '/app/team',
    '/app/settings',
    `/app/incidents/${number}/postmortem`,
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const width of [320, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Commands', exact: true }).click();
  const input = page.getByRole('combobox', { name: 'Find a command or Incident' });
  await expect(input).toBeFocused();
  for (const width of [320, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const dialog = page.getByRole('dialog', { name: 'Command Palette' });
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await input.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Close palette', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(input).toBeFocused();
  await page.getByRole('button', { name: 'Commands', exact: true }).focus();
  await expect(input).toBeFocused();
  await input.press('ArrowDown');
  await expect(page.getByRole('option', { selected: true })).toContainText(
    'Show incidents assigned to me',
  );
  await input.press('Escape');
  await expect(page.getByRole('button', { name: 'Commands', exact: true })).toBeFocused();
});
