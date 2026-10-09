import { beforeEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { z } from 'zod';
import { notificationSchema, notificationKeys } from '@/entities/notification/model';
import { NotificationsPage } from './notifications-page';
const fake = vi.hoisted(() => ({
  notification: null as unknown,
  read: false,
  failRead: false,
  notice: vi.fn(),
  revision: 1,
  calls: [] as unknown[],
  paths: [] as string[],
  push: vi.fn(),
}));
vi.mock('./commands-context', () => ({
  useCommands: () => ({ announceReadFailure: fake.notice }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: fake.push }) }));
vi.mock('@/app/_providers/session-provider', () => ({
  useSessionRuntime: () => ({
    state: { generation: 1, identity: { userId: 'sage', workspaceId: 'orbit' } },
    coordinator: {
      snapshot: () => ({ generation: 1, identity: { userId: 'sage', workspaceId: 'orbit' } }),
      request: <T,>(task: (s: AbortSignal) => Promise<T>) => task(new AbortController().signal),
    },
    adapter: {
      resource: async <T,>(
        path: string,
        schema: z.ZodType<T>,
        _signal: AbortSignal,
        body?: unknown,
      ) => {
        fake.paths.push(path);
        const item = notificationSchema.parse(fake.notification);
        if (path === '/notifications/read') {
          fake.calls.push(body);
          if (fake.failRead) throw new Error('Simulated read persistence failure.');
          const command = body as { id: string | null; read: boolean };
          fake.read = command.read;
          fake.revision++;
          return schema.parse({
            unread: {
              workspaceId: 'orbit',
              recipientUserId: 'sage',
              count: fake.read ? 0 : 1,
              revision: fake.revision,
            },
          });
        }
        return schema.parse({
          items: [{ ...item, revision: fake.revision, readAt: fake.read ? item.createdAt : null }],
          nextCursor: null,
          unread: {
            workspaceId: 'orbit',
            recipientUserId: 'sage',
            count: fake.read ? 0 : 1,
            revision: fake.revision,
          },
        });
      },
    },
  }),
}));
beforeEach(() => {
  fake.read = false;
  fake.failRead = false;
  fake.notice.mockClear();
  fake.revision = 1;
  fake.calls = [];
  fake.paths = [];
  fake.push.mockClear();
  fake.notification = {
    id: crypto.randomUUID(),
    workspaceId: 'orbit',
    recipientUserId: 'sage',
    type: 'timeline_mention',
    createdAt: '2026-09-01T10:00:00.000Z',
    readAt: null,
    revision: 1,
    context: 'INC-2841: mentioned you',
    target: { type: 'timeline', number: 'INC-2841', entry: 'entry' },
  };
});
it('mark one/read/unread/bulk sends domain command bodies, not fetch options, and refetches confirmed state', async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={cache}>
      <NotificationsPage />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /^Mark read$/ }));
  await screen.findByRole('button', { name: 'Mark unread' });
  expect(fake.calls[0]).toEqual({ id: notificationSchema.parse(fake.notification).id, read: true });
  fireEvent.click(screen.getByRole('button', { name: 'Mark unread' }));
  await screen.findByRole('button', { name: /^Mark read$/ });
  fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
  await screen.findByRole('button', { name: 'Mark unread' });
  expect(fake.calls.at(-1)).toEqual({ id: null, read: true });
  unmount();
  cache.clear();
});
it('activation marks read and navigates to validated exact destination', async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={cache}>
      <NotificationsPage />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('link', { name: 'INC-2841: mentioned you' }));
  await waitFor(() =>
    expect(fake.push).toHaveBeenCalledWith('/app/incidents/INC-2841?event=entry'),
  );
  expect(fake.calls[0]).toEqual({ id: notificationSchema.parse(fake.notification).id, read: true });
  unmount();
  cache.clear();
});

it('observes authoritative unread revisions without starting a second unread request', async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
    <QueryClientProvider client={cache}>
      <NotificationsPage />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: /^Mark read$/ });
  const key = notificationKeys.unread('sage', 'orbit');
  act(() => {
    cache.setQueryData(key, {
      workspaceId: 'orbit',
      recipientUserId: 'sage',
      count: 19,
      revision: 10,
    });
  });
  await waitFor(() =>
    expect(screen.getByLabelText('19 unread notifications')).toHaveTextContent('19'),
  );
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(cache.getQueryState(key)?.fetchStatus).toBe('idle');
  expect(fake.paths).not.toContain('/notifications/unread');
  unmount();
  cache.clear();
});

it('failed read preserves unread authority and useful error details while allowing exact navigation', async () => {
  fake.failRead = true;
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={cache}>
      <NotificationsPage />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /^Mark read$/ }));
  await screen.findByText(/Simulated read persistence failure/);
  expect(screen.getByLabelText('1 unread notifications')).toHaveTextContent('1');
  expect(screen.getByRole('button', { name: /^Mark read$/ })).toBeEnabled();
  fireEvent.click(screen.getByRole('link', { name: 'INC-2841: mentioned you' }));
  await waitFor(() =>
    expect(fake.push).toHaveBeenCalledWith('/app/incidents/INC-2841?event=entry'),
  );
  expect(fake.notice).toHaveBeenCalledWith('Simulated read persistence failure.');
  expect(fake.read).toBe(false);
  view.unmount();
  cache.clear();
});
