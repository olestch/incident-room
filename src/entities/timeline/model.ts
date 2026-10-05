import { z } from 'zod';
import { queryScope } from '@/shared/query/query-scope';

export const messageBodySchema = z
  .string()
  .max(4000)
  .refine((body) => body.trim().length > 0, 'Write a message (1–4,000 characters).');
const base = {
  id: z.string().min(1).max(160),
  incidentId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  serverTieOrder: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  important: z.boolean(),
  tombstone: z.object({ deletedAt: z.iso.datetime(), reason: z.string().max(200) }).nullable(),
};
const actor = { actorId: z.string().min(1) };
export const timelineEntrySchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('human_message'),
    authorId: z.string().min(1),
    body: z.string().max(4000),
    originatingClientMutationId: z.uuid().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('monitoring_event'),
    source: z.string().max(100),
    summary: z.string().max(1000),
  }),
  z.object({
    ...base,
    type: z.literal('deployment_event'),
    service: z.string().max(100),
    version: z.string().max(100),
    summary: z.string().max(1000),
  }),
  z.object({
    ...base,
    ...actor,
    type: z.literal('status_change'),
    from: z.enum(['triggered', 'investigating', 'identified', 'monitoring', 'resolved']),
    to: z.enum(['triggered', 'investigating', 'identified', 'monitoring', 'resolved']),
  }),
  z.object({
    ...base,
    ...actor,
    type: z.literal('severity_change'),
    from: z.enum(['P1', 'P2', 'P3', 'P4']),
    to: z.enum(['P1', 'P2', 'P3', 'P4']),
  }),
  z.object({
    ...base,
    ...actor,
    type: z.literal('participant_event'),
    participantId: z.string().min(1),
    action: z.enum(['joined', 'left', 'command_transferred']),
  }),
  z.object({ ...base, type: z.literal('system_event'), summary: z.string().max(1000) }),
]);
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;
export const timelineWindowSchema = z.object({
  items: z.array(timelineEntrySchema).max(120),
  olderCursor: z.string().nullable(),
  newerCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type TimelineWindow = z.infer<typeof timelineWindowSchema>;
export const locatorSchema = z.object({ entryId: z.string(), cursor: z.string() });
export const outcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('found'), entry: timelineEntrySchema }),
  z.object({ status: z.literal('missing') }),
]);
export const createMessageSchema = z
  .object({ clientMutationId: z.uuid(), body: messageBodySchema })
  .strict();
export const timelineKeys = {
  all: (userId: string, workspaceId: string, incidentId: string) =>
    [...queryScope(userId, workspaceId), 'timeline', incidentId] as const,
  history: (userId: string, workspaceId: string, incidentId: string) =>
    [...timelineKeys.all(userId, workspaceId, incidentId), 'history'] as const,
  target: (userId: string, workspaceId: string, incidentId: string, target: string) =>
    [...timelineKeys.all(userId, workspaceId, incidentId), 'target', target] as const,
  acknowledgments: (userId: string, workspaceId: string, incidentId: string) =>
    [...timelineKeys.all(userId, workspaceId, incidentId), 'acknowledgments'] as const,
};
export function compareEntries(a: TimelineEntry, b: TimelineEntry) {
  return (
    a.occurredAt.localeCompare(b.occurredAt) ||
    a.serverTieOrder - b.serverTieOrder ||
    a.id.localeCompare(b.id)
  );
}
/** Payload-independent merge: future HTTP/realtime callers use exactly this revision rule. */
export function mergeEntries(index: Map<string, TimelineEntry>, entries: readonly TimelineEntry[]) {
  for (const entry of entries) {
    const previous = index.get(entry.id);
    if (
      !previous ||
      entry.revision > previous.revision ||
      (entry.revision === previous.revision && entry.tombstone && !previous.tombstone)
    )
      index.set(entry.id, entry);
  }
  return index;
}
