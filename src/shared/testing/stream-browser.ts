import { expect, type Locator, type Page } from '@playwright/test';
declare global {
  interface Window {
    timelineMeasurementGate: { hold: boolean; queued: (() => void)[]; release(): void };
  }
}
export async function installMeasurementGate(page: Page) {
  await page.addInitScript(() => {
    const NativeObserver = ResizeObserver;
    const gate = {
      hold: false,
      queued: [] as (() => void)[],
      release() {
        gate.hold = false;
        const pending = gate.queued.splice(0);
        pending.forEach((deliver) => deliver());
      },
    };
    window.timelineMeasurementGate = gate;
    window.ResizeObserver = class extends NativeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          if (gate.hold && entries.some((entry) => entry.target.matches('[data-entry-id]')))
            gate.queued.push(() => callback(entries, observer));
          else callback(entries, observer);
        });
      }
    };
  });
}
export async function openTimeline(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('river.vale@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Fictional-pass-42');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Incidents', exact: true })).toBeVisible();
  await page.goto('/app/incidents/INC-2841');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.locator('[data-entry-id="fictional-incident-2841:evt-4000"]')).toBeInViewport();
  await stableViewport(page.getByLabel('Timeline viewport', { exact: true }));
}
export async function stableViewport(viewport: Locator) {
  await viewport.evaluate(
    (element) =>
      new Promise<void>((resolve, reject) => {
        let last = '',
          stable = 0,
          frames = 0;
        const frame = () => {
          const state = JSON.stringify([
            element.scrollTop,
            element.scrollHeight,
            element.clientHeight,
            [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].map((row) => [
              row.dataset.entryId,
              row.style.transform,
              row.offsetHeight,
            ]),
          ]);
          stable = state === last ? stable + 1 : 0;
          last = state;
          if (stable >= 12) resolve();
          else if (++frames >= 240) reject(new Error('Timeline geometry did not settle'));
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
}
export async function readingAnchor(viewport: Locator) {
  return viewport.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const row = [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].find((node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.top >= frame.top + 20 && bounds.top < frame.bottom - 20;
    });
    if (!row) throw new Error('No visible reading anchor');
    return { id: row.dataset.entryId!, offset: row.getBoundingClientRect().top - frame.top };
  });
}
export async function anchorOffset(page: Page, id: string) {
  return page
    .locator('[data-entry-id="' + id + '"]')
    .evaluate(
      (row) =>
        row.getBoundingClientRect().top -
        row.closest('.timeline-viewport')!.getBoundingClientRect().top,
    );
}

export async function prependHistory(page: Page, viewport: Locator, rapid = false) {
  const before = Number(
    await viewport.locator('[data-entry-id]').first().getAttribute('aria-setsize'),
  );
  const load = page.getByRole('button', { name: 'Load earlier events', exact: true });
  if (rapid)
    await load.evaluate((element) => {
      for (let click = 0; click < 3; click++) (element as HTMLButtonElement).click();
    });
  else await load.click();
  await expect
    .poll(async () =>
      Number(await viewport.locator('[data-entry-id]').first().getAttribute('aria-setsize')),
    )
    .toBeGreaterThan(before);
  await stableViewport(viewport);
  if (rapid)
    expect(
      Number(await viewport.locator('[data-entry-id]').first().getAttribute('aria-setsize')),
    ).toBe(before + 60);
}
