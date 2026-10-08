import { expect, test, type Page } from '@playwright/test';

const list = (page: Page) => page.getByRole('list', { name: 'Incidents', exact: true });
const filters = (page: Page) => page.getByRole('region', { name: 'Incident filters', exact: true });
async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('river.vale@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Fictional-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(list(page).getByRole('listitem')).toHaveCount(12);
}

test('severity rails, readable badges and lifecycle distinguish active and resolved rows', async ({
  page,
}) => {
  await login(page);
  const critical = list(page).locator('[data-severity="P1"]:not([data-status="resolved"])').first();
  const resolved = list(page).locator('[data-severity="P1"][data-status="resolved"]');
  const high = list(page).locator('[data-severity="P2"]:not([data-status="resolved"])').first();
  await expect(critical).toContainText('P1 Critical');
  await expect(high).toContainText('P2 High');
  await expect(resolved).toContainText('P1 Critical');
  await expect(resolved).toContainText('Resolved');
  const style = (row: typeof critical) =>
    row.evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      rail: getComputedStyle(element).borderLeftStyle,
      weight: getComputedStyle(element.querySelector('h2')!).fontWeight,
    }));
  expect((await style(critical)).background).not.toBe((await style(resolved)).background);
  expect((await style(critical)).weight).toBe('600');
  expect((await style(resolved)).weight).toBe('500');
  expect((await style(high)).rail).toBe('dashed');
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await critical.getByRole('link').focus();
  expect(await critical.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
    'solid',
  );
  await expect(critical.getByRole('link')).toBeFocused();
  expect((await style(high)).rail).toBe('dashed');
});

test('row metadata opens a native link in a new tab; keyboard enters the same room', async ({
  page,
  context,
}) => {
  await login(page);
  const row = list(page).getByRole('listitem').first();
  const link = row.getByRole('link');
  const destination = await link.getAttribute('href');
  await expect(row.getByRole('link')).toHaveCount(1);
  await expect(row.locator('button, input, select')).toHaveCount(0);
  const box = (await row.boundingBox())!;
  const opened = context.waitForEvent('page');
  await row.click({
    modifiers: ['ControlOrMeta'],
    position: { x: box.width - 12, y: box.height - 12 },
  });
  const newTab = await opened;
  await expect(newTab).toHaveURL(destination!);
  await newTab.close();
  await link.focus();
  await expect(link).toBeFocused();
  await link.press('Enter');
  await expect(page).toHaveURL(destination!);
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
});

test('one compact toolbar remains reachable at all widths and short heights without moving rows', async ({
  page,
}) => {
  await login(page);
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440]) {
    for (const height of [900, 360]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(filters(page)).toHaveAttribute('data-compact', 'false');
      const first = list(page).getByRole('listitem').first();
      const original = await first.evaluate(
        (element) => element.getBoundingClientRect().top + scrollY,
      );
      await page.evaluate(() => window.scrollTo(0, 700));
      await expect(filters(page)).toHaveAttribute('data-compact', 'true');
      await expect
        .poll(async () =>
          Math.abs(
            (await first.evaluate((element) => element.getBoundingClientRect().top + scrollY)) -
              original,
          ),
        )
        .toBeLessThanOrEqual(2);
      const bounds = (await filters(page).boundingBox())!;
      expect(bounds.y).toBe(56);
      expect(bounds.height).toBeLessThanOrEqual(width < 768 ? 96 : 64);
      if (width < 768) {
        expect(
          await filters(page).evaluate(
            (element) => element.nextElementSibling?.getBoundingClientRect().height,
          ),
        ).toBe(0);
        await expect(
          filters(page).getByRole('checkbox', { name: 'Assigned to me', exact: true }),
        ).toBeInViewport();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(page.getByRole('combobox', { name: 'Sort', exact: true })).toHaveCount(1);
      const toggle = filters(page).getByRole('button', { name: /^Filters/ });
      await toggle.focus();
      await toggle.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      if (width < 768) {
        expect((await filters(page).boundingBox())!.height).toBeCloseTo(bounds.height, 0);
        expect(
          Math.abs(
            (await first.evaluate((element) => element.getBoundingClientRect().top + scrollY)) -
              original,
          ),
        ).toBeLessThanOrEqual(2);
      }
      await expect(
        filters(page).getByRole('checkbox', { name: 'Assigned to me', exact: true }),
      ).toHaveCount(1);
      await filters(page)
        .getByRole('button', { name: /^Status filter/ })
        .click();
      await expect(page.getByRole('checkbox', { name: 'Triggered', exact: true })).toBeFocused();
      const option = (await page
        .getByRole('checkbox', { name: 'Triggered', exact: true })
        .boundingBox())!;
      expect(option.y).toBeGreaterThanOrEqual(56);
      expect(option.y + option.height).toBeLessThanOrEqual(height);
      await page.keyboard.press('Escape');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(filters(page).getByRole('button', { name: /^Status filter/ })).toHaveCount(0);
      const link = list(page).getByRole('listitem').nth(5).getByRole('link');
      await link.focus();
      await expect(link).toBeFocused();
      const focused = (await link.boundingBox())!;
      expect(focused.y).toBeGreaterThanOrEqual(56 + bounds.height);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(filters(page)).toHaveAttribute('data-compact', 'false');
    }
  }
});

test('scrolling with an open filter preserves focus and reveals that same filter in the compact toolbar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  const status = filters(page).getByRole('button', { name: /^Status filter/ });
  await status.click();
  const triggered = page.getByRole('checkbox', { name: 'Triggered', exact: true });
  await expect(triggered).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect(filters(page)).toHaveAttribute('data-compact', 'true');
  await expect(filters(page).getByRole('button', { name: /^Filters/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(triggered).toBeFocused();
  await expect(status).toHaveCount(1);
  await expect(triggered).toHaveCount(1);
  await page.setViewportSize({ width: 320, height: 360 });
  await expect(triggered).toBeFocused();
  await expect
    .poll(async () => {
      const bounds = (await page.locator('.filter-panel:popover-open').boundingBox())!;
      return (
        bounds.x >= 0 &&
        bounds.x + bounds.width <= 320 &&
        bounds.y >= 56 &&
        bounds.y + bounds.height <= 360
      );
    })
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(status).toBeFocused();
  const link = list(page).getByRole('link').nth(5);
  await link.focus();
  await expect(filters(page).getByRole('button', { name: /^Filters/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(link).toBeFocused();
  const bar = (await filters(page).boundingBox())!;
  expect((await link.boundingBox())!.y).toBeGreaterThanOrEqual(bar.y + bar.height);
});

test('sticky sort and filters keep URL history, unknown parameters and one control state', async ({
  page,
}) => {
  await login(page);
  await page.goto('/app/incidents?tracking=keep');
  await expect(list(page).getByRole('listitem')).toHaveCount(12);
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect(filters(page)).toHaveAttribute('data-compact', 'true');
  const sort = page.getByRole('combobox', { name: 'Sort', exact: true });
  await sort.selectOption('severity');
  await expect(page).toHaveURL('/app/incidents?tracking=keep&sort=severity');
  await page.goBack();
  await expect(sort).toHaveValue('updated');
  await page.goForward();
  await expect(sort).toHaveValue('severity');
  // Native history restoration can legitimately return to the expanded toolbar at the top.
  // Re-establish the sticky position before exercising its compact trigger.
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect(filters(page)).toHaveAttribute('data-compact', 'true');
  await filters(page)
    .getByRole('button', { name: /^Filters/ })
    .click();
  await filters(page).getByRole('checkbox', { name: 'Assigned to me', exact: true }).click();
  await expect(
    filters(page).getByRole('checkbox', { name: 'Assigned to me', exact: true }),
  ).toBeChecked();
  await expect(page).toHaveURL(/tracking=keep.*assignedToMe=true.*sort=severity/);
  await expect(page.getByRole('button', { name: /^Filters/ })).toContainText('1');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Assigned to me', exact: true })).toBeChecked();
  await expect(sort).toHaveValue('severity');
});

test('legacy My Incidents redirects safely through login and reload, retaining repeated query values', async ({
  page,
}) => {
  await page.goto(
    '/app/my-incidents?severity=P1&severity=P2&sort=severity&tracking=keep&cursor=stale&assignedToMe=false&next=https%3A%2F%2Fexample.test',
  );
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  const returned = new URL(new URL(page.url()).searchParams.get('returnTo')!, 'http://localhost');
  expect(returned.pathname).toBe('/app/my-incidents');
  expect(returned.searchParams.getAll('severity')).toEqual(['P1', 'P2']);
  expect(returned.searchParams.get('assignedToMe')).toBe('false');
  expect(returned.searchParams.get('cursor')).toBe('stale');
  await page.getByLabel('Email', { exact: true }).fill('river.vale@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Fictional-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/incidents\?/);
  expect(new URL(page.url()).searchParams.has('cursor')).toBe(false);
  await expect(page.getByRole('checkbox', { name: 'Assigned to me', exact: true })).toBeChecked();
  await expect(list(page)).toContainText('River Vale');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Assigned to me', exact: true })).toBeChecked();
  expect(new URL(page.url()).searchParams.get('tracking')).toBe('keep');
  await page.goto(
    '/app/my-incidents?status=monitoring&participant=demo-sage&from=2026-09-01&to=2026-10-02',
  );
  await expect(page).toHaveURL(
    '/app/incidents?status=monitoring&participant=demo-sage&from=2026-09-01&to=2026-10-02&assignedToMe=true',
  );
  await expect(page.getByRole('checkbox', { name: 'Assigned to me', exact: true })).toBeChecked();
  await expect(list(page)).toContainText('Monitoring');
});

test('scrolling never fetches another page; explicit Load more keeps boundaries and reaches the end', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/mock-api/incidents') requests.push(url.search);
  });
  await login(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(filters(page)).toHaveAttribute('data-compact', 'true');
  await expect(list(page).getByRole('listitem')).toHaveCount(12);
  expect(requests.filter((query) => new URLSearchParams(query).has('cursor'))).toHaveLength(0);
  const more = page.getByRole('button', { name: 'Load more', exact: true });
  await more.click();
  await expect(list(page).getByRole('listitem')).toHaveCount(24);
  await more.click();
  await expect(list(page).getByRole('listitem')).toHaveCount(32);
  await expect(more).toHaveCount(0);
  await expect(page.getByText('All 32 matching incidents loaded.', { exact: true })).toBeVisible();
  const destinations = await list(page)
    .getByRole('link')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
  expect(new Set(destinations).size).toBe(32);
  expect(destinations[0]).toBe('/app/incidents/INC-2872');
  expect(destinations.at(-1)).toBe('/app/incidents/INC-2841');
  expect(requests.filter((query) => new URLSearchParams(query).has('cursor'))).toHaveLength(2);
});
