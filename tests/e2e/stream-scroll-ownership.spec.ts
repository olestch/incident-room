import { expect, test } from '@playwright/test';
import {
  openTimeline,
  readingAnchor,
  anchorOffset,
  stableViewport,
} from '@/shared/testing/stream-browser';

for (const width of [320, 375, 390]) {
  test(`user scrolling cancels a locating Timeline target at ${width}px`, async ({
    page,
    context,
    isMobile,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await openTimeline(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('incident-room-fictional-timeline-v1', 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction('records', 'readwrite');
            const store = tx.objectStore('records');
            const key = JSON.stringify(['demo-orbit', 'fictional-incident-2841']);
            const get = store.get(key);
            get.onsuccess = () => {
              if (!get.result) {
                tx.abort();
                return;
              }
              get.result.locateDelayMs = 1000;
              store.put(get.result, key);
            };
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = () => {
              db.close();
              reject(new Error('Fixture update failed'));
            };
          };
        }),
    );
    const locating = page.waitForRequest((request) => request.url().includes('/locate?'));
    await page.evaluate(() =>
      history.pushState(null, '', '?event=fictional-incident-2841%3Aevt-42&tracking=keep'),
    );
    await locating;
    const viewport = page.getByLabel('Timeline viewport', { exact: true });
    const box = (await viewport.boundingBox())!;
    if (isMobile) {
      const cdp = await context.newCDPSession(page);
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
      await cdp.detach();
    } else {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -350);
    }
    await stableViewport(viewport);
    const anchor = await readingAnchor(viewport);
    await expect(
      page.getByRole('status').filter({ hasText: 'Timeline target navigation cancelled.' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry target', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/tracking=keep/);
    await stableViewport(viewport);
    expect(Math.abs((await anchorOffset(page, anchor.id)) - anchor.offset)).toBeLessThanOrEqual(8);
    await page.getByRole('button', { name: 'Retry target', exact: true }).click();
    await expect(page.locator('[data-entry-id="fictional-incident-2841:evt-42"]')).toBeInViewport();
  });
}
