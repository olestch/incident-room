import { z } from 'zod';
import { withDemoNotificationFixtures } from './demo-fixtures';
import {
  notificationSchema,
  notificationChangeSchema,
  type Notification,
  type UnreadSummary,
} from '@/entities/notification/model';
import { IndexedDbAtomicStore, type AtomicStore } from '@/shared/persistence/atomic-store';
import { AppError } from '@/shared/errors/app-error';
import { createDiagnostics } from '@/shared/diagnostics/diagnostics';

export const notificationAuthoritySchema = z.object({
  items: z.array(notificationSchema),
  demoFixtureVersion: z.number().int().nonnegative().default(0),
  receipts: z.record(z.string(), z.boolean()),
  revisions: z.record(z.string(), z.number().int().nonnegative()),
  changes: z.array(notificationChangeSchema),
  responseDelayMs: z.number().min(0).max(5000).default(0),
  failOnce: z.boolean().default(false),
});
export type NotificationData = z.infer<typeof notificationAuthoritySchema>;
export const seedNotifications = (): NotificationData => ({
  items: [],
  demoFixtureVersion: 0,
  receipts: {},
  revisions: {},
  changes: [],
  responseDelayMs: 0,
  failOnce: false,
});
export const makeNotificationStore = () =>
  withDemoNotificationFixtures(
    new IndexedDbAtomicStore('incident-room-fictional-notifications-v1', seedNotifications, (raw) =>
      notificationAuthoritySchema.parse(raw),
    ),
  );
export type NotificationActor = {
  id: string;
  workspaceId: string;
  status: 'active' | 'deactivated';
};
export type Activity = {
  source: string;
  actorId: string;
  workspaceId: string;
  occurredAt: string;
  type: Notification['type'];
  context: string;
  target: Notification['target'];
  recipients: readonly string[];
};
export function recipientIds(activity: Activity, eligible: readonly string[]) {
  const allowed = new Set(eligible);
  return [...new Set(activity.recipients)]
    .filter((id) => id !== activity.actorId && allowed.has(id))
    .sort();
}
export class MockNotificationAuthority {
  constructor(
    private readonly store: AtomicStore<NotificationData>,
    private readonly now = Date.now,
  ) {}
  private authorize(actor: NotificationActor) {
    if (actor.status !== 'active') throw new AppError('authorization', 'Inbox unavailable.', 403);
    return actor.workspaceId;
  }
  private count(data: NotificationData, workspaceId: string, user: string): UnreadSummary {
    return {
      workspaceId,
      recipientUserId: user,
      count: data.items.filter((item) => item.recipientUserId === user && !item.readAt).length,
      revision: data.revisions[user] ?? 0,
    };
  }
  async produce(activity: Activity, eligible: readonly string[]) {
    const recipients = recipientIds(activity, eligible);
    await this.store.transact(activity.workspaceId, (data) => {
      for (const recipient of recipients) {
        const receipt = JSON.stringify([activity.source, recipient]);
        if (data.receipts[receipt]) continue;
        const notification = notificationSchema.parse({
          id: crypto.randomUUID(),
          workspaceId: activity.workspaceId,
          recipientUserId: recipient,
          type: activity.type,
          createdAt: activity.occurredAt,
          readAt: null,
          revision: 1,
          context: activity.context,
          target: activity.target,
        });
        data.items.push(notification);
        data.receipts[receipt] = true;
        data.revisions[recipient] = (data.revisions[recipient] ?? 0) + 1;
        data.changes.push({
          notification,
          unread: this.count(data, activity.workspaceId, recipient),
        });
      }
    });
  }
  unread(actor: NotificationActor) {
    return this.store.transact(this.authorize(actor), (data) =>
      this.count(data, actor.workspaceId, actor.id),
    );
  }
  async page(actor: NotificationActor, cursor: string | null) {
    const result = await this.store.transact(this.authorize(actor), (data) => {
      const items = data.items
        .filter((item) => item.recipientUserId === actor.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      let start = 0;
      if (cursor) {
        try {
          const parsed = z
            .object({ workspace: z.string(), user: z.string(), id: z.string() })
            .parse(JSON.parse(atob(cursor)));
          const index = items.findIndex((item) => item.id === parsed.id);
          if (parsed.workspace !== actor.workspaceId || parsed.user !== actor.id || index < 0)
            throw new Error();
          start = index + 1;
        } catch {
          throw new AppError('validation', 'Invalid Inbox cursor.', 400);
        }
      }
      const page = items.slice(start, start + 20);
      return {
        items: page,
        nextCursor:
          start + page.length < items.length
            ? btoa(
                JSON.stringify({
                  workspace: actor.workspaceId,
                  user: actor.id,
                  id: page.at(-1)!.id,
                }),
              )
            : null,
        unread: this.count(data, actor.workspaceId, actor.id),
        delay: data.responseDelayMs,
      };
    });
    if (result.delay) await new Promise((resolve) => setTimeout(resolve, result.delay));
    return { items: result.items, nextCursor: result.nextCursor, unread: result.unread };
  }
  async mark(actor: NotificationActor, id: string | null, read: boolean) {
    createDiagnostics().record({ event: id ? 'notification_read' : 'notification_bulk_read' });
    const result = await this.store.transact(this.authorize(actor), (data) => {
      if (data.failOnce) {
        data.failOnce = false;
        return null;
      }
      const targets = data.items.filter(
        (item) => item.recipientUserId === actor.id && (!id || item.id === id),
      );
      if (id && !targets.length) throw new AppError('not-found', 'Notification unavailable.', 404);
      const time = new Date(this.now()).toISOString();
      const changed: Notification[] = [];
      for (const item of targets)
        if (Boolean(item.readAt) !== read) {
          item.readAt = read ? time : null;
          item.revision++;
          changed.push(structuredClone(item));
        }
      if (changed.length) data.revisions[actor.id] = (data.revisions[actor.id] ?? 0) + 1;
      const unread = this.count(data, actor.workspaceId, actor.id);
      for (const notification of changed) data.changes.push({ notification, unread });
      return { unread };
    });
    if (!result) throw new AppError('network', 'Read state could not be saved.', 503);
    return result;
  }
  changes(actor: NotificationActor) {
    return this.store.transact(this.authorize(actor), (data) => structuredClone(data.changes));
  }
  acknowledge(actor: NotificationActor, ids: string[]) {
    const set = new Set(ids);
    return this.store.transact(this.authorize(actor), (data) => {
      data.changes = data.changes.filter(
        (change) => !set.has(`${change.notification.id}:${change.notification.revision}`),
      );
    });
  }
}
