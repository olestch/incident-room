import { expect, test, type Locator, type Page } from '@playwright/test';
import type { IncidentAuthorityData } from '@/features/incident-management/authority';

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Incident context', exact: true });
const trigger = (page: Page) => page.getByRole('button', { name: 'Incident context', exact: true });
const viewport = (page: Page) => page.locator('.room-timeline .timeline-viewport');
async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use demo account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
}
async function room(page: Page, longContent = false) {
  await page.setViewportSize({ width: 390, height: 800 });
  await login(page);
  if (longContent)
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('incident-room-fictional-incidents-v1', 1);
          request.onerror = () => reject(new Error('Fixture unavailable'));
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('incidents', 'readwrite');
            const store = tx.objectStore('incidents');
            const read = store.get('singleton');
            read.onsuccess = () => {
              const data = read.result as IncidentAuthorityData;
              data.incidents[0]!.description =
                'Fictional long incident context for internal scrolling.\n'.repeat(60);
              store.put(data, 'singleton');
            };
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = () => {
              db.close();
              reject(new Error('Fixture failed'));
            };
          };
        }),
    );
  await page.goto('/app/incidents/INC-2841');
  await expect(page.getByLabel('Realtime connection', { exact: true })).toHaveText('Connected');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
}
async function anchor(view: Locator) {
  await expect
    .poll(() =>
      view.evaluate((element) => {
        const top = element.getBoundingClientRect().top;
        return [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].some(
          (item) =>
            item.getBoundingClientRect().bottom > top &&
            item.getBoundingClientRect().top <= top + 40,
        );
      }),
    )
    .toBe(true);
  return view.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const row = [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].find(
      (item) =>
        item.getBoundingClientRect().bottom > top && item.getBoundingClientRect().top <= top + 40,
    )!;
    return { id: row.dataset.entryId!, offset: row.getBoundingClientRect().top - top };
  });
}
async function retained(view: Locator, before: { id: string; offset: number }) {
  await expect
    .poll(async () =>
      Math.abs(
        (await view
          .locator(`[data-entry-id="${before.id}"]`)
          .evaluate(
            (row) =>
              row.getBoundingClientRect().top -
              row.closest('.timeline-viewport')!.getBoundingClientRect().top,
          )) - before.offset,
      ),
    )
    .toBeLessThanOrEqual(8);
  expect(await view.locator('[data-entry-id]').count()).toBeLessThan(80);
}

test('mobile list keeps Create beside its heading and the count next to compact stable controls', async ({
  page,
}) => {
  await login(page);
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 600 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const title = (await page
      .getByRole('heading', { name: 'Incidents', exact: true })
      .boundingBox())!;
    const create = page.getByRole('button', { name: 'Create Incident', exact: true });
    const action = (await create.boundingBox())!;
    expect(action.x).toBeGreaterThan(title.x + title.width);
    expect(Math.abs(action.y - title.y)).toBeLessThan(12);
    expect(action.height).toBeGreaterThanOrEqual(44);
    await expect(create).toBeInViewport();
    await expect(create).toHaveText('Create', { useInnerText: true });
    const controls = page.getByRole('region', { name: 'Incident filters', exact: true });
    const bounds = (await controls.boundingBox())!;
    expect(bounds.height).toBeLessThanOrEqual(96);
    const count = (await page.locator('.queue-count').boundingBox())!;
    expect(count.y - bounds.y - bounds.height).toBeLessThan(10);
    await expect(controls.getByRole('combobox', { name: 'Sort', exact: true })).toBeInViewport();
    await expect(
      controls.getByRole('checkbox', { name: 'Assigned to me', exact: true }),
    ).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const toggle = controls.getByRole('button', { name: /^Filters/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const firstRow = page
      .getByRole('list', { name: 'Incidents', exact: true })
      .getByRole('link')
      .first();
    await firstRow.focus();
    await expect(firstRow).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }
});

test('mobile Room uses compact context navigation and one workspace through narrow and short viewports', async ({
  page,
}) => {
  await room(page);
  const field = page.getByLabel('Message', { exact: true });
  await field.fill('Fictional draft\n'.repeat(12));
  for (const width of [320, 375, 390, 430, 768, 1024, 1280]) {
    for (const height of [800, 360]) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1))
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(
        page
          .getByRole('region', { name: 'Timeline', exact: true })
          .getByRole('button', { name: 'Send', exact: true }),
      ).toBeInViewport({ ratio: 1 });
      expect((await viewport(page).boundingBox())!.height).toBeGreaterThan(0);
      if (width < 1024) {
        await expect(trigger(page)).toBeVisible();
        expect((await page.locator('.room-loading h1').boundingBox())!.height).toBe(1);
        expect(
          (await page.locator('.room-context-panel').boundingBox())!.height,
        ).toBeLessThanOrEqual(48);
        expect((await page.locator('.room-timeline').boundingBox())!.y).toBeLessThan(120);
        await expect(page.getByRole('link', { name: 'Back to incidents', exact: true })).toHaveText(
          'Back to list',
          { useInnerText: true },
        );
      } else {
        await expect(trigger(page)).toHaveCount(0);
        await expect(page.locator('.room-loading h1')).toBeVisible();
      }
      await expect(field).toHaveValue('Fictional draft\n'.repeat(12));
    }
  }
});

test('context sheet traps and restores focus, locks background and scrolls long content without moving history', async ({
  page,
}) => {
  await room(page, true);
  const view = viewport(page);
  await view.evaluate((element) => {
    element.scrollTop = 800;
    element.setAttribute('data-mount-check', 'retained');
  });
  const before = await anchor(view);
  const top = await view.evaluate((element) => element.scrollTop);
  await trigger(page).click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toContainText('Commander');
  await expect(sheet(page)).toContainText('Affected services');
  await expect(sheet(page)).toContainText('Participants');
  await expect(sheet(page)).toContainText('Created');
  await expect(sheet(page)).toContainText('Updated');
  const close = sheet(page).getByRole('button', { name: 'Close Incident context' });
  const details = sheet(page).getByRole('region', { name: 'Incident context details' });
  await expect(close).toBeFocused();
  await close.press('Shift+Tab');
  await expect(details).toBeFocused();
  await details.press('Tab');
  await expect(close).toBeFocused();
  await view.evaluate((element: HTMLElement) => element.focus());
  await expect(close).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
  await details.hover();
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => details.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  expect(await view.evaluate((element) => element.scrollTop)).toBeCloseTo(top, 0);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await retained(view, before);
  await expect(view).toHaveAttribute('data-mount-check', 'retained');
  await trigger(page).click();
  await page.mouse.click(195, 8);
  await expect(sheet(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await retained(view, before);
});

test('touch scrolling belongs to context content; only a completed downward handle swipe dismisses', async ({
  page,
  context,
}) => {
  await room(page, true);
  await trigger(page).click();
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'open');
  const cdp = await context.newCDPSession(page);
  const touch = async (
    type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
    x = 0,
    y = 0,
  ) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }],
    });
  };
  const body = sheet(page).getByRole('region', { name: 'Incident context details' });
  await body.evaluate((element) => {
    element.scrollTop = 500;
  });
  const box = (await body.boundingBox())!;
  await touch('touchStart', 195, box.y + 100);
  await touch('touchMove', 195, box.y + 150);
  await touch('touchEnd');
  await expect(sheet(page)).toBeVisible();
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeLessThan(500);
  const handle = (await sheet(page).locator('.ui-sheet-handle').boundingBox())!;
  const y = handle.y + 22;
  await touch('touchStart', 150, y);
  await touch('touchMove', 220, y + 10);
  await touch('touchEnd');
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'open');
  await touch('touchStart', 195, y);
  await touch('touchMove', 195, y + 90);
  await touch('touchCancel');
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'open');
  await touch('touchStart', 195, y);
  await touch('touchMove', 195, y + 90);
  await touch('touchEnd');
  await expect(sheet(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await cdp.detach();
});

test('visual viewport keyboard changes preserve historical anchors and keep the composer within available height', async ({
  page,
}) => {
  await room(page);
  const field = page.getByLabel('Message', { exact: true });
  await field.fill('Fictional mobile keyboard draft.');
  await viewport(page).evaluate((element) => {
    element.scrollTop = 800;
  });
  const before = await anchor(viewport(page));
  await field.focus();
  await page.evaluate(() => {
    Object.defineProperty(visualViewport!, 'height', { configurable: true, value: 360 });
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  const send = page
    .getByRole('region', { name: 'Timeline', exact: true })
    .getByRole('button', { name: 'Send', exact: true });
  await expect
    .poll(async () => {
      const b = (await send.boundingBox())!;
      return b.y + b.height;
    })
    .toBeLessThanOrEqual(360);
  await expect(field).toBeFocused();
  expect(
    (await viewport(page).boundingBox())!.height,
    JSON.stringify(
      await page.evaluate(() => {
        const selectors = [
          '#main-content',
          '.incident-room',
          '.incident-room-layout',
          '.room-context-panel',
          '.thread-room-layout',
          '.room-timeline',
          '.room-stream-heading',
          '.room-realtime',
          '.timeline-compose',
          '.compose-editor',
        ];
        return selectors.map((selector) => {
          const el = document.querySelector<HTMLElement>(selector)!;
          const rect = el.getBoundingClientRect();
          return {
            selector,
            top: rect.top,
            height: rect.height,
            available: el.style.getPropertyValue('--room-available-height'),
          };
        });
      }),
    ),
  ).toBeGreaterThan(0);
  await retained(viewport(page), before);
  await trigger(page).click();
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'open');
  const keyboardSheet = (await sheet(page).boundingBox())!;
  expect(keyboardSheet.y).toBeGreaterThanOrEqual(0);
  expect(keyboardSheet.y + keyboardSheet.height).toBeLessThanOrEqual(360);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await retained(viewport(page), before);
  await page.evaluate(() => {
    Reflect.deleteProperty(visualViewport!, 'height');
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect
    .poll(async () => {
      const b = (await send.boundingBox())!;
      return b.y + b.height;
    })
    .toBeGreaterThan(700);
  await retained(viewport(page), before);
  await expect(field).toHaveValue('Fictional mobile keyboard draft.');
});

test('context breakpoint migration and Thread retain the old deep link, Timeline mount and drafts', async ({
  page,
}) => {
  await room(page);
  const id = 'fictional-incident-2841:evt-42';
  await page.goto(`/app/incidents/INC-2841?event=${id}`);
  await expect(viewport(page).locator(`[data-entry-id="${id}"]`)).toBeInViewport();
  const field = page.getByLabel('Message', { exact: true });
  await field.fill('Fictional retained Timeline draft.');
  await viewport(page).evaluate((element) => element.setAttribute('data-mount-check', 'retained'));
  await trigger(page).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('#incident-heading')).toBeFocused();
  await expect(viewport(page)).toHaveAttribute('data-mount-check', 'retained');
  await expect(field).toHaveValue('Fictional retained Timeline draft.');
  await page.setViewportSize({ width: 390, height: 800 });
  await trigger(page).click();
  await sheet(page).getByRole('button', { name: 'Close Incident context' }).click();
  await expect(trigger(page)).toBeFocused();
  await page.getByRole('button', { name: `Open Thread for ${id}`, exact: true }).click();
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  await expect(thread.getByLabel('Message', { exact: true })).toBeEnabled();
  await thread.getByLabel('Message', { exact: true }).fill('Fictional retained Thread draft.');
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.setViewportSize({ width: 390, height: 600 });
  await expect(thread.getByLabel('Message', { exact: true })).toHaveValue(
    'Fictional retained Thread draft.',
  );
  await thread.getByRole('button', { name: 'Back to Timeline / Close Thread' }).click();
  await expect(thread).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('event')).toBe(id);
  expect(new URL(page.url()).searchParams.has('thread')).toBe(false);
  await expect(viewport(page)).toHaveAttribute('data-mount-check', 'retained');
  await expect(field).toHaveValue('Fictional retained Timeline draft.');
  await expect(viewport(page).locator(`[data-entry-id="${id}"]`)).toBeInViewport();
  await trigger(page).click();
  await page.keyboard.press('Escape');
  await expect(trigger(page)).toBeFocused();
  await page.getByRole('button', { name: `Open Thread for ${id}`, exact: true }).click();
  await expect(thread.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.goBack();
  await expect(thread).toHaveCount(0);
  await trigger(page).click();
  await expect(sheet(page)).toBeVisible();
  await page.goForward();
  await expect(sheet(page)).toHaveCount(0);
  await expect(thread.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(
    thread.getByRole('button', { name: 'Back to Timeline / Close Thread' }),
  ).toBeFocused();
  await thread.getByRole('button', { name: 'Back to Timeline / Close Thread' }).click();
  await expect(viewport(page)).toHaveAttribute('data-mount-check', 'retained');
});
