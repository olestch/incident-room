import { test, expect, type Page } from '@playwright/test';

const root = 'fictional-incident-2841:evt-4000';
const timeline = (page: Page) => page.getByRole('region', { name: 'Timeline', exact: true });
const context = (page: Page) => page.getByRole('region', { name: 'Incident context panel' });
const thread = (page: Page) => page.getByRole('complementary', { name: 'Thread', exact: true });
async function room(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use demo account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
  await page.goto('/app/incidents/INC-2841');
  await expect(timeline(page).getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Realtime connection', { exact: true })).toHaveText('Connected');
  await expect(page.locator(`[data-entry-id="${root}"]`)).toBeInViewport();
}
async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const e = document.querySelector<HTMLElement>(selector)!;
      const b = e.getBoundingClientRect();
      return {
        x: b.x,
        y: b.y,
        right: b.right,
        bottom: b.bottom,
        height: b.height,
        width: b.width,
        scrollTop: e.scrollTop,
        clientHeight: e.clientHeight,
        scrollHeight: e.scrollHeight,
      };
    };
    return {
      width: innerWidth,
      height: innerHeight,
      pageY: scrollY,
      overflowX: document.documentElement.scrollWidth > innerWidth,
      overflowY: document.documentElement.scrollHeight > innerHeight + 1,
      context: box('.room-context-panel'),
      stream: box('.room-timeline'),
      viewport: box('.room-timeline .timeline-viewport'),
      compose: box('.room-timeline .timeline-compose'),
    };
  });
}

test('desktop room fills the shell with two columns and independent keyboard scroll ownership', async ({
  page,
}) => {
  await room(page);
  for (const width of [1024, 1280, 1440, 1920]) {
    for (const height of [900, 600, 450]) {
      await page.setViewportSize({ width, height });
      await expect.poll(async () => (await geometry(page)).overflowY).toBe(false);
      const layout = await geometry(page);
      expect(layout.overflowX).toBe(false);
      expect(layout.context.right).toBeLessThan(layout.stream.x);
      expect(Math.abs(layout.context.y - layout.stream.y)).toBeLessThan(2);
      expect(layout.stream.y).toBeLessThan(100);
      expect(layout.viewport.height).toBeGreaterThan(60);
      expect(layout.compose.bottom).toBeLessThanOrEqual(height);
    }
  }
  const viewport = timeline(page).getByLabel('Timeline viewport', { exact: true });
  const before = await geometry(page);
  await viewport.press('Home');
  await expect.poll(async () => (await geometry(page)).viewport.scrollTop).toBeLessThan(5);
  const after = await geometry(page);
  expect(after.pageY).toBe(0);
  expect(after.context.scrollTop).toBe(before.context.scrollTop);
  expect(after.compose.y).toBeCloseTo(before.compose.y, 0);
  await context(page).press('End');
  await expect.poll(async () => (await geometry(page)).context.scrollTop).toBeGreaterThan(0);
  expect((await geometry(page)).viewport.scrollTop).toBeLessThan(5);
  expect((await geometry(page)).pageY).toBe(0);
  await viewport.press('End');
  await expect(page.locator(`[data-entry-id="${root}"]`)).toBeInViewport();
  expect(await page.locator('[data-entry-id]').count()).toBeLessThan(80);
});

test('composer grows within bounds and retains its draft across narrow, short and wide rooms', async ({
  page,
}) => {
  await room(page);
  const field = timeline(page).getByLabel('Message', { exact: true });
  const initial = (await field.boundingBox())!.height;
  const body = Array.from(
    { length: 12 },
    (_, i) => `Fictional multiline observation ${i + 1}.`,
  ).join('\n');
  await field.fill(body);
  await expect.poll(async () => (await field.boundingBox())!.height).toBeGreaterThan(initial);
  for (const width of [320, 768, 1024, 1280, 1440, 1920]) {
    for (const height of [900, 600, 450, 360]) {
      await page.setViewportSize({ width, height });
      await expect.poll(async () => (await geometry(page)).compose.bottom <= height).toBe(true);
      const layout = await geometry(page);
      expect(layout.overflowX).toBe(false);
      expect(layout.viewport.height).toBeGreaterThan(0);
      expect((await field.boundingBox())!.height).toBeLessThanOrEqual(129);
      await expect(field).toHaveValue(body);
      await expect(
        timeline(page).getByRole('button', { name: 'Send', exact: true }),
      ).toBeInViewport({ ratio: 1 });
    }
  }
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await field.focus();
  await expect(field).toBeFocused();
  await field.press('Tab');
  await expect(timeline(page).getByRole('button', { name: 'Mention', exact: true })).toBeFocused();
  await page.reload();
  await expect(field).toHaveValue(body);
});

test('resizing a historical reading anchor preserves measured positioning and latest remains reachable', async ({
  page,
}) => {
  await room(page, 1440, 600);
  const viewport = timeline(page).getByLabel('Timeline viewport', { exact: true });
  await viewport.evaluate((element) => {
    element.scrollTop = 800;
  });
  const anchor = await viewport.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const row = [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].find(
      (item) =>
        item.getBoundingClientRect().top <= top && item.getBoundingClientRect().bottom > top,
    )!;
    return { id: row.dataset.entryId!, offset: row.getBoundingClientRect().top - top };
  });
  for (const width of [1280, 1024, 1920, 1440]) {
    await page.setViewportSize({ width, height: 600 });
    await expect
      .poll(async () =>
        Math.abs(
          (await viewport
            .locator(`[data-entry-id="${anchor.id}"]`)
            .evaluate(
              (element) =>
                element.getBoundingClientRect().top -
                element.closest('.timeline-viewport')!.getBoundingClientRect().top,
            )) - anchor.offset,
        ),
      )
      .toBeLessThanOrEqual(8);
    expect(await viewport.locator('[data-entry-id]').count()).toBeLessThan(80);
  }
  await viewport.press('End');
  await expect(viewport.locator(`[data-entry-id="${root}"]`)).toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 450 });
  await expect(viewport.locator(`[data-entry-id="${root}"]`)).toBeInViewport();
});

test('desktop Thread adapts the workspace without coupling scroll positions or losing drafts', async ({
  page,
}) => {
  await room(page, 1440, 600);
  const timelineField = timeline(page).getByLabel('Message', { exact: true });
  await timelineField.fill('Fictional Timeline draft remains separate.');
  await page.getByRole('button', { name: `Open Thread for ${root}`, exact: true }).click();
  await expect(thread(page).getByLabel('Message', { exact: true })).toBeEnabled();
  const reply = thread(page).getByLabel('Message', { exact: true });
  await reply.fill('Fictional Thread draft remains separate.');
  const history = thread(page).getByLabel('Thread viewport', { exact: true });
  const stream = timeline(page).getByLabel('Timeline viewport', { exact: true });
  const readTop = () => stream.evaluate((e) => e.scrollTop);
  const baseline = await readTop();
  await history.press('Home');
  await expect.poll(() => history.evaluate((e) => e.scrollTop)).toBeLessThan(5);
  expect(Math.abs((await readTop()) - baseline)).toBeLessThan(8);
  const threadTop = await history.evaluate((e) => e.scrollTop);
  await stream.press('Home');
  await expect.poll(readTop).toBeLessThan(5);
  expect(Math.abs((await history.evaluate((e) => e.scrollTop)) - threadTop)).toBeLessThan(8);
  for (const width of [1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 600 });
    const a = (await timeline(page).boundingBox())!,
      b = (await thread(page).boundingBox())!;
    expect(a.x + a.width).toBeLessThan(b.x);
    expect(b.y).toBeCloseTo(a.y, 0);
    await expect(thread(page).getByRole('button', { name: 'Send', exact: true })).toBeInViewport({
      ratio: 1,
    });
    expect((await geometry(page)).overflowX).toBe(false);
  }
  await thread(page).getByRole('button', { name: 'Back to Timeline / Close Thread' }).click();
  await expect(thread(page)).toHaveCount(0);
  await expect(stream).toBeFocused();
  await expect(timelineField).toHaveValue('Fictional Timeline draft remains separate.');
  await timeline(page).getByRole('button', { name: 'Go to latest', exact: true }).click();
  await page.getByRole('button', { name: `Open Thread for ${root}`, exact: true }).click();
  await expect(reply).toHaveValue('Fictional Thread draft remains separate.');
});

test('mobile full-screen Thread keeps its composer and exact targets accessible under height changes', async ({
  page,
}) => {
  await page.clock.install();
  await room(page, 320, 700);
  await page.goto(
    '/app/incidents/INC-2841?event=fictional-incident-2841:evt-42&thread=fictional-incident-2841:evt-42&message=fictional-incident-2841:reply-42-800',
  );
  const target = thread(page).locator('[data-entry-id="fictional-incident-2841:reply-42-800"]');
  await expect(target).toBeInViewport();
  const reply = thread(page).getByLabel('Message', { exact: true });
  await expect(reply).toBeEnabled();
  // Exercise the persistent target feedback after its temporary highlight expires.
  await page.clock.fastForward(8500);
  await expect(
    thread(page).getByRole('button', { name: 'Retry message target', exact: true }),
  ).toBeVisible();
  await reply.fill('Fictional reply during a short viewport.');
  for (const width of [320, 768]) {
    for (const height of [700, 450, 360]) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(async () => (await thread(page).boundingBox())!.height <= height + 1)
        .toBe(true);
      await expect(thread(page).getByRole('button', { name: 'Send', exact: true })).toBeInViewport({
        ratio: 1,
      });
      await expect(
        thread(page).getByRole('button', { name: 'Back to Timeline / Close Thread' }),
      ).toBeInViewport({ ratio: 1 });
      await expect(reply).toHaveValue('Fictional reply during a short viewport.');
      await expect(target).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await reply.press('Escape');
  await expect(thread(page)).toHaveCount(0);
  await expect(page).toHaveURL(/event=fictional-incident-2841%3Aevt-42/);
  expect((await geometry(page)).viewport.height).toBeGreaterThan(0);
  await expect(
    timeline(page).locator('[data-entry-id="fictional-incident-2841:evt-42"]'),
  ).toBeInViewport();
  await expect(timeline(page).getByRole('button', { name: 'Send', exact: true })).toBeInViewport({
    ratio: 1,
  });
});
