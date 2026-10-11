import { expect, test, type Page } from '@playwright/test';
import {
  openTimeline,
  readingAnchor,
  anchorOffset,
  prependHistory,
  stableViewport,
} from '@/shared/testing/stream-browser';
async function downloadLog(page: Page) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('incident-room-scroll-debug.json');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return {
    text: Buffer.concat(chunks).toString('utf8'),
    log: JSON.parse(Buffer.concat(chunks).toString('utf8')),
  };
}
for (const width of [320, 375, 390]) {
  test(`scroll recorder controls preserve native reading and export at ${width}px`, async ({
    page,
    context,
    isMobile,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await openTimeline(page);
    await expect(page.getByLabel('Scroll diagnostics', { exact: true })).toHaveCount(0);
    await page.goto('/app/incidents/INC-2841?scrollDebug=1');
    const viewport = page.getByLabel('Timeline viewport', { exact: true });
    await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
    await stableViewport(viewport);
    await page
      .getByLabel('Message', { exact: true })
      .fill('PRIVATE-DRAFT-MUST-NOT-ENTER-SCROLL-LOG');
    const original = await viewport.evaluate((element) => element.scrollTo.toString());
    await page.getByRole('button', { name: /Scroll debug/ }).click();
    await page.getByRole('button', { name: 'Start recording', exact: true }).click();
    const panel = page.getByLabel('Scroll diagnostics', { exact: true });
    const panelBox = (await panel.boundingBox())!;
    const viewportBox = (await viewport.boundingBox())!;
    expect(panelBox.y).toBeGreaterThanOrEqual(viewportBox.y);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height);
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
    // Collapse the controls while reproducing, so all mounted rows remain readable.
    await page.getByRole('button', { name: /Scroll debug/ }).click();
    if (isMobile) {
      const cdp = await context.newCDPSession(page);
      const x = viewportBox.x + 30,
        y = viewportBox.y + 30;
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
      await page.mouse.move(viewportBox.x + 30, viewportBox.y + 100);
      await page.mouse.wheel(0, -400);
    }
    await stableViewport(viewport);
    const anchor = await readingAnchor(viewport);
    await prependHistory(page, viewport);
    expect(Math.abs((await anchorOffset(page, anchor.id)) - anchor.offset)).toBeLessThanOrEqual(8);
    // Deliver a controlled real ResizeObserver size change; scrolling cached rows alone need not remeasure.
    const measuredRow = viewport.locator('li[data-row-key]').first();
    const previousHeight = await measuredRow.evaluate((node) => {
      const height = (node as HTMLElement).offsetHeight;
      node.style.minHeight = String(height + 40) + 'px';
      return height;
    });
    await expect
      .poll(() => measuredRow.evaluate((node) => (node as HTMLElement).offsetHeight))
      .toBeGreaterThan(previousHeight);
    await stableViewport(viewport);
    const position = await viewport.evaluate((element) => element.scrollTop);
    await page.getByRole('button', { name: /Scroll debug/ }).click();
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
    expect(await viewport.evaluate((element) => element.scrollTo.toString())).toBe(original);
    expect(await viewport.evaluate((element) => element.scrollTop)).toBe(position);
    const { text, log } = await downloadLog(page);
    expect(log.schemaVersion).toBe(1);
    expect(log.recording).toBe(false);
    expect(log.droppedEventCount).toBe(0);
    expect(text).not.toContain('PRIVATE-DRAFT-MUST-NOT-ENTER-SCROLL-LOG');
    const types = log.events.map((event: { type: string }) => event.type);
    expect(types).toContain('geometry');
    expect(types).toContain('row-measurement');
    expect(types).toContain('rows-changed');
    expect(types).toContain(isMobile ? 'touchend' : 'wheel');
    expect(
      log.events.some(
        (event: { type: string; data: { anchor?: unknown } }) =>
          event.type === 'geometry' && event.data.anchor,
      ),
    ).toBe(true);
    expect(
      log.events.some(
        (event: { type: string; data: { paginationLoading?: boolean } }) =>
          event.type === 'application-state' && event.data.paginationLoading,
      ),
    ).toBe(true);
    await viewport.evaluate((element) => {
      element.scrollTop -= 100;
    });
    await stableViewport(viewport);
    expect((await downloadLog(page)).log.totalEventCount).toBe(log.totalEventCount);
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    expect((await downloadLog(page)).log.events).toEqual([]);
  });
}
test('records explicit navigation commands without a sampler issuing commands', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openTimeline(page);
  await page.goto('/app/incidents/INC-2841?scrollDebug=1');
  const viewport = page.getByLabel('Timeline viewport', { exact: true });
  await stableViewport(viewport);
  await page.getByRole('button', { name: /Scroll debug/ }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await viewport.focus();
  await page.keyboard.press('Home');
  await stableViewport(viewport);
  await page.getByRole('button', { name: 'Jump to latest', exact: true }).click();
  await stableViewport(viewport);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await page.getByRole('button', { name: 'Copy log', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Log copied' })).toBeVisible();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).schemaVersion).toBe(
    1,
  );
  const { log } = await downloadLog(page);
  const commands = log.events.filter((event: { type: string }) => event.type === 'command');
  expect(commands.map((event: { data: { reason: string } }) => event.data.reason)).toEqual([
    'keyboard-home',
    'explicit-latest',
  ]);
  expect(log.events.some((event: { type: string }) => event.type === 'native-scroll-write')).toBe(
    true,
  );
});
test('one recording follows mobile Thread and restores probes when the flag is removed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 820 });
  await openTimeline(page);
  await page.goto('/app/incidents/INC-2841?scrollDebug=1');
  const timeline = page.getByLabel('Timeline viewport', { exact: true });
  await stableViewport(timeline);
  await page.getByRole('button', { name: /Scroll debug/ }).click();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.getByRole('button', { name: /Scroll debug/ }).click();
  await page
    .getByRole('button', { name: 'Open Thread for fictional-incident-2841:evt-4000', exact: true })
    .click();
  const thread = page.getByRole('complementary', { name: 'Thread', exact: true });
  await expect(thread.getByLabel('Message', { exact: true })).toBeEnabled();
  await stableViewport(page.getByLabel('Thread viewport', { exact: true }));
  expect(
    await page
      .getByLabel('Scroll diagnostics', { exact: true })
      .evaluate((node) => !!node.closest('[inert]')),
  ).toBe(false);
  await page.getByRole('button', { name: /Scroll debug/ }).click();
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  const { log } = await downloadLog(page);
  const surfaces = log.events
    .filter((event: { type: string }) => event.type === 'geometry')
    .map((event: { surface: string }) => event.surface);
  expect(surfaces).toContain('Timeline');
  expect(surfaces).toContain('Thread');
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.delete('scrollDebug');
    history.replaceState(null, '', url);
  });
  await expect(page.getByLabel('Scroll diagnostics', { exact: true })).toHaveCount(0);
  expect(
    await page
      .getByLabel('Thread viewport', { exact: true })
      .evaluate((node) => Object.hasOwn(node, 'scrollTo')),
  ).toBe(false);
});
