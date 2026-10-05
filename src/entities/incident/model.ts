import { z } from 'zod';
import { queryScope } from '@/shared/query/query-scope';

export const severities = ['P1', 'P2', 'P3', 'P4'] as const;
export const statuses = [
  'triggered',
  'investigating',
  'identified',
  'monitoring',
  'resolved',
] as const;
export const severityRank = { P1: 0, P2: 1, P3: 2, P4: 3 } as const;
export const severityLabels = { P1: 'Critical', P2: 'High', P3: 'Medium', P4: 'Low' } as const;
export const statusLabels = {
  triggered: 'Triggered',
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
} as const;
export const services = [
  { id: 'aurora-edge', label: 'Aurora Edge' },
  { id: 'cedar-orders', label: 'Cedar Orders' },
  { id: 'lumen-identity', label: 'Lumen Identity' },
  { id: 'willow-storage', label: 'Willow Storage' },
  { id: 'ripple-delivery', label: 'Ripple Delivery' },
] as const;
const refs = z
  .array(z.string().min(1))
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate references');
export const createIncidentSchema = z
  .object({
    title: z.string().trim().min(1, 'Enter a title.').max(160, 'Use at most 160 characters.'),
    description: z.string().trim().max(4000, 'Use at most 4000 characters.'),
    severity: z.enum(severities, { error: 'Choose a severity.' }),
    serviceIds: refs.refine(
      (ids) => ids.every((id) => services.some((service) => service.id === id)),
      'Unknown service.',
    ),
    participantIds: refs,
  })
  .strict();
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;
export const incidentSchema = createIncidentSchema
  .extend({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    number: z.string().regex(/^INC-\d{4,}$/),
    status: z.enum(statuses),
    commanderId: z.string().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().nullable(),
  })
  .refine((i) => i.participantIds.includes(i.commanderId), 'Commander must participate')
  .refine(
    (i) => (i.status === 'resolved') === (i.resolvedAt !== null),
    'Resolution timestamp must match status',
  );
export type Incident = z.infer<typeof incidentSchema>;
export const incidentPageSchema = z.object({
  items: z.array(incidentSchema).max(12),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
  workspaceTotal: z.number().int().nonnegative(),
});
export const incidentKeys = {
  all: (userId: string, workspaceId: string) =>
    [...queryScope(userId, workspaceId), 'incidents'] as const,
  lists: (userId: string, workspaceId: string) =>
    [...incidentKeys.all(userId, workspaceId), 'list'] as const,
  list: (userId: string, workspaceId: string, filters: unknown) =>
    [...incidentKeys.lists(userId, workspaceId), filters] as const,
  detail: (userId: string, workspaceId: string, number: string) =>
    [...incidentKeys.all(userId, workspaceId), 'detail', number] as const,
};
export function canTransition(from: Incident['status'], to: Incident['status']) {
  return from !== 'resolved' && statuses.indexOf(to) > statuses.indexOf(from);
}
