import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useListRealtime } from './use-list-realtime';

const mock = vi.hoisted(() => ({
  resource: vi.fn<(path: string, schema: unknown, signal: AbortSignal) => Promise<unknown>>(),
  session: {
    snapshot: () => ({
      generation: 1,
      identity: { userId: 'demo-river', workspaceId: 'demo-orbit' },
    }),
    request: (
      operation: (signal: AbortSignal) => Promise<unknown>,
      _mode: string,
      signal: AbortSignal,
    ) => operation(signal),
    registerLifecycle: () => () => {},
  },
}));
vi.mock('@/app/_providers/session-provider', () => ({
  useSessionRuntime: () => ({ coordinator: mock.session, adapter: { resource: mock.resource } }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  mock.resource.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => vi.useRealTimers());

const flush = async () => {
  for (let index = 0; index < 30; index++) await Promise.resolve();
};
function mount() {
  const cache = new QueryClient();
  const hook = renderHook(() => useListRealtime(true, 'demo-river', 'demo-orbit'), {
    wrapper: ({ children }) => <QueryClientProvider client={cache}>{children}</QueryClientProvider>,
  });
  return { ...hook, cache };
}

it('aborts workspace requests before MSW closes the departing document and stops later polling', async () => {
  let streams = 0;
  mock.resource.mockImplementation(async (path) => {
    if (path === '/realtime/open')
      return {
        highWater: 0,
        userId: 'demo-river',
        workspaceId: 'demo-orbit',
        incidentId: '__workspace__',
      };
    if (++streams === 1)
      return { events: [], highWater: 0, through: 0, expired: false, controls: {} };
    return new Promise(() => {});
  });
  const closed = vi.fn(() => expect(mock.resource.mock.calls.at(-1)![2].aborted).toBe(true));
  window.addEventListener('beforeunload', closed);
  const hook = mount();
  try {
    await act(async () => {
      await flush();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(streams).toBe(2);
    const requestsBeforeUnload = mock.resource.mock.calls.length;
    expect(mock.resource.mock.calls.at(-1)![0]).toMatch(/^\/realtime\/stream/);
    await act(async () => {
      window.dispatchEvent(new Event('beforeunload'));
      await flush();
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(mock.resource).toHaveBeenCalledTimes(requestsBeforeUnload);
  } finally {
    window.removeEventListener('beforeunload', closed);
    hook.unmount();
    hook.cache.clear();
  }
});

it('resumes the same authorized workspace when a hidden document is restored by pageshow', async () => {
  const hook = mount();
  try {
    const first = mock.resource.mock.calls[0]![2];
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
      await flush();
    });
    expect(first.aborted).toBe(true);
    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
      await flush();
    });
    expect(mock.resource).toHaveBeenCalledTimes(2);
    expect(mock.resource.mock.calls[1]![0]).toBe('/realtime/open');
    expect(mock.resource.mock.calls[1]![2].aborted).toBe(false);
  } finally {
    hook.unmount();
    hook.cache.clear();
  }
});

it('removes document listeners when the workspace subscription unmounts', async () => {
  const hook = mount();
  hook.unmount();
  hook.cache.clear();
  await act(async () => {
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('pagehide'));
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(mock.resource).toHaveBeenCalledTimes(1);
  expect(mock.resource.mock.calls[0]![2].aborted).toBe(true);
});
