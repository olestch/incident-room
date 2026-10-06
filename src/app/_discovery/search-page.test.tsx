import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { z } from 'zod';
import { AppError } from '@/shared/errors/app-error';
import type { SearchPage as SearchResponse } from '@/entities/search/model';
import { SearchPage } from './search-page';
const nav = vi.hoisted(() => ({ query: '', listeners: new Set<() => void>() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: (href: string) => {
      nav.query = new URL(href, 'http://localhost').search;
      for (const listener of nav.listeners) listener();
    },
    push: (href: string) => {
      nav.query = new URL(href, 'http://localhost').search;
      for (const listener of nav.listeners) listener();
    },
  }),
  useSearchParams: () =>
    new URLSearchParams(
      useSyncExternalStore(
        (listener) => {
          nav.listeners.add(listener);
          return () => nav.listeners.delete(listener);
        },
        () => nav.query,
        () => nav.query,
      ),
    ),
}));
const runtime = vi.hoisted(() => ({
  read: null as
    null | ((query: string, cursor: string | null, signal: AbortSignal) => Promise<unknown>),
  requests: [] as { query: string; cursor: string | null; signal: AbortSignal }[],
}));
vi.mock('@/app/_providers/session-provider', () => ({
  useSessionRuntime: () => ({
    state: {
      status: 'authenticated',
      generation: 1,
      identity: { userId: 'demo-river', workspaceId: 'demo-orbit' },
    },
    coordinator: {
      request: <T,>(
        operation: (signal: AbortSignal) => Promise<T>,
        _policy: string,
        signal: AbortSignal,
      ) => operation(signal),
    },
    adapter: {
      resource: async <T,>(path: string, schema: z.ZodType<T>, signal: AbortSignal) => {
        const params = new URL(path, 'http://localhost').searchParams;
        const query = params.get('q') ?? '',
          cursor = params.get('cursor');
        runtime.requests.push({ query, cursor, signal });
        return schema.parse(await runtime.read!(query, cursor, signal));
      },
    },
  }),
}));
const page = (title: string, cursor: string | null = null): SearchResponse => ({
  items: [
    {
      type: 'incident',
      id: title,
      incidentNumber: 'INC-2841',
      title,
      snippet: title,
      score: 100,
      time: '2026-09-01T10:00:00.000Z',
      severity: 'P1',
      status: 'triggered',
      serviceIds: [],
    },
  ],
  nextCursor: cursor,
});
let cache: QueryClient;
beforeEach(() => {
  nav.query = '';
  runtime.requests = [];
  runtime.read = async (query) => page(query);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => cache.clear());
function mount() {
  return render(
    <QueryClientProvider client={cache}>
      <SearchPage />
    </QueryClientProvider>,
  );
}
it('initial and minimum states do not request, and interactive input debounces', async () => {
  mount();
  expect(screen.getByText('Search incidents, messages and workspace users.')).toBeVisible();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'x' } });
  await waitFor(() => expect(screen.getByText('Enter at least two characters.')).toBeVisible());
  expect(runtime.requests).toHaveLength(0);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'gate' } });
  expect(runtime.requests).toHaveLength(0);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'gateway' } });
  await screen.findByRole('link', { name: 'gateway' });
  expect(runtime.requests.map((request) => request.query)).toEqual(['gateway']);
});
it('late A cannot replace B, does not announce no results during pending, and retains focus', async () => {
  let resolveA: (result: unknown) => void = () => {};
  runtime.read = async (query) =>
    query === 'gate'
      ? new Promise((resolve) => {
          resolveA = resolve;
        })
      : page('Latest gateway');
  mount();
  const input = screen.getByRole('searchbox');
  input.focus();
  fireEvent.change(input, { target: { value: 'gate' } });
  await waitFor(() => expect(runtime.requests).toHaveLength(1));
  expect(screen.getByRole('status')).toHaveTextContent('Searching');
  expect(screen.queryByText(/0 results/)).toBeNull();
  fireEvent.change(input, { target: { value: 'gateway' } });
  await screen.findByRole('link', { name: 'Latest gateway' });
  await act(async () => resolveA(page('Stale gate')));
  expect(screen.queryByRole('link', { name: 'Stale gate' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Latest gateway' })).toBeVisible();
  expect(input).toHaveFocus();
  expect(runtime.requests[0]!.signal.aborted).toBe(true);
});
it('URL back/forward restores committed query without remounting input', async () => {
  nav.query = '?q=first';
  mount();
  await screen.findByRole('link', { name: 'first' });
  const input = screen.getByRole('searchbox');
  await act(async () => {
    nav.query = '?q=second';
    for (const listener of nav.listeners) listener();
  });
  await screen.findByRole('link', { name: 'second' });
  expect(input).toHaveValue('second');
  expect(screen.getByRole('searchbox')).toBe(input);
});
it('query change resets pagination and Load more uses bounded cursor', async () => {
  runtime.read = async (query, cursor) => page(`${query}${cursor ?? ''}`, cursor ? null : 'next');
  mount();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Aurora' } });
  await screen.findByRole('link', { name: 'Aurora' });
  fireEvent.click(screen.getByRole('button', { name: 'Load more results' }));
  await screen.findByRole('link', { name: 'Auroranext' });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Cedar' } });
  await screen.findByRole('link', { name: 'Cedar' });
  expect(screen.queryByRole('link', { name: 'Auroranext' })).toBeNull();
  expect(runtime.requests.at(-1)?.cursor).toBeNull();
});
it('retry preserves query and error is never a fabricated empty result', async () => {
  let failure = true;
  runtime.read = async (query) => {
    if (failure) throw new AppError('network', 'Unavailable', 503);
    return page(query);
  };
  nav.query = '?q=Gateway';
  mount();
  await screen.findByRole('button', { name: 'Retry Search' });
  expect(screen.getByRole('searchbox')).toHaveValue('Gateway');
  expect(screen.queryByText(/0 results/)).toBeNull();
  failure = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry Search' }));
  await screen.findByRole('link', { name: 'Gateway' });
});
it('empty server result is shown only after successful query', async () => {
  runtime.read = async () => ({ items: [], nextCursor: null });
  nav.query = '?q=missing';
  mount();
  await screen.findByText('0 results shown for “missing”. Try different words.');
});
