import { expect, test } from '@playwright/test';
import {
  anchorOffset,
  installMeasurementGate,
  openTimeline,
  prependHistory,
  readingAnchor,
  stableViewport,
} from '@/shared/testing/stream-browser';

for (const width of [320, 375, 390, 430, 1280]) {
  test(
    'late first measurement across the fold preserves the reading anchor at ' + width + 'px',
    async ({ page }) => {
      await page.setViewportSize({ width, height: 820 });
      await installMeasurementGate(page);
      await openTimeline(page);
      const viewport = page.getByLabel('Timeline viewport', { exact: true });
      // Hold only row RO delivery. Scroll a yet-unmeasured middle block into view,
      // then release its real border-box measurements after the scroll range commits.
      await viewport.evaluate((element) => {
        window.timelineMeasurementGate.hold = true;
        element.scrollTop = 2900;
      });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      expect(
        await page.evaluate(() => window.timelineMeasurementGate.queued.length),
      ).toBeGreaterThan(0);
      const anchor = await readingAnchor(viewport);
      await page.evaluate(() => window.timelineMeasurementGate.release());
      await stableViewport(viewport);
      expect(Math.abs((await anchorOffset(page, anchor.id)) - anchor.offset)).toBeLessThanOrEqual(
        8,
      );
      expect(await viewport.locator('[data-entry-id]').count()).toBeLessThan(80);
    },
  );
}

test('real touch scrolling, repeated prepend and viewport-height changes preserve settled geometry', async ({
  page,
  context,
  isMobile,
}) => {
  await openTimeline(page);
  const viewport = page.getByLabel('Timeline viewport', { exact: true });
  const cdp = await context.newCDPSession(page);
  for (let pass = 0; pass < 3; pass++) {
    const box = (await viewport.boundingBox())!;
    if (isMobile) {
      const x = box.x + box.width / 2,
        y = box.y + 40;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let step = 1; step <= 10; step++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: y + step * 20 }],
        });
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        );
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -400);
    }
    await stableViewport(viewport);
    const anchor = await readingAnchor(viewport);
    const top = await viewport.evaluate((element) => element.scrollTop);
    await stableViewport(viewport);
    expect(Math.abs((await anchorOffset(page, anchor.id)) - anchor.offset)).toBeLessThanOrEqual(8);
    expect(
      Math.abs((await viewport.evaluate((element) => element.scrollTop)) - top),
    ).toBeLessThanOrEqual(2);
    await prependHistory(page, viewport, true);
    expect(Math.abs((await anchorOffset(page, anchor.id)) - anchor.offset)).toBeLessThanOrEqual(8);
  }
  const anchor = await readingAnchor(viewport);
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width, height: size.height - 120 });
  await stableViewport(viewport);
  expect(Math.abs((await anchorOffset(page, anchor.id)) - anchor.offset)).toBeLessThanOrEqual(8);
  await page.goto('/app/incidents/INC-2841?event=fictional-incident-2841%3Aevt-42');
  await expect(page.locator('[data-entry-id="fictional-incident-2841:evt-42"]')).toBeInViewport();
  await page.getByRole('button', { name: 'Jump to latest', exact: true }).click();
  await expect(page.locator('[data-entry-id="fictional-incident-2841:evt-4000"]')).toBeInViewport();
  expect(await viewport.locator('[data-entry-id]').count()).toBeLessThan(80);
});

test('later growth below the fold does not drag a reader inside an already measured row', async ({
  page,
}) => {
  await openTimeline(page);
  const viewport = page.getByLabel('Timeline viewport', { exact: true });
  await viewport.evaluate((element) => {
    element.scrollTop = 2900;
  });
  await stableViewport(viewport);
  const before = await viewport.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const row = [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].find((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.top < frame.top && bounds.bottom > frame.top + 10;
    });
    if (!row) throw new Error('No partially visible measured row');
    const offset = row.getBoundingClientRect().top - frame.top;
    const growth = document.createElement('p');
    growth.textContent = 'Fictional late content growth below the reading position. '.repeat(30);
    row.append(growth);
    return { id: row.dataset.entryId!, offset, top: element.scrollTop };
  });
  await stableViewport(viewport);
  expect(Math.abs((await anchorOffset(page, before.id)) - before.offset)).toBeLessThanOrEqual(8);
  expect(
    Math.abs((await viewport.evaluate((element) => element.scrollTop)) - before.top),
  ).toBeLessThanOrEqual(2);
});
