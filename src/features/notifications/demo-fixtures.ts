import { notificationSchema, type Notification } from '@/entities/notification/model';
import type { AtomicStore } from '@/shared/persistence/atomic-store';
import type { NotificationData } from './authority';

/** Stable fictional examples backed by existing lazy Timeline/Thread fixtures. */
export const demoNotificationExamples: readonly { actorId: string; notification: Notification }[] =
  [
    {
      actorId: 'demo-river',
      notification: {
        id: '00000000-0000-4000-8000-000000000301',
        workspaceId: 'demo-orbit',
        recipientUserId: 'demo-sage',
        type: 'assigned',
        createdAt: '2026-09-01T09:01:40.000Z',
        readAt: null,
        revision: 1,
        context: 'River Vale added you to INC-2841 · Elevated edge latency',
        target: { type: 'timeline', number: 'INC-2841', entry: 'fictional-incident-2841:evt-6' },
      },
    },
    {
      actorId: 'demo-river',
      notification: {
        id: '00000000-0000-4000-8000-000000000302',
        workspaceId: 'demo-orbit',
        recipientUserId: 'demo-sage',
        type: 'severity_changed',
        createdAt: '2026-09-01T09:01:20.000Z',
        readAt: null,
        revision: 1,
        context: 'River Vale raised INC-2841 to P1 · Elevated edge latency',
        target: { type: 'timeline', number: 'INC-2841', entry: 'fictional-incident-2841:evt-5' },
      },
    },
    {
      actorId: 'demo-river',
      notification: {
        id: '00000000-0000-4000-8000-000000000303',
        workspaceId: 'demo-orbit',
        recipientUserId: 'demo-sage',
        type: 'thread_reply',
        createdAt: '2026-09-01T10:00:00.000Z',
        readAt: null,
        revision: 1,
        context: 'River Vale replied in INC-2841 · Queue measurements discussion',
        target: {
          type: 'thread',
          number: 'INC-2841',
          root: 'fictional-incident-2841:evt-42',
          message: 'fictional-incident-2841:reply-42-1',
        },
      },
    },
    {
      actorId: 'demo-river',
      notification: {
        id: '00000000-0000-4000-8000-000000000304',
        workspaceId: 'demo-orbit',
        recipientUserId: 'demo-sage',
        type: 'status_changed',
        createdAt: '2026-09-01T09:01:00.000Z',
        readAt: '2026-09-01T09:02:00.000Z',
        revision: 1,
        context: 'River Vale began investigating INC-2841 · Elevated edge latency',
        target: { type: 'timeline', number: 'INC-2841', entry: 'fictional-incident-2841:evt-4' },
      },
    },
    {
      actorId: 'demo-sage',
      notification: {
        id: '00000000-0000-4000-8000-000000000305',
        workspaceId: 'demo-orbit',
        recipientUserId: 'demo-river',
        type: 'thread_reply',
        createdAt: '2026-09-01T10:00:01.000Z',
        readAt: null,
        revision: 1,
        context: 'Sage Linden replied in INC-2841 · Queue measurements discussion',
        target: {
          type: 'thread',
          number: 'INC-2841',
          root: 'fictional-incident-2841:evt-42',
          message: 'fictional-incident-2841:reply-42-2',
        },
      },
    },
    {
      actorId: 'demo-sage',
      notification: {
        id: '00000000-0000-4000-8000-000000000306',
        workspaceId: 'demo-orbit',
        recipientUserId: 'demo-river',
        type: 'thread_reply',
        createdAt: '2026-09-01T10:00:03.000Z',
        readAt: '2026-09-01T10:05:00.000Z',
        revision: 1,
        context: 'Sage Linden replied in INC-2841 · Recent response discussion',
        target: {
          type: 'thread',
          number: 'INC-2841',
          root: 'fictional-incident-2841:evt-4000',
          message: 'fictional-incident-2841:reply-4000-4',
        },
      },
    },
  ];

/** Upgrade once in the same authority transaction; never reseed read state on reload. */
export function withDemoNotificationFixtures(
  store: AtomicStore<NotificationData>,
): AtomicStore<NotificationData> {
  return {
    transact: (key, operation) =>
      store.transact(key, (data) => {
        if (key === 'demo-orbit' && data.demoFixtureVersion < 1) {
          const added: Notification[] = [];
          for (const { actorId, notification: raw } of demoNotificationExamples) {
            const notification = notificationSchema.parse(raw);
            if (actorId === notification.recipientUserId) throw new Error('Invalid demo recipient');
            const source =
              notification.target.type === 'timeline'
                ? 'timeline:' + notification.target.entry
                : notification.target.type === 'thread'
                  ? 'thread:' + notification.target.message
                  : 'demo:' + notification.id;
            const receipt = JSON.stringify([source, notification.recipientUserId]);
            if (data.receipts[receipt] || data.items.some((item) => item.id === notification.id))
              continue;
            data.items.push(notification);
            added.push(notification);
            data.revisions[notification.recipientUserId] =
              (data.revisions[notification.recipientUserId] ?? 0) + 1;
            data.receipts[receipt] = true;
          }
          data.demoFixtureVersion = 1;
          for (const current of added) {
            data.changes.push({
              notification: structuredClone(current),
              unread: {
                workspaceId: key,
                recipientUserId: current.recipientUserId,
                count: data.items.filter(
                  (item) => item.recipientUserId === current.recipientUserId && !item.readAt,
                ).length,
                revision: data.revisions[current.recipientUserId] ?? 0,
              },
            });
          }
        }
        return operation(data);
      }),
  };
}
