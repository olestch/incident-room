import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { installVirtualLayout } from '@/shared/testing/virtual-layout';
import { MeasuredStream } from '@/shared/ui/measured-stream';
import { ScrollDebugProvider } from './use-scroll-debug';
beforeEach(installVirtualLayout);
function stream(enabled = true) {
  return render(
    <ScrollDebugProvider enabled={enabled}>
      <MeasuredStream
        rows={[{ key: 'technical-key' }]}
        label="Timeline"
        highlight={null}
        targetActive={false}
        renderRow={() => 'PRIVATE MESSAGE SENTINEL'}
      />
    </ScrollDebugProvider>,
  );
}
it('creates no controls with diagnostics disabled', () => {
  stream(false);
  expect(screen.queryByLabelText('Scroll diagnostics')).toBeNull();
});
it('isolates controls outside the viewport, starts/stops and copies technical data only', async () => {
  const clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard },
  });
  stream();
  fireEvent.click(screen.getByRole('button', { name: /Scroll debug/ }));
  const viewport = screen.getByLabelText('Timeline viewport');
  expect(viewport.contains(screen.getByLabelText('Scroll diagnostics'))).toBe(false);
  const original = viewport.scrollTo;
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  expect(viewport.scrollTo).not.toBe(original);
  act(() => {
    fireEvent.wheel(viewport, { deltaY: 30 });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
  expect(viewport.scrollTo).toBe(original);
  fireEvent.click(screen.getByRole('button', { name: 'Copy log' }));
  await waitFor(() => expect(clipboard).toHaveBeenCalled());
  const log = JSON.parse(clipboard.mock.calls[0]![0] as string);
  expect(log.events.some((event: { type: string }) => event.type === 'wheel')).toBe(true);
  expect(clipboard.mock.calls[0]![0]).not.toContain('PRIVATE MESSAGE SENTINEL');
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.getByRole('button', { name: /Scroll debug/ })).toHaveTextContent('Stopped · 0');
});
it('restores native delegation and observers on unmount while recording', () => {
  const view = stream();
  fireEvent.click(screen.getByRole('button', { name: /Scroll debug/ }));
  const viewport = screen.getByLabelText('Timeline viewport');
  const original = viewport.scrollTo;
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  view.unmount();
  expect(viewport.scrollTo).toBe(original);
});
it('delegates scoped native writes exactly once with unchanged receiver and arguments', () => {
  stream();
  fireEvent.click(screen.getByRole('button', { name: /Scroll debug/ }));
  const viewport = screen.getByLabelText('Timeline viewport');
  const delegate = vi.fn(function (this: HTMLElement) {
    expect(this).toBe(viewport);
  });
  Object.defineProperty(viewport, 'scrollTo', {
    value: delegate,
    configurable: true,
    writable: true,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  const request = { top: 42, behavior: 'auto' as const };
  viewport.scrollTo(request);
  expect(delegate).toHaveBeenCalledExactlyOnceWith(request);
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
  expect(viewport.scrollTo).toBe(delegate);
  expect(Object.getOwnPropertyDescriptor(viewport, 'scrollTo')?.writable).toBe(true);
});
it('enabling and disabling diagnostics leaves pending target navigation intact', async () => {
  const { createRef } = await import('react');
  const ref = createRef<import('@/shared/messaging/target-navigation').TimelineViewport>();
  const controller = new AbortController();
  const content = (
    <MeasuredStream
      ref={ref}
      rows={[]}
      label="Timeline"
      highlight={null}
      targetActive={true}
      renderRow={() => null}
    />
  );
  const view = render(<ScrollDebugProvider enabled={false}>{content}</ScrollDebugProvider>);
  const settled = vi.fn();
  let task!: Promise<unknown>;
  act(() => {
    task = ref.current!.reveal('not-loaded-yet', controller.signal).then(settled, settled);
  });
  view.rerender(<ScrollDebugProvider enabled={true}>{content}</ScrollDebugProvider>);
  view.rerender(<ScrollDebugProvider enabled={false}>{content}</ScrollDebugProvider>);
  await act(async () => {});
  expect(settled).not.toHaveBeenCalled();
  act(() => controller.abort());
  await task;
  expect(settled).toHaveBeenCalledOnce();
});
it('preserves Virtual no-ops for stale measurements after rows are removed', async () => {
  const { Virtualizer, elementScroll } = await import('@tanstack/react-virtual');
  const { ScrollRecorder } = await import('./scroll-recorder');
  const { attachScrollDebug } = await import('./use-scroll-debug');
  const element = document.createElement('div');
  document.body.append(element);
  const virtual = new Virtualizer<HTMLDivElement, HTMLLIElement>({
    count: 1,
    getScrollElement: () => element,
    getItemKey: (index) => {
      if (index !== 0) throw new Error('Removed row key accessed');
      return 'row';
    },
    estimateSize: () => 100,
    scrollToFn: elementScroll,
    observeElementRect: () => undefined,
    observeElementOffset: () => undefined,
  });
  const recorder = new ScrollRecorder();
  recorder.start();
  const original = virtual.resizeItem;
  const dispose = attachScrollDebug(
    { recorder, viewports: new Set() },
    virtual,
    element,
    'Timeline',
    { current: { items: [], state: () => ({}) } },
    { current: () => {} },
    { current: null },
  );
  expect(() => virtual.resizeItem(-1, 100)).not.toThrow();
  expect(() => virtual.resizeItem(1, 100)).not.toThrow();
  dispose();
  expect(virtual.resizeItem).toBe(original);
  element.remove();
});
