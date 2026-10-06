import type {
  MockNotificationAuthority,
  NotificationActor,
  Activity,
} from '@/features/notifications/authority';
import type { EventJournal } from '@/features/realtime/journal';
import type { TimelineEntry } from '@/entities/timeline/model';
import type { ThreadMessage } from '@/entities/thread/model';
import type { Incident } from '@/entities/incident/model';
import type { WorkspaceUser } from '@/entities/current-user/model';
import type { MockThreadAuthority } from '@/features/threads/authority';
import type { MockTimelineAuthority } from '@/features/timeline/authority';
export const mentionIds = (body: string) =>
  [...body.matchAll(/@[^@\n]{1,160}\[([^\]\n]{1,160})\]/g)].map((match) => match[1]!);
export function composeNotificationIngestion(
  notifications: MockNotificationAuthority,
  journal: EventJournal,
  users: () => Promise<WorkspaceUser[]>,
  threads: MockThreadAuthority,
  timeline: MockTimelineAuthority,
) {
  const publish = async (actor: NotificationActor) => {
    const changes = await notifications.changes(actor);
    await journal.append(
      actor.workspaceId,
      changes.map((change) => ({
        resourceType: 'notification' as const,
        kind: 'notification_updated' as const,
        eventId: `notification:${change.notification.id}:${change.notification.revision}`,
        workspaceId: change.notification.workspaceId,
        resourceId: change.notification.id,
        revision: change.notification.revision,
        occurredAt: change.notification.createdAt,
        payload: change,
      })),
    );
    await notifications.acknowledge(
      actor,
      changes.map((change) => `${change.notification.id}:${change.notification.revision}`),
    );
  };
  const eligible = async (workspace: string) =>
    (await users())
      .filter((user) => user.workspaceId === workspace && user.status === 'active')
      .map((user) => user.id);
  const produce = async (activity: Activity) =>
    notifications.produce(activity, await eligible(activity.workspaceId));
  return {
    publish,
    produce,
    timeline: async (incident: Incident, entry: TimelineEntry) => {
      if (entry.tombstone) return;
      const base = {
        source: `timeline:${entry.id}`,
        workspaceId: incident.workspaceId,
        occurredAt: entry.createdAt,
        target: { type: 'timeline' as const, number: incident.number, entry: entry.id },
      };
      const relevant = [...incident.participantIds, incident.commanderId];
      if (entry.type === 'human_message')
        await produce({
          ...base,
          actorId: entry.authorId,
          type: 'timeline_mention',
          context: `${incident.number}: mentioned you in the Timeline`,
          recipients: mentionIds(entry.body),
        });
      if (entry.type === 'severity_change')
        await produce({
          ...base,
          actorId: entry.actorId,
          type: 'severity_changed',
          context: `${incident.number}: severity changed to ${entry.to}`,
          recipients: relevant,
        });
      if (entry.type === 'status_change')
        await produce({
          ...base,
          actorId: entry.actorId,
          type: 'status_changed',
          context: `${incident.number}: status changed to ${entry.to}`,
          recipients: relevant,
        });
      if (entry.type === 'participant_event' && entry.action === 'joined')
        await produce({
          ...base,
          actorId: entry.actorId,
          type: 'assigned',
          context: `${incident.number}: added you as a participant`,
          recipients: [entry.participantId],
        });
    },
    thread: async (incident: Incident, message: ThreadMessage) => {
      if (message.tombstone) return;
      const base = {
        source: `thread:${message.id}`,
        workspaceId: incident.workspaceId,
        occurredAt: message.createdAt,
        actorId: message.authorId,
        target: {
          type: 'thread' as const,
          number: incident.number,
          root: message.rootTimelineEntryId,
          message: message.id,
        },
      };
      const actor = {
        id: message.authorId,
        workspaceId: incident.workspaceId,
        status: 'active' as const,
        role: 'member' as const,
      };
      const participants = await threads.notificationRecipients(
        actor,
        incident,
        message.rootTimelineEntryId,
      );
      const rootAuthor = await timeline.inspectSearchable(actor, incident, (entries) => {
        const root = entries.find((entry) => entry.id === message.rootTimelineEntryId);
        return root?.type === 'human_message' ? [root.authorId] : [];
      });
      await produce({
        ...base,
        type: 'thread_mention',
        context: `${incident.number}: mentioned you in a discussion`,
        recipients: mentionIds(message.body),
      });
      await produce({
        ...base,
        type: 'thread_reply',
        context: `${incident.number}: new contextual reply`,
        recipients: [...participants, ...rootAuthor],
      });
    },
  };
}
