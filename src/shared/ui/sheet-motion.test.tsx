import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Drawer } from './drawer';

type Pending = { finish(): void; cancel: ReturnType<typeof vi.fn>; finished: Promise<void> };
let pending: Pending[];
let reduced: MediaQueryList & { matches: boolean };
const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
afterEach(() => {
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});
beforeEach(() => {
  pending = [];
  const listeners = new EventTarget();
  reduced = {
    matches: false,
    addEventListener: listeners.addEventListener.bind(listeners),
    removeEventListener: listeners.removeEventListener.bind(listeners),
    dispatchEvent: listeners.dispatchEvent.bind(listeners),
  } as typeof reduced;
  vi.spyOn(window, 'matchMedia').mockReturnValue(reduced);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (element, pseudo) =>
      ({
        transform: (element as HTMLElement).style.transform,
        bottom: '0px',
        opacity: pseudo
          ? (element as HTMLElement).style.getPropertyValue('--sheet-backdrop-opacity')
          : '1',
      }) as CSSStyleDeclaration,
  );
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.open = true;
      this.querySelector('button')?.focus();
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.open = false;
    },
  });
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => {
      let resolve!: () => void, reject!: () => void;
      const finished = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const animation = { finished, finish: resolve, cancel: vi.fn(reject) };
      pending.push(animation);
      return animation as unknown as Animation;
    }),
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400);
});
function setup() {
  const close = vi.fn();
  const opener = document.createElement('button');
  document.body.append(opener);
  opener.focus();
  const content = (open: boolean, immediateClose = false) => (
    <Drawer side="bottom" open={open} immediateClose={immediateClose} close={close} title="Context">
      <input aria-label="Draft" defaultValue="retained" />
    </Drawer>
  );
  const result = render(content(true));
  const dialog = screen.getByRole('dialog');
  const handle = dialog.querySelector<HTMLElement>('.ui-sheet-handle')!;
  const captures = new Set<number>();
  handle.setPointerCapture = vi.fn((id) => captures.add(id));
  handle.hasPointerCapture = vi.fn((id) => captures.has(id));
  handle.releasePointerCapture = vi.fn((id) => captures.delete(id));
  const pointer = (type: string, y: number, time: number, x = 100) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'timeStamp', { value: time });
    Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y });
    fireEvent(handle, event);
  };
  return {
    ...result,
    dialog,
    handle,
    close,
    opener,
    pointer,
    setOpen: (open: boolean, immediate = false) => result.rerender(content(open, immediate)),
  };
}
async function finish() {
  await act(async () => {
    pending.slice(-2).forEach((animation) => animation.finish());
  });
}

it('keeps native modality and retained content until exit finishes, then restores focus', async () => {
  const view = setup();
  expect(view.dialog).toHaveAttribute('data-sheet-phase', 'opening');
  await finish();
  view.setOpen(false);
  expect(view.dialog).toHaveAttribute('open');
  expect(view.dialog).toHaveAttribute('data-sheet-phase', 'closing');
  expect(view.opener).not.toHaveFocus();
  await finish();
  expect(view.dialog).not.toHaveAttribute('open');
  expect(view.opener).toHaveFocus();
  expect(screen.getByLabelText('Draft')).toHaveValue('retained');
  view.unmount();
  view.opener.remove();
});
it('rapid reversal cancels stale completion without removing a reopened modal', async () => {
  const view = setup();
  await finish();
  view.setOpen(false);
  const stale = pending.slice(-2);
  view.setOpen(true);
  await act(async () => {
    stale.forEach((animation) => animation.finish());
  });
  expect(view.dialog).toHaveAttribute('open');
  expect(view.dialog).toHaveAttribute('data-sheet-phase', 'opening');
  await finish();
  expect(view.dialog).toHaveAttribute('data-sheet-phase', 'open');
  view.unmount();
  view.opener.remove();
});
it('short slow drags follow the pointer and recover; sufficient distance or recent velocity dismiss', async () => {
  const view = setup();
  await finish();
  view.pointer('pointerdown', 100, 0);
  view.pointer('pointermove', 130, 300);
  expect(view.dialog.style.transform).toBe('translateY(30px)');
  view.pointer('pointerup', 130, 400);
  expect(view.close).not.toHaveBeenCalled();
  await finish();
  expect(view.dialog.style.transform).toBe('translateY(0px)');
  view.pointer('pointerdown', 100, 500);
  view.pointer('pointermove', 190, 800);
  view.pointer('pointerup', 190, 900);
  expect(view.close).toHaveBeenCalledTimes(1);
  view.setOpen(false);
  await finish();
  view.setOpen(true);
  await finish();
  view.pointer('pointerdown', 100, 1000);
  view.pointer('pointermove', 128, 1020);
  view.pointer('pointerup', 132, 1030);
  expect(view.close).toHaveBeenCalledTimes(2);
  view.unmount();
  view.opener.remove();
});
it('rejects tiny flicks, stalled flicks and upward/horizontal intent; cancellation releases capture', async () => {
  const view = setup();
  await finish();
  view.pointer('pointerdown', 100, 0);
  view.pointer('pointermove', 110, 10);
  view.pointer('pointerup', 110, 15);
  await finish();
  view.pointer('pointerdown', 100, 100);
  view.pointer('pointermove', 130, 120);
  view.pointer('pointerup', 130, 500);
  await finish();
  view.pointer('pointerdown', 100, 600);
  view.pointer('pointermove', 80, 620);
  await finish();
  expect(view.dialog.style.transform).toBe('translateY(0px)');
  view.pointer('pointerdown', 100, 700);
  view.pointer('pointermove', 110, 720, 150);
  await finish();
  view.pointer('pointerdown', 100, 800);
  view.pointer('pointermove', 140, 820);
  view.pointer('pointercancel', 140, 830);
  await finish();
  expect(view.close).not.toHaveBeenCalled();
  expect(view.handle.releasePointerCapture).toHaveBeenCalled();
  expect(view.dialog).toHaveAttribute('data-sheet-phase', 'open');
  view.unmount();
  view.opener.remove();
});
it('resize and Escape during a drag recover or dismiss without retained capture; reduced motion closes immediately', async () => {
  const view = setup();
  await finish();
  view.pointer('pointerdown', 100, 0);
  view.pointer('pointermove', 140, 30);
  fireEvent(window, new Event('resize'));
  await finish();
  expect(view.dialog.style.transform).toBe('translateY(0px)');
  view.pointer('pointerdown', 100, 100);
  view.pointer('pointermove', 140, 130);
  fireEvent(view.dialog, new Event('cancel', { cancelable: true, bubbles: true }));
  expect(view.close).toHaveBeenCalledOnce();
  view.setOpen(false);
  expect(view.handle.hasPointerCapture(1)).toBe(false);
  reduced.matches = true;
  act(() => reduced.dispatchEvent(new Event('change')));
  expect(view.dialog).not.toHaveAttribute('open');
  view.setOpen(true);
  expect(view.dialog).toHaveAttribute('data-sheet-phase', 'open');
  view.setOpen(false);
  expect(view.dialog).not.toHaveAttribute('open');
  view.unmount();
  view.opener.remove();
});
it('immediate route/modal handoff and unmount cancel animations and listeners without stale focus restoration', async () => {
  const view = setup();
  await finish();
  view.setOpen(false, true);
  expect(view.dialog).not.toHaveAttribute('open');
  expect(view.opener).not.toHaveFocus();
  view.setOpen(true);
  view.pointer('pointerdown', 100, 0);
  const stale = pending.slice(-2);
  view.unmount();
  expect(view.handle.hasPointerCapture(1)).toBe(false);
  await act(async () => {
    stale.forEach((animation) => animation.finish());
  });
  const count = pending.length;
  fireEvent(window, new Event('resize'));
  view.pointer('pointermove', 200, 50);
  expect(pending).toHaveLength(count);
  expect(view.dialog).not.toHaveAttribute('open');
  view.opener.remove();
});
