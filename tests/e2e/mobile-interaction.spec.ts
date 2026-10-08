import { expect, test, type Page } from '@playwright/test';
import type { IncidentAuthorityData } from '@/features/incident-management/authority';

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Incident context', exact: true });
const trigger = (page: Page) => page.getByRole('button', { name: 'Incident context', exact: true });
const viewport = (page: Page) => page.locator('.room-timeline .timeline-viewport');
async function room(page: Page, long = false) {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Use demo account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
  if (long)
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('incident-room-fictional-incidents-v1', 1);
          open.onerror = () => reject(new Error('Fixture unavailable'));
          open.onsuccess = () => {
            const db = open.result,
              tx = db.transaction('incidents', 'readwrite'),
              store = tx.objectStore('incidents');
            const read = store.get('singleton');
            read.onsuccess = () => {
              const data = read.result as IncidentAuthorityData;
              data.incidents[0]!.description =
                'Fictional long context for native content scrolling.\n'.repeat(60);
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
  const destination = page.locator('a[href="/app/incidents/INC-2841"]');
  const rows = page.getByRole('list', { name: 'Incidents', exact: true }).getByRole('listitem');
  for (let cursor = 0; cursor < 3 && !(await destination.count()); cursor++) {
    const count = await rows.count();
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect.poll(() => rows.count()).toBeGreaterThan(count);
  }
  await destination.click();
  await expect(page.getByLabel('Realtime connection', { exact: true })).toHaveText('Connected');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
}
/** Pause browser animations explicitly; assertions advance their timelines, never sleep. */
async function controlledAnimations(page: Page) {
  await page.addInitScript(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = original.call(this, frames, options);
      if (
        this.classList.contains('ui-drawer-bottom') &&
        document.documentElement.dataset.sheetTestHold === 'true'
      )
        animation.pause();
      return animation;
    };
  });
}
async function hold(page: Page) {
  await page.evaluate(() => {
    document.documentElement.dataset.sheetTestHold = 'true';
  });
}
async function finish(page: Page) {
  await sheet(page).evaluate((element) =>
    element.getAnimations({ subtree: true }).forEach((animation) => animation.finish()),
  );
}
async function open(page: Page) {
  await trigger(page).click();
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'open');
}

test('Timeline controls use compact faces, separate 44px targets, available-width labels and unchanged actions', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const fetch = window.fetch;
    window.fetch = async (...args) => {
      const input = args[0],
        url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (
        document.documentElement.dataset.timelineTestHold === 'true' &&
        url.pathname.endsWith('/timeline') &&
        url.searchParams.has('cursor')
      )
        await new Promise<void>((resolve) =>
          window.addEventListener('phase22-history-release', () => resolve(), { once: true }),
        );
      return fetch(...args);
    };
  });
  await room(page);
  const earlier = page.getByRole('button', { name: 'Load earlier events', exact: true });
  const latest = page.getByRole('button', { name: 'Jump to latest', exact: true });
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const first = (await earlier.boundingBox())!,
      last = (await latest.boundingBox())!;
    expect(first.height).toBeGreaterThanOrEqual(44);
    expect(last.height).toBeGreaterThanOrEqual(44);
    expect(first.x + first.width).toBeLessThanOrEqual(last.x);
    expect(first.y).toBe(last.y);
    if (width < 1024) {
      expect((await earlier.locator('.room-event-control').boundingBox())!.height).toBe(34);
      const available = (await page.locator('.room-history-actions').boundingBox())!.width;
      await expect(earlier).toHaveText(available <= 288 ? 'Earlier' : 'Load earlier events', {
        useInnerText: true,
      });
      await expect(latest).toHaveText(available <= 288 ? 'Latest' : 'Jump to latest', {
        useInnerText: true,
      });
      await expect(earlier.locator('.room-event-mobile-icon')).toBeVisible();
    } else {
      await expect(earlier).toHaveText('Load earlier events', { useInnerText: true });
      await expect(earlier.locator('.room-event-desktop-icon')).toBeVisible();
      await expect(earlier.locator('.room-event-mobile-icon')).toBeHidden();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => {
    document.documentElement.dataset.timelineTestHold = 'true';
  });
  await earlier.click();
  await expect(earlier).toHaveAttribute('aria-busy', 'true');
  await expect(earlier).toBeDisabled();
  await expect(earlier).toHaveText('Loading…', { useInnerText: true });
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith('/timeline') &&
      new URL(response.url()).searchParams.has('cursor'),
  );
  await page.evaluate(() => {
    document.documentElement.dataset.timelineTestHold = 'false';
    window.dispatchEvent(new Event('phase22-history-release'));
  });
  expect((await response).status()).toBe(200);
  await expect(earlier).toBeEnabled();
  await viewport(page).evaluate((element) => {
    element.scrollTop = 200;
  });
  await latest.click();
  await expect
    .poll(() =>
      viewport(page).evaluate((element) =>
        Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop),
      ),
    )
    .toBeLessThanOrEqual(4);
  // A failed deep link adds another real control; hit targets still must not overlap.
  await page.evaluate(() => history.pushState(null, '', '?event=missing-event'));
  await expect(page.getByRole('button', { name: 'Retry target', exact: true })).toBeVisible();
  for (const width of [430, 460, 490, 768]) {
    await page.setViewportSize({ width, height: 800 });
    const controls = page.locator('.room-history-actions > button');
    const boxes = await controls.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const face = element.querySelector('.room-event-control')?.getBoundingClientRect() ?? rect;
        return { x: rect.x, right: rect.right, y: rect.y, faceRight: face.right };
      }),
    );
    for (let index = 1; index < boxes.length; index++) {
      expect(boxes[index]!.y).toBe(boxes[0]!.y);
      expect(boxes[index - 1]!.right).toBeLessThanOrEqual(boxes[index]!.x);
      expect(boxes[index - 1]!.faceRight).toBeLessThanOrEqual(boxes[index]!.x);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('entry and exit animate transforms and backdrop while retaining modality, geometry, draft and focus', async ({
  page,
}) => {
  await controlledAnimations(page);
  await room(page);
  await hold(page);
  const field = page.getByLabel('Message', { exact: true });
  await field.fill('Retained mobile draft.');
  const overflowBefore = await page.evaluate(() => getComputedStyle(document.body).overflow);
  const view = viewport(page);
  await view.evaluate((element) => {
    element.scrollTop = 500;
    element.setAttribute('data-motion-mount', 'retained');
  });
  const before = await view.evaluate((element) => ({
    top: element.scrollTop,
    height: element.clientHeight,
  }));
  await trigger(page).click();
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'opening');
  const animation = await sheet(page).evaluate((element) => {
    const animations = element.getAnimations({ subtree: true });
    animations.forEach((animation) => {
      animation.currentTime = 130;
    });
    return {
      y: new DOMMatrixReadOnly(getComputedStyle(element).transform).m42,
      height: (element as HTMLElement).offsetHeight,
      alpha: Number(getComputedStyle(element, '::backdrop').opacity),
      modal: element.matches(':modal'),
      durations: animations.map((a) => a.effect!.getTiming().duration),
    };
  });
  expect(animation.y).toBeGreaterThan(0);
  expect(animation.y).toBeLessThan(animation.height);
  expect(animation.alpha).toBeGreaterThan(0);
  expect(animation.alpha).toBeLessThan(1);
  expect(animation.modal).toBe(true);
  expect(animation.durations).toEqual([260, 260]);
  await finish(page);
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'open');
  const close = sheet(page).getByRole('button', { name: 'Close Incident context' });
  await expect(close).toBeFocused();
  await close.click();
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'closing');
  expect(await sheet(page).evaluate((element) => element.matches(':modal'))).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
  await field.evaluate((element: HTMLElement) => element.focus());
  await expect(close).toBeFocused();
  await sheet(page).evaluate((element) =>
    element.getAnimations({ subtree: true }).forEach((animation) => {
      animation.currentTime = 110;
    }),
  );
  expect(
    await sheet(page).evaluate(
      (element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42,
    ),
  ).toBeGreaterThan(0);
  expect(
    await view.evaluate((element) => ({ top: element.scrollTop, height: element.clientHeight })),
  ).toEqual(before);
  await finish(page);
  await expect(sheet(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe(overflowBefore);
  await expect(view).toHaveAttribute('data-motion-mount', 'retained');
  await expect(field).toHaveValue('Retained mobile draft.');
  await field.fill('Composer still usable.');
});

test('genuine handle drag tracks the finger, recovers cancelled gestures and dismisses by distance or recent velocity', async ({
  page,
  context,
}) => {
  await controlledAnimations(page);
  await room(page, true);
  await open(page);
  await hold(page);
  const cdp = await context.newCDPSession(page);
  let time = Date.now() / 1000;
  const touch = async (
    type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
    x: number,
    y: number,
    delta: number,
  ) => {
    time += delta;
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      timestamp: time,
      touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y }],
    });
  };
  const handle = async () => {
    const rect = (await sheet(page).locator('.ui-sheet-handle').boundingBox())!;
    return rect.y + 22;
  };
  let y = await handle();
  await touch('touchStart', 195, y, 0.1);
  await touch('touchMove', 195, y + 40, 0.3);
  await expect
    .poll(() =>
      sheet(page).evaluate(
        (element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42,
      ),
    )
    .toBeCloseTo(40, 0);
  expect(
    await sheet(page).evaluate((element) =>
      Number(getComputedStyle(element, '::backdrop').opacity),
    ),
  ).toBeLessThan(1);
  await touch('touchEnd', 0, 0, 0.2);
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'recovering');
  await finish(page);
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'open');
  y = await handle();
  await touch('touchStart', 195, y, 0.1);
  await touch('touchMove', 195, y + 50, 0.1);
  await touch('touchCancel', 0, 0, 0.1);
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'recovering');
  await finish(page);
  y = await handle();
  await touch('touchStart', 195, y, 0.1);
  await touch('touchMove', 195, y + 180, 0.4);
  await touch('touchEnd', 0, 0, 0.2);
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'closing');
  await finish(page);
  await expect(sheet(page)).toHaveCount(0);
  await page.evaluate(() => {
    delete document.documentElement.dataset.sheetTestHold;
  });
  await open(page);
  await hold(page);
  y = await handle();
  await touch('touchStart', 195, y, 0.1);
  await touch('touchMove', 195, y + 32, 0.02);
  await touch('touchEnd', 0, 0, 0.01);
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'closing');
  await finish(page);
  await expect(sheet(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await cdp.detach();
});

test('content scrolling never claims drag; orientation and reduced motion preserve bounds and keyboard access', async ({
  page,
}) => {
  await room(page, true);
  for (const size of [
    { width: 320, height: 800 },
    { width: 375, height: 800 },
    { width: 390, height: 800 },
    { width: 430, height: 800 },
    { width: 768, height: 360 },
  ]) {
    await page.setViewportSize(size);
    await open(page);
    const rect = (await sheet(page).boundingBox())!;
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.height).toBeLessThanOrEqual(size.height + 1);
    await expect(sheet(page).locator('.ui-sheet-handle')).toBeInViewport({ ratio: 1 });
    const body = sheet(page).getByRole('region', { name: 'Incident context details' });
    await body.focus();
    await body.press('PageDown');
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(
      await sheet(page).evaluate(
        (element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42,
      ),
    ).toBe(0);
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
  }
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await open(page);
  expect(await sheet(page).evaluate((element) => element.getAnimations().length)).toBe(0);
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'open');
  const close = sheet(page).getByRole('button', { name: 'Close Incident context' });
  await close.focus();
  await close.press('Shift+Tab');
  await expect(sheet(page).getByRole('region', { name: 'Incident context details' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await expect(
    page
      .getByRole('region', { name: 'Timeline', exact: true })
      .getByRole('button', { name: 'Send', exact: true }),
  ).toBeInViewport({ ratio: 1 });
});

test('Escape during entry and browser navigation during exit cancel cleanly without blocking the destination', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await controlledAnimations(page);
  await room(page);
  await hold(page);
  await trigger(page).click();
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'opening');
  await sheet(page).evaluate((element) =>
    element.getAnimations({ subtree: true }).forEach((animation) => {
      animation.currentTime = 100;
    }),
  );
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'closing');
  await finish(page);
  await expect(sheet(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await trigger(page).click();
  await finish(page);
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'open');
  await sheet(page).getByRole('button', { name: 'Close Incident context' }).click();
  await expect(sheet(page)).toHaveAttribute('data-sheet-phase', 'closing');
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/incidents$/);
  await expect(page.locator('dialog.ui-drawer-bottom[open]')).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
  await page.getByRole('button', { name: 'Create Incident', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create Incident', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
