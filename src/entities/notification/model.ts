import { z } from 'zod';
import { queryScope } from '@/shared/query/query-scope';
export const notificationTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('incident'), number: z.string().regex(/^INC-\d+$/) }),
  z.object({
    type: z.literal('timeline'),
    number: z.string().regex(/^INC-\d+$/),
    entry: z.string().min(1).max(160),
  }),
  z.object({
    type: z.literal('thread'),
    number: z.string().regex(/^INC-\d+$/),
    root: z.string().min(1).max(160),
    message: z.string().min(1).max(400),
  }),
]);
export const notificationSchema = z.object({
  id: z.uuid(),
  workspaceId: z.string().min(1),
  recipientUserId: z.string().min(1),
  type: z.enum([
    'assigned',
    'timeline_mention',
    'thread_mention',
    'severity_changed',
    'status_changed',
    'thread_reply',
  ]),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  revision: z.number().int().positive(),
  context: z.string().max(240),
  target: notificationTargetSchema,
});
export type Notification = z.infer<typeof notificationSchema>;
export const unreadSchema = z.object({
  workspaceId: z.string(),
  recipientUserId: z.string(),
  count: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
});
export type UnreadSummary = z.infer<typeof unreadSchema>;
export const notificationChangeSchema = z
  .object({ notification: notificationSchema, unread: unreadSchema })
  .refine(
    (value) =>
      value.notification.workspaceId === value.unread.workspaceId &&
      value.notification.recipientUserId === value.unread.recipientUserId,
    'Notification recipient mismatch',
  );
export const notificationPageSchema = z.object({
  items: z.array(notificationSchema).max(20),
  nextCursor: z.string().nullable(),
  unread: unreadSchema,
});
export type NotificationPage = z.infer<typeof notificationPageSchema>;
export const notificationKeys = {
  all: (user: string, workspace: string) =>
    [...queryScope(user, workspace), 'notifications'] as const,
  inbox: (user: string, workspace: string) =>
    [...notificationKeys.all(user, workspace), 'inbox'] as const,
  unread: (user: string, workspace: string) =>
    [...notificationKeys.all(user, workspace), 'unread'] as const,
  record: (user: string, workspace: string, id: string) =>
    [...notificationKeys.all(user, workspace), 'record', id] as const,
};
export const mergeNotification = (previous: Notification | undefined, next: Notification) =>
  previous && previous.revision >= next.revision ? previous : next;
export const mergeUnread = (previous: UnreadSummary | undefined, next: UnreadSummary) =>
  previous && previous.revision >= next.revision ? previous : next;
export function notificationDestination(notification: Notification) {
  const target = notification.target;
  const path = `/app/incidents/${target.number}`;
  if (target.type === 'incident') return path;
  return `${path}?${new URLSearchParams(target.type === 'timeline' ? { event: target.entry } : { thread: target.root, message: target.message })}`;
}
