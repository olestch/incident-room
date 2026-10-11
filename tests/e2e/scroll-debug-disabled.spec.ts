import { expect, test } from '@playwright/test';
import {
  openTimeline,
  readingAnchor,
  anchorOffset,
  prependHistory,
  stableViewport,
} from '@/shared/testing/stream-browser';
test('production ignores scrollDebug query and preserves the Timeline anchor', async ({ page }) => {
  await openTimeline(page);
  await page.goto('/app/incidents/INC-2841?scrollDebug=1');
  const viewport = page.getByLabel('Timeline viewport', { exact: true });
  await expect(page.locator('[data-entry-id="fictional-incident-2841:evt-4000"]')).toBeInViewport();
  await expect(page.getByLabel('Scroll diagnostics', { exact: true })).toHaveCount(0);
  await stableViewport(viewport);
  const box = (await viewport.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 100);
  await page.mouse.wheel(0, -500);
  await stableViewport(viewport);
  const anchor = await readingAnchor(viewport);
  await prependHistory(page, viewport);
  expect(Math.abs((await anchorOffset(page, anchor.id)) - anchor.offset)).toBeLessThanOrEqual(8);
  expect(await viewport.evaluate((element) => Object.hasOwn(element, 'scrollTo'))).toBe(false);
});
