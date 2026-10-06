import { beforeEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { z } from 'zod';
import { notificationSchema } from '@/entities/notification/model';
import { NotificationsPage } from './notifications-page';
const fake = vi.hoisted(() => ({
  notification: null as unknown,
  read: false,
  revision: 1,
  calls: [] as unknown[],
  push: vi.fn(),
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
        const item = notificationSchema.parse(fake.notification);
        if (path === '/notifications/read') {
          fake.calls.push(body);
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
  fake.revision = 1;
  fake.calls = [];
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
