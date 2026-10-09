import { expect, test } from '@playwright/test';
import {
  anchorOffset,
  installMeasurementGate,
  openTimeline,
  prependHistory,
  readingAnchor,
  stableViewport,
} from '@/shared/testing/stream-browser';
test('development effect replay preserves a late first measurement across the fold', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 820 });
  await installMeasurementGate(page);
  await openTimeline(page);
  const viewport = page.getByLabel('Timeline viewport', { exact: true });
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
  expect(await page.evaluate(() => window.timelineMeasurementGate.queued.length)).toBeGreaterThan(
    0,
  );
  const anchor = await readingAnchor(viewport);
  await page.evaluate(() => window.timelineMeasurementGate.release());
  await stableViewport(viewport);
  expect(Math.abs((await anchorOffset(page, anchor.id)) - anchor.offset)).toBeLessThanOrEqual(8);
  await prependHistory(page, viewport);
  expect(Math.abs((await anchorOffset(page, anchor.id)) - anchor.offset)).toBeLessThanOrEqual(8);
});
