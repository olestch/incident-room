'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  useQuery,
  skipToken,
} from '@tanstack/react-query';
import { z } from 'zod';
import {
  notificationKeys,
  notificationPageSchema,
  notificationDestination,
  unreadSchema,
  type Notification,
  type UnreadSummary,
} from '@/entities/notification/model';
import { NotificationInbox } from '@/features/notifications/views';
import { useSessionRuntime } from '@/app/_providers/session-provider';
import { cacheNotification, cacheUnread } from './notification-cache';
import { InlineAlert } from '@/shared/ui/primitives';
import { useCommands } from './commands-context';
export function NotificationsPage() {
  const { state } = useSessionRuntime();
  if (!('identity' in state)) return null;
  return (
    <IdentityInbox
      key={`${state.generation}:${state.identity.userId}`}
      userId={state.identity.userId}
      workspaceId={state.identity.workspaceId}
    />
  );
}
function IdentityInbox({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const { coordinator, adapter } = useSessionRuntime();
  const cache = useQueryClient();
  const router = useRouter();
  const commands = useCommands();
  const [issue, setIssue] = useState<string | null>(null);
  const unread = useQuery<UnreadSummary>({
    queryKey: notificationKeys.unread(userId, workspaceId),
    queryFn: skipToken,
    enabled: false,
  });
  const inbox = useInfiniteQuery({
    queryKey: notificationKeys.inbox(userId, workspaceId),
    initialPageParam: null as string | null,
    queryFn: async ({ signal, pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set('cursor', pageParam);
      const page = await coordinator.request(
        (s) => adapter.resource(`/notifications?${params}`, notificationPageSchema, s),
        'safe-read',
        signal,
      );
      signal.throwIfAborted();
      return {
        ...page,
        items: page.items.map((item) => cacheNotification(cache, userId, workspaceId, item)),
        unread: cacheUnread(cache, userId, workspaceId, page.unread),
      };
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const mutation = useMutation({
    mutationFn: ({ id, read }: { id: string | null; read: boolean }) =>
      coordinator.request(
        (s) =>
          adapter.resource('/notifications/read', z.object({ unread: unreadSchema }), s, {
            id,
            read,
          }),
        'mutation',
      ),
    onSuccess: async (result) => {
      cacheUnread(cache, userId, workspaceId, result.unread);
      await cache.invalidateQueries({ queryKey: notificationKeys.inbox(userId, workspaceId) });
    },
    onError: (error) => setIssue(error.message),
  });
  const mark = async (id: string | null, read: boolean) => {
    setIssue(null);
    await mutation.mutateAsync({ id, read });
  };
  const activate = async (item: Notification) => {
    if (mutation.isPending) return;
    const generation = coordinator.snapshot().generation;
    try {
      await mark(item.id, true);
    } catch (error) {
      commands?.announceReadFailure(error instanceof Error ? error.message : undefined);
    }
    const state = coordinator.snapshot();
    if (
      state.generation === generation &&
      'identity' in state &&
      state.identity.userId === userId &&
      state.identity.workspaceId === workspaceId
    )
      router.push(notificationDestination(item));
  };
  const unique = new Map(
    (inbox.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.id, item]),
  );
  return (
    <>
      <NotificationInbox
        loading={inbox.isLoading}
        unreadCount={unread.data?.count}
        items={[...unique.values()]}
        busy={mutation.isPending || inbox.isFetchingNextPage}
        activate={(item) => void activate(item)}
        mark={(item, read) => void mark(item.id, read).catch(() => {})}
        markAll={() => void mark(null, true).catch(() => {})}
        more={Boolean(inbox.hasNextPage)}
        loadMore={() => void inbox.fetchNextPage({ cancelRefetch: false })}
        error={inbox.isError}
        retry={() => void inbox.refetch()}
      />
      {issue && (
        <InlineAlert className="secondary-page secondary-mutation-alert">
          Read state was not saved. {issue} You can retry from the inbox; navigation remains
          available.
        </InlineAlert>
      )}
    </>
  );
}
