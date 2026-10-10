import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installVirtualLayout } from '@/shared/testing/virtual-layout';
import type { TimelineViewport } from '@/shared/messaging/target-navigation';
import { MeasuredStream } from './measured-stream';

beforeEach(installVirtualLayout);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  const ref = createRef<TimelineViewport>();
  const onUserScroll = vi.fn();
  const props = {
    label: 'Timeline',
    highlight: null,
    targetActive: true,
    renderRow: () => 'Fictional entry',
    onUserScroll,
  };
  const view = render(<MeasuredStream {...props} ref={ref} rows={[]} />);
  const reveal = (id = 'target') => {
    const controller = new AbortController();
    let result!: Promise<unknown>;
    act(() => {
      result = ref.current!.reveal(id, controller.signal).then(
        () => 'revealed',
        (error) => error,
      );
    });
    return { controller, result };
  };
  return { ...view, ref, props, reveal, onUserScroll };
}
it('resolves only when the requested row has committed into the viewport', async () => {
  const view = setup();
  const task = view.reveal();
  const complete = vi.fn();
  void task.result.then(complete);
  await act(async () => {});
  expect(complete).not.toHaveBeenCalled();
  view.rerender(
    <MeasuredStream
      {...view.props}
      ref={view.ref}
      rows={[{ key: 'row', entry: { id: 'target' } }]}
    />,
  );
  await waitFor(() => expect(complete).toHaveBeenCalledWith('revealed'));
});
it('aborted readiness cannot resume when its row arrives later', async () => {
  const view = setup();
  const task = view.reveal();
  act(() => task.controller.abort());
  expect(await task.result).toMatchObject({ name: 'AbortError' });
  view.rerender(
    <MeasuredStream
      {...view.props}
      ref={view.ref}
      rows={[{ key: 'row', entry: { id: 'target' } }]}
    />,
  );
  expect(await task.result).toMatchObject({ name: 'AbortError' });
});
it('superseding the same ID removes the old abort listener without cancelling its replacement', async () => {
  const view = setup();
  const first = view.reveal();
  const second = view.reveal();
  expect(await first.result).toMatchObject({ name: 'AbortError' });
  act(() => first.controller.abort());
  view.rerender(
    <MeasuredStream
      {...view.props}
      ref={view.ref}
      rows={[{ key: 'row', entry: { id: 'target' } }]}
    />,
  );
  expect(await second.result).toBe('revealed');
});
it('Latest cancels a pending reveal', async () => {
  const view = setup();
  const task = view.reveal();
  act(() => view.ref.current!.latest());
  expect(await task.result).toMatchObject({ name: 'AbortError' });
});
it('unmount rejects pending readiness and removes its signal listener', async () => {
  const view = setup();
  const task = view.reveal();
  const remove = vi.spyOn(task.controller.signal, 'removeEventListener');
  view.unmount();
  expect(await task.result).toMatchObject({ name: 'AbortError' });
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});
it.each(['wheel', 'touchMove', 'keyDown'] as const)(
  '%s transfers pending reveal ownership to user input',
  async (kind) => {
    const view = setup();
    const task = view.reveal();
    const viewport = screen.getByLabelText('Timeline viewport');
    if (kind === 'keyDown') fireEvent.keyDown(viewport, { key: 'PageUp' });
    else fireEvent[kind](viewport);
    expect(await task.result).toMatchObject({ name: 'AbortError' });
    expect(view.onUserScroll).toHaveBeenCalledOnce();
  },
);
it('scroll observations do not cancel navigation', async () => {
  const view = setup();
  const task = view.reveal();
  fireEvent.scroll(screen.getByLabelText('Timeline viewport'));
  expect(view.onUserScroll).not.toHaveBeenCalled();
  act(() => task.controller.abort());
  expect(await task.result).toMatchObject({ name: 'AbortError' });
});
it('scroll keys in a row editor do not cancel navigation', async () => {
  const view = setup();
  view.rerender(
    <MeasuredStream
      {...view.props}
      renderRow={() => <textarea aria-label="Nested editor" />}
      ref={view.ref}
      rows={[{ key: 'existing' }]}
    />,
  );
  const task = view.reveal();
  fireEvent.keyDown(screen.getByLabelText('Nested editor'), { key: 'ArrowUp' });
  expect(view.onUserScroll).not.toHaveBeenCalled();
  act(() => task.controller.abort());
  expect(await task.result).toMatchObject({ name: 'AbortError' });
});

it('a target already visible can resolve without another scroll event', async () => {
  const view = setup();
  view.rerender(
    <MeasuredStream
      {...view.props}
      ref={view.ref}
      rows={[{ key: 'row', entry: { id: 'target' } }]}
    />,
  );
  expect(await view.reveal().result).toBe('revealed');
});
