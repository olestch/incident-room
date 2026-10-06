import { z } from 'zod';
import { queryScope } from '@/shared/query/query-scope';
import { messageBodySchema } from '@/shared/messaging/model';
export {
  compareEntries as compareMessages,
  mergeEntries as mergeMessages,
} from '@/shared/messaging/model';

export const threadIdSchema = z.string().min(1).max(400);
export const rootIdSchema = z.string().regex(/^[\w:-]{1,160}$/);
const scope = {
  workspaceId: z.string().min(1),
  incidentId: z.string().min(1),
  rootTimelineEntryId: rootIdSchema,
};
export const threadSchema = z.object({
  ...scope,
  id: threadIdSchema,
  revision: z.number().int().positive(),
  confirmedMessageCount: z.number().int().nonnegative(),
  participantIds: z.array(z.string()).max(200),
  participantCount: z.number().int().nonnegative(),
  lastActivityAt: z.iso.datetime(),
});
export type Thread = z.infer<typeof threadSchema>;
export const threadMessageSchema = z.object({
  ...scope,
  id: threadIdSchema,
  threadId: threadIdSchema,
  authorId: z.string().min(1),
  body: z.string().max(4000),
  replyToMessageId: threadIdSchema.nullable(),
  occurredAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  serverTieOrder: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  tombstone: z.object({ deletedAt: z.iso.datetime(), reason: z.string().max(200) }).nullable(),
  originatingClientMutationId: z.uuid().optional(),
});
export type ThreadMessage = z.infer<typeof threadMessageSchema>;
export const threadWindowSchema = z.object({
  items: z.array(threadMessageSchema).max(60),
  olderCursor: z.string().nullable(),
  newerCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type ThreadWindow = z.infer<typeof threadWindowSchema>;
export const threadOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('found'), entry: threadMessageSchema }),
  z.object({ status: z.literal('missing') }),
]);
export const createReplySchema = z
  .object({
    clientMutationId: z.uuid(),
    body: messageBodySchema,
    replyToMessageId: threadIdSchema.nullable(),
  })
  .strict();
export const threadKeys = {
  room: (user: string, workspace: string, incident: string) =>
    [...queryScope(user, workspace), 'threads', incident] as const,
  all: (user: string, workspace: string, incident: string, root: string) =>
    [...threadKeys.room(user, workspace, incident), root] as const,
  history: (user: string, workspace: string, incident: string, root: string) =>
    [...threadKeys.all(user, workspace, incident, root), 'history'] as const,
  acknowledgments: (user: string, workspace: string, incident: string, root: string) =>
    [...threadKeys.all(user, workspace, incident, root), 'acknowledgments'] as const,
  target: (user: string, workspace: string, incident: string, root: string, message: string) =>
    [...threadKeys.all(user, workspace, incident, root), 'target', message] as const,
  summary: (user: string, workspace: string, incident: string, root: string) =>
    [...threadKeys.all(user, workspace, incident, root), 'summary'] as const,
};
export function mergeThread(previous: Thread | undefined | null, next: Thread) {
  return !previous || next.revision > previous.revision ? next : previous;
}
/** Only previews; contextual references never become recursive message children. */
export function replyPreview(
  id: string,
  index: ReadonlyMap<string, ThreadMessage>,
  names: (id: string) => string,
) {
  const parent = index.get(id);
  if (!parent) return 'Unloaded or unavailable message';
  if (parent.tombstone) return 'Deleted message';
  return `${names(parent.authorId)}: ${parent.body.replace(/\s+/g, ' ').slice(0, 120)}`;
}
