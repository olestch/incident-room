import { _resetIOSDetectionForTests, Virtualizer } from '@tanstack/react-virtual';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone Safari');
  _resetIOSDetectionForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  _resetIOSDetectionForTests();
});

function setup() {
  const element = document.createElement('div');
  document.body.append(element);
  let observe!: (offset: number, scrolling: boolean) => void;
  let keys = Array.from({ length: 20 }, (_, index) => `row-${index}`);
  const write = vi.fn((offset: number, { adjustments = 0 }: { adjustments?: number }) => {
    element.scrollTop = offset + adjustments;
  });
  const change = vi.fn();
  const virtual = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: keys.length,
    getItemKey: (index) => keys[index]!,
    getScrollElement: () => element,
    estimateSize: () => 100,
    initialOffset: 500,
    initialRect: { width: 375, height: 200 },
    anchorTo: 'end',
    scrollToFn: write,
    onChange: change,
    observeElementRect: () => undefined,
    observeElementOffset: (_instance, callback) => {
      observe = callback;
      return () => {};
    },
  });
  virtual.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    item.end <= (instance.scrollOffset ?? 0);
  Object.defineProperty(element, 'clientHeight', { value: 200 });
  Object.defineProperty(element, 'scrollHeight', { get: () => virtual.getTotalSize() });
  const unmount = virtual._didMount();
  virtual._willUpdate();
  virtual.getVirtualItems();
  write.mockClear();
  change.mockClear();
  return {
    element,
    virtual,
    write,
    change,
    scroll(offset: number, scrolling: boolean) {
      element.scrollTop = offset;
      observe(offset, scrolling);
      change.mockClear();
    },
    prepend() {
      keys = ['older', ...keys];
      virtual.setOptions({ ...virtual.options, count: keys.length });
      virtual.getVirtualItems();
      virtual._willUpdate();
    },
    dispose() {
      unmount();
      element.remove();
    },
  };
}

it('commits wheel measurements synchronously and has no correction left for idle', () => {
  const view = setup();
  view.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -2 }));
  view.scroll(498, true);
  view.virtual.resizeItem(0, 140);
  view.virtual.resizeItem(0, 180);
  expect(view.element.scrollTop).toBe(578);
  expect(view.write).toHaveBeenCalledTimes(2);
  expect(view.change.mock.calls.every(([, sync]) => sync === true)).toBe(true);
  view.virtual.resizeItem(0, 180);
  view.scroll(578, false);
  vi.runAllTimers();
  expect(view.write).toHaveBeenCalledTimes(2);
  view.dispose();
});

it.each(['touch', 'wheel then touch', 'touch then wheel'])(
  '%s preserves touch deferral and flushes once after the grace period',
  (input) => {
    const view = setup();
    if (input === 'wheel then touch') view.element.dispatchEvent(new WheelEvent('wheel'));
    view.element.dispatchEvent(new Event('touchstart'));
    if (input === 'touch then wheel') view.element.dispatchEvent(new WheelEvent('wheel'));
    view.scroll(498, true);
    view.virtual.resizeItem(0, 140);
    view.virtual.resizeItem(0, 180);
    expect(view.write).not.toHaveBeenCalled();
    expect(view.change.mock.calls.every(([, sync]) => sync === false)).toBe(true);
    view.element.dispatchEvent(new Event('touchend'));
    view.scroll(498, false);
    vi.advanceTimersByTime(149);
    expect(view.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(view.write).toHaveBeenCalledOnce();
    expect(view.element.scrollTop).toBe(578);
    view.scroll(578, false);
    vi.runAllTimers();
    expect(view.write).toHaveBeenCalledOnce();
    view.dispose();
  },
);

it('a wheel event cannot take over queued momentum after touchend', () => {
  const view = setup();
  view.element.dispatchEvent(new Event('touchstart'));
  view.scroll(498, true);
  view.virtual.resizeItem(0, 140);
  view.element.dispatchEvent(new Event('touchend'));
  vi.advanceTimersByTime(150);
  view.element.dispatchEvent(new WheelEvent('wheel'));
  view.virtual.resizeItem(0, 180);
  expect(view.write).not.toHaveBeenCalled();
  view.scroll(498, false);
  expect(view.write).toHaveBeenCalledOnce();
  expect(view.element.scrollTop).toBe(578);
  view.dispose();
});

it('wheel prepend uses the existing synchronous key anchor rather than an idle flush', () => {
  const view = setup();
  view.element.dispatchEvent(new WheelEvent('wheel', { deltaY: -2 }));
  view.scroll(498, true);
  view.prepend();
  expect(view.element.scrollTop).toBe(598);
  expect(view.write).toHaveBeenCalledOnce();
  view.scroll(598, false);
  expect(view.write).toHaveBeenCalledOnce();
  view.dispose();
});
