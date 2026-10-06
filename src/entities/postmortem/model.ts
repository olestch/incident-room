import { z } from 'zod';
import { queryScope } from '@/shared/query/query-scope';

export const sections = [
  ['summary', 'Summary', 'Briefly describe the incident and outcome.'],
  ['impact', 'Impact', 'Describe affected services and users.'],
  ['rootCause', 'Root Cause', 'Explain the contributing cause, without blame.'],
  ['resolution', 'Resolution', 'Describe mitigation and recovery.'],
] as const;
export const postmortemFieldsSchema = z.object({
  summary: z.string().max(8000),
  impact: z.string().max(8000),
  rootCause: z.string().max(8000),
  resolution: z.string().max(8000),
  timelineEntryIds: z
    .array(z.string().min(1).max(160))
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Select each event only once.'),
});
export type PostmortemFields = z.infer<typeof postmortemFieldsSchema>;
export const emptyPostmortemFields = (): PostmortemFields => ({
  summary: '',
  impact: '',
  rootCause: '',
  resolution: '',
  timelineEntryIds: [],
});
const metadata = {
  id: z.uuid(),
  workspaceId: z.string().min(1),
  incidentId: z.string().min(1),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  createdBy: z.string().min(1),
  updatedBy: z.string().min(1),
};
export const postmortemSchema = postmortemFieldsSchema.extend({
  ...metadata,
  status: z.literal('draft'),
});
export type Postmortem = z.infer<typeof postmortemSchema>;
export const savePostmortemSchema = z.object({
  postmortemId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  fields: postmortemFieldsSchema,
});
export const actionFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(160),
  description: z.string().max(4000),
  assigneeUserId: z.string().min(1).nullable(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((date) => {
      const parsed = new Date(`${date}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
    }, 'Use a valid calendar date.')
    .nullable(),
  status: z.enum(['open', 'in_progress', 'done']),
});
export type ActionFields = z.infer<typeof actionFieldsSchema>;
export const emptyActionFields = (): ActionFields => ({
  title: '',
  description: '',
  assigneeUserId: null,
  dueDate: null,
  status: 'open',
});
export const actionItemSchema = actionFieldsSchema.extend({ ...metadata, postmortemId: z.uuid() });
export type ActionItem = z.infer<typeof actionItemSchema>;
export const createActionSchema = z.object({
  postmortemId: z.uuid(),
  requestId: z.uuid(),
  fields: actionFieldsSchema,
});
export const saveActionSchema = z.object({
  id: z.uuid(),
  expectedRevision: z.number().int().positive(),
  fields: actionFieldsSchema,
});
export const postmortemDetailSchema = z
  .object({ postmortem: postmortemSchema.nullable(), items: z.array(actionItemSchema).max(200) })
  .refine(
    (value) =>
      value.items.every(
        (item) =>
          value.postmortem !== null &&
          item.postmortemId === value.postmortem.id &&
          item.incidentId === value.postmortem.incidentId &&
          item.workspaceId === value.postmortem.workspaceId,
      ),
    'Action Item scope mismatch',
  );
export type PostmortemDetail = z.infer<typeof postmortemDetailSchema>;
export const postmortemKeys = {
  all: (user: string, workspace: string) =>
    [...queryScope(user, workspace), 'postmortems'] as const,
  detail: (user: string, workspace: string, incident: string) =>
    [...postmortemKeys.all(user, workspace), incident, 'detail'] as const,
  references: (user: string, workspace: string, incident: string) =>
    [...postmortemKeys.all(user, workspace), incident, 'references'] as const,
};
export function mergePostmortemDetail(
  previous: PostmortemDetail | undefined,
  next: PostmortemDetail,
): PostmortemDetail {
  const postmortem =
    previous?.postmortem &&
    (!next.postmortem || previous.postmortem.revision >= next.postmortem.revision)
      ? previous.postmortem
      : next.postmortem;
  const items = new Map((previous?.items ?? []).map((item) => [item.id, item]));
  for (const item of next.items)
    if ((items.get(item.id)?.revision ?? 0) < item.revision) items.set(item.id, item);
  return {
    postmortem,
    items: [...items.values()].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    ),
  };
}
