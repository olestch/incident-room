import { expect, type Page, type TestInfo } from '@playwright/test';
import { installMeasurementGate, openTimeline } from './stream-browser';

export const iphoneSafariUA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

type Probe = {
  writes: { before: number; top: number | null; stack: string }[];
  frames: { top: number; y: number | null }[];
  id: string;
  done: boolean;
  released: boolean;
  userMoved: boolean;
  lastScroll: number;
  restore(): void;
};
declare global {
  interface Window {
    wheelCompensationProbe: Probe;
  }
}

/** Holds real measurements until native wheel scroll, then observes every paint through idle. */
export async function verifyWheelCompensation(page: Page, testInfo: TestInfo) {
  await installMeasurementGate(page);
  await openTimeline(page);
  const viewport = page.getByLabel('Timeline viewport', { exact: true });
  await expect(viewport.locator('[data-entry-id]').first()).toHaveAttribute('aria-setsize', '60');
  expect(await viewport.locator('[data-entry-id]').count()).toBeLessThan(45);
  const results = [];
  for (const [position, deltaY] of [
    [2900, -2],
    [1800, 2],
    [4100, -2],
    [1200, 2],
  ]) {
    await viewport.evaluate((element, top) => {
      window.timelineMeasurementGate.hold = true;
      element.scrollTop = top;
    }, position!);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await page.evaluate(() => window.timelineMeasurementGate.queued.length)).toBeGreaterThan(
      0,
    );
    await viewport.evaluate((element, direction) => {
      const node = element as HTMLElement;
      const original = node.scrollTo;
      const beforeWheel = node.scrollTop;
      let wheelSeen = false,
        scheduled = false;
      const onWheel = () => {
        wheelSeen = true;
      };
      const onScroll = () => {
        probe.lastScroll = performance.now();
        if (!wheelSeen || scheduled) return;
        scheduled = true;
        probe.userMoved = (node.scrollTop - beforeWheel) * direction > 0;
        // Virtual's native offset observer has handled this scroll before this callback.
        requestAnimationFrame(() => {
          const bounds = node.getBoundingClientRect();
          const row = [...node.querySelectorAll<HTMLElement>('[data-entry-id]')].find(
            (item) =>
              item.getBoundingClientRect().top >= bounds.top + 20 &&
              item.getBoundingClientRect().top < bounds.bottom - 20,
          );
          if (!row) throw new Error('No visible anchor before releasing measurements');
          probe.id = row.dataset.entryId!;
          const sample = () => {
            const anchor = [...node.querySelectorAll<HTMLElement>('[data-entry-id]')].find(
              (item) => item.dataset.entryId === probe.id,
            );
            probe.frames.push({
              top: node.scrollTop,
              y: anchor
                ? anchor.getBoundingClientRect().top - node.getBoundingClientRect().top
                : null,
            });
            if (!probe.done) requestAnimationFrame(sample);
          };
          sample();
          window.timelineMeasurementGate.release();
          probe.released = true;
        });
      };
      const probe: Probe = {
        writes: [],
        frames: [],
        id: '',
        done: false,
        released: false,
        userMoved: false,
        lastScroll: performance.now(),
        restore() {
          node.scrollTo = original;
          node.removeEventListener('scroll', onScroll);
          node.removeEventListener('wheel', onWheel);
        },
      };
      window.wheelCompensationProbe = probe;
      node.addEventListener('scroll', onScroll, { passive: true });
      node.addEventListener('wheel', onWheel, { passive: true });
      node.scrollTo = function (this: HTMLElement, options: ScrollToOptions | number, y?: number) {
        probe.writes.push({
          before: node.scrollTop,
          top: typeof options === 'number' ? (y ?? null) : (options.top ?? null),
          stack: new Error().stack ?? '',
        });
        Reflect.apply(original, this, typeof options === 'number' ? [options, y] : [options]);
      } as typeof node.scrollTo;
    }, Math.sign(deltaY!));
    const box = (await viewport.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + 80);
    await page.mouse.wheel(0, deltaY!);
    await page.waitForFunction(() => window.wheelCompensationProbe.released);
    expect(await page.evaluate(() => window.wheelCompensationProbe.userMoved)).toBe(true);
    await viewport.evaluate(
      (element) =>
        new Promise<void>((resolve, reject) => {
          let last = '',
            stable = 0,
            frames = 0;
          const settle = () => {
            const state = JSON.stringify([
              element.scrollTop,
              element.scrollHeight,
              [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].map((row) => [
                row.dataset.entryId,
                row.style.transform,
                row.offsetHeight,
              ]),
            ]);
            stable = state === last ? stable + 1 : 0;
            last = state;
            // Core's reset is 150ms. Require both quiet native input and stable geometry.
            if (
              stable >= 12 &&
              performance.now() - window.wheelCompensationProbe.lastScroll >= 200 &&
              window.timelineMeasurementGate.queued.length === 0
            )
              resolve();
            else if (++frames >= 240)
              reject(new Error('Wheel measurement geometry did not settle'));
            else requestAnimationFrame(settle);
          };
          requestAnimationFrame(settle);
        }),
    );
    const result = await page.evaluate(() => {
      const probe = window.wheelCompensationProbe;
      probe.done = true;
      probe.restore();
      return { writes: probe.writes, frames: probe.frames };
    });
    results.push(result);
    await testInfo.attach('wheel-measurement-' + position + '.json', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });
    expect(result.writes.some((write) => write.stack.includes('_flushIosDeferredIfReady'))).toBe(
      false,
    );
    expect(result.frames.every((frame) => frame.y !== null)).toBe(true);
    expect(
      Math.max(...result.frames.map((frame) => Math.abs(frame.y! - result.frames[0]!.y!))),
    ).toBeLessThanOrEqual(8);
    expect(result.writes.length).toBeLessThan(45);
    await expect(viewport.locator('[data-entry-id]').first()).toHaveAttribute('aria-setsize', '60');
  }
  expect(results[0]!.writes.length).toBeGreaterThan(0);
  await testInfo.attach('wheel-compensation.json', {
    body: JSON.stringify(results),
    contentType: 'application/json',
  });
}
