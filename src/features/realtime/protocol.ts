import { z } from 'zod';
import { postmortemSchema, actionItemSchema } from '@/entities/postmortem/model';
import { incidentSchema } from '@/entities/incident/model';
import { notificationChangeSchema } from '@/entities/notification/model';
import { timelineEntrySchema, timelineWindowSchema } from '@/entities/timeline/model';
import {
  threadSchema,
  threadMessageSchema,
  threadWindowSchema,
  rootIdSchema,
} from '@/entities/thread/model';

const base = {
  eventId: z.string().min(1),
  workspaceId: z.string().min(1),
  sequence: z.number().int().positive(),
  resourceId: z.string().min(1),
  revision: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
};
export const persistentEventSchema = z
  .discriminatedUnion('resourceType', [
    z.object({
      ...base,
      resourceType: z.literal('postmortem'),
      kind: z.literal('postmortem_updated'),
      incidentId: z.string().min(1),
      payload: postmortemSchema,
    }),
    z.object({
      ...base,
      resourceType: z.literal('action_item'),
      kind: z.literal('action_item_updated'),
      incidentId: z.string().min(1),
      payload: actionItemSchema,
    }),
    z.object({
      ...base,
      resourceType: z.literal('notification'),
      kind: z.literal('notification_updated'),
      payload: notificationChangeSchema,
    }),
    z.object({
      ...base,
      resourceType: z.literal('checkpoint'),
      kind: z.literal('checkpoint'),
      payload: z.object({ id: z.string(), revision: z.number().int().positive() }),
    }),
    z.object({
      ...base,
      resourceType: z.literal('incident'),
      kind: z.enum(['incident_created', 'incident_updated', 'status_changed', 'severity_changed']),
      payload: incidentSchema,
    }),
    z.object({
      ...base,
      resourceType: z.literal('timeline'),
      incidentId: z.string().min(1),
      kind: z.enum(['timeline_created', 'timeline_updated', 'timeline_tombstoned']),
      payload: timelineEntrySchema,
    }),
    z.object({
      ...base,
      resourceType: z.literal('thread'),
      incidentId: z.string().min(1),
      kind: z.enum(['thread_created', 'thread_summary_updated']),
      payload: threadSchema,
    }),
    z.object({
      ...base,
      resourceType: z.literal('thread_message'),
      incidentId: z.string().min(1),
      kind: z.enum([
        'thread_message_created',
        'thread_message_updated',
        'thread_message_tombstoned',
      ]),
      payload: threadMessageSchema,
    }),
  ])
  .refine(
    (event) =>
      event.resourceType === 'notification'
        ? event.resourceId === event.payload.notification.id &&
          event.revision === event.payload.notification.revision &&
          event.workspaceId === event.payload.notification.workspaceId
        : event.resourceId === event.payload.id &&
          event.revision === event.payload.revision &&
          (event.resourceType === 'checkpoint'
            ? true
            : event.resourceType === 'incident'
              ? event.workspaceId === event.payload.workspaceId
              : event.incidentId === event.payload.incidentId &&
                (event.resourceType === 'timeline' ||
                  event.workspaceId === event.payload.workspaceId)),
    'Envelope/resource mismatch',
  );
export type PersistentEvent = z.infer<typeof persistentEventSchema>;
export const memberSchema = z.object({
  clientId: z.string(),
  userId: z.string(),
  expiresAt: z.number(),
  typingUntil: z.number(),
  typingScope: z.string().nullable().optional(),
});
export type PresenceMember = z.infer<typeof memberSchema>;
export const ephemeralSchema = z.object({
  kind: z.literal('ephemeral_snapshot'),
  workspaceId: z.string(),
  incidentId: z.string(),
  members: z.array(memberSchema).max(500),
});
export type EphemeralSnapshot = z.infer<typeof ephemeralSchema>;
export const syncSchema = z.object({
  events: z.array(persistentEventSchema).max(100),
  highWater: z.number().int().nonnegative(),
  through: z.number().int().nonnegative(),
  expired: z.boolean(),
});
export type SyncResult = z.infer<typeof syncSchema>;
/** Preserve contiguous journal sequence without disclosing another recipient's resource. */
export function recipientSync(result: SyncResult, userId: string): SyncResult {
  return {
    ...result,
    events: result.events.map((event) =>
      event.resourceType === 'notification' && event.payload.notification.recipientUserId !== userId
        ? {
            eventId: `checkpoint:${event.sequence}`,
            workspaceId: event.workspaceId,
            sequence: event.sequence,
            resourceId: `checkpoint:${event.sequence}`,
            revision: 1,
            occurredAt: '1970-01-01T00:00:00.000Z',
            resourceType: 'checkpoint' as const,
            kind: 'checkpoint' as const,
            payload: { id: `checkpoint:${event.sequence}`, revision: 1 },
          }
        : event,
    ),
  };
}
export const snapshotSchema = z
  .object({
    incident: incidentSchema,
    windows: z.array(timelineWindowSchema).max(101),
    threads: z
      .array(
        z.object({
          root: rootIdSchema,
          summary: threadSchema.nullable(),
          windows: z.array(threadWindowSchema).max(2),
        }),
      )
      .max(1)
      .default([]),
  })
  .refine(
    (snapshot) =>
      snapshot.threads.every(
        (discussion) =>
          (!discussion.summary ||
            (discussion.summary.workspaceId === snapshot.incident.workspaceId &&
              discussion.summary.incidentId === snapshot.incident.id &&
              discussion.summary.rootTimelineEntryId === discussion.root)) &&
          discussion.windows.every((window) =>
            window.items.every(
              (message) =>
                discussion.summary !== null &&
                message.workspaceId === snapshot.incident.workspaceId &&
                message.incidentId === snapshot.incident.id &&
                message.rootTimelineEntryId === discussion.root &&
                message.threadId === discussion.summary.id,
            ),
          ),
      ),
    'Thread snapshot scope mismatch',
  );
export const openSchema = z.object({
  highWater: z.number().int().nonnegative(),
  userId: z.string(),
  workspaceId: z.string(),
  incidentId: z.string(),
});
export const streamSchema = syncSchema.extend({
  controls: z.object({
    failure: z.boolean().default(false),
    delayMs: z.number().min(0).max(5000).default(0),
    duplicate: z.boolean().default(false),
    reverse: z.boolean().default(false),
    drop: z.boolean().default(false),
    malformed: z.boolean().default(false),
  }),
});
