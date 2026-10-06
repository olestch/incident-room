import type { QueryClient, InfiniteData } from '@tanstack/react-query';
import { createDiagnostics } from '@/shared/diagnostics/diagnostics';
import {
  notificationKeys,
  mergeNotification,
  mergeUnread,
  type Notification,
  type NotificationPage,
  type UnreadSummary,
} from '@/entities/notification/model';
export function cacheNotification(
  cache: QueryClient,
  user: string,
  workspace: string,
  notification: Notification,
) {
  if (notification.recipientUserId !== user || notification.workspaceId !== workspace)
    throw new Error('Notification scope mismatch');
  const key = notificationKeys.record(user, workspace, notification.id);
  cache.setQueryData<Notification>(key, (previous) => mergeNotification(previous, notification));
  return cache.getQueryData<Notification>(key)!;
}
export function cacheUnread(
  cache: QueryClient,
  user: string,
  workspace: string,
  summary: UnreadSummary,
) {
  if (summary.recipientUserId !== user || summary.workspaceId !== workspace)
    throw new Error('Unread scope mismatch');
  cache.setQueryData<UnreadSummary>(notificationKeys.unread(user, workspace), (previous) =>
    mergeUnread(previous, summary),
  );
  return cache.getQueryData<UnreadSummary>(notificationKeys.unread(user, workspace))!;
}
export function applyNotification(
  cache: QueryClient,
  user: string,
  workspace: string,
  notification: Notification,
  unread: UnreadSummary,
) {
  createDiagnostics().record({ event: 'notification_received' });
  const next = cacheNotification(cache, user, workspace, notification);
  cacheUnread(cache, user, workspace, unread);
  cache.setQueryData<InfiniteData<NotificationPage>>(
    notificationKeys.inbox(user, workspace),
    (previous) =>
      previous
        ? {
            ...previous,
            pages: previous.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                item.id === next.id ? mergeNotification(item, next) : item,
              ),
              unread: mergeUnread(page.unread, unread),
            })),
          }
        : previous,
  );
  void cache.invalidateQueries({ queryKey: notificationKeys.inbox(user, workspace) });
}
