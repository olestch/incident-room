import { z } from 'zod';
import { AppError } from '@/shared/errors/app-error';
import {
  incidentSchema,
  createIncidentSchema,
  severities,
  statuses,
  services,
  type Incident,
} from '@/entities/incident/model';
import { canCreateIncident, canViewIncident, type IncidentActor } from '@/entities/incident/policy';
import {
  compareIncidents,
  matchesIncident,
  parseIncidentFilters,
} from '@/entities/incident/filters';
import type { WorkspaceUser } from '@/entities/current-user/model';

export const incidentAuthoritySchema = z.object({
  incidents: z.array(incidentSchema),
  nextNumber: z.number().int().positive(),
  receipts: z.record(z.string(), z.object({ number: z.string(), fingerprint: z.string() })),
});
export type IncidentAuthorityData = z.infer<typeof incidentAuthoritySchema>;
export interface IncidentStore {
  transact<T>(operation: (data: IncidentAuthorityData) => T): Promise<T>;
}
const topics = [
  'Elevated edge latency',
  'Order acknowledgement delays',
  'Identity token validation failures',
  'Storage replica lag',
  'Delivery queue backlog',
  'Intermittent gateway errors',
  'Regional cache misses',
  'Worker scheduling delays',
];
export function seedIncidents(): IncidentAuthorityData {
  return {
    nextNumber: 2873,
    receipts: {},
    incidents: Array.from({ length: 32 }, (_, index): Incident => {
      const createdAt = new Date(Date.UTC(2026, 8, 1 + index, 9)).toISOString();
      const updatedAt = new Date(Date.parse(createdAt) + ((index % 6) + 1) * 3600000).toISOString();
      const status = statuses[index % statuses.length]!;
      const commanderId = index % 2 ? 'demo-sage' : 'demo-river';
      return incidentSchema.parse({
        id: `fictional-incident-${2841 + index}`,
        number: `INC-${2841 + index}`,
        workspaceId: 'demo-orbit',
        title: `${topics[index % topics.length]} · region ${(index % 4) + 1}`,
        description: `Fictional exercise ${index + 1}. The response team is assessing service impact and mitigation options.`,
        severity: severities[index % 4],
        status,
        commanderId,
        participantIds: index % 3 ? [commanderId] : ['demo-river', 'demo-sage'],
        serviceIds: index % 7 ? [services[index % services.length]!.id] : [],
        createdAt,
        updatedAt,
        resolvedAt: status === 'resolved' ? updatedAt : null,
      });
    }),
  };
}
export class MemoryIncidentStore implements IncidentStore {
  private data = seedIncidents();
  async transact<T>(operation: (data: IncidentAuthorityData) => T) {
    return operation(this.data);
  }
}
export class MockIncidentAuthority {
  constructor(
    private readonly store: IncidentStore,
    private readonly now = Date.now,
  ) {}
  async list(actor: IncidentActor, params: URLSearchParams, users: WorkspaceUser[]) {
    if (!canCreateIncident(actor, actor.workspaceId))
      throw new AppError('authorization', 'Access denied.', 403);
    const filters = parseIncidentFilters(
      params,
      users
        .filter((u) => u.status === 'active' && u.workspaceId === actor.workspaceId)
        .map((u) => u.id),
    );
    return this.store.transact((data) => {
      const accessible = data.incidents.filter((i) => canViewIncident(actor, i));
      const matching = accessible
        .filter((i) => matchesIncident(i, filters, actor.id))
        .sort(compareIncidents(filters.sort));
      // Cursor is the last authoritative number, bound to effective filters and actor. No offset drift.
      const signature = JSON.stringify([actor.id, actor.workspaceId, filters]);
      const cursor = params.get('cursor');
      let start = 0;
      if (cursor) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(cursor);
        } catch {
          throw new AppError('validation', 'Invalid cursor.', 400);
        }
        const value = z.object({ after: z.string(), signature: z.string() }).safeParse(parsed);
        const index = value.success ? matching.findIndex((i) => i.number === value.data.after) : -1;
        if (!value.success || value.data.signature !== signature || index < 0)
          throw new AppError('validation', 'Invalid cursor.', 400);
        start = index + 1;
      }
      const items = matching.slice(start, start + 12);
      return {
        items,
        total: matching.length,
        workspaceTotal: accessible.length,
        nextCursor:
          start + items.length < matching.length
            ? JSON.stringify({ after: items.at(-1)!.number, signature })
            : null,
      };
    });
  }
  detail(actor: IncidentActor, number: string) {
    return this.store.transact((data) => {
      const incident = data.incidents.find((i) => i.number === number);
      if (!incident) throw new AppError('not-found', 'Incident not found.', 404);
      if (!canViewIncident(actor, incident))
        throw new AppError('authorization', 'Access denied.', 403);
      return incident;
    });
  }
  async recordActivity(actor: IncidentActor, number: string, time: string) {
    await this.store.transact((data) => {
      const incident = data.incidents.find((record) => record.number === number);
      if (!incident || !canViewIncident(actor, incident))
        throw new AppError('authorization', 'Access denied.', 403);
      if (time > incident.updatedAt) incident.updatedAt = time;
    });
  }
  async create(actor: IncidentActor, raw: unknown, users: WorkspaceUser[], requestId: string) {
    if (!canCreateIncident(actor, actor.workspaceId))
      throw new AppError('authorization', 'Access denied.', 403);
    const input = createIncidentSchema.parse(raw);
    z.uuid().parse(requestId);
    const eligible = users.filter(
      (u) => u.status === 'active' && u.workspaceId === actor.workspaceId,
    );
    if (
      !eligible.some((u) => u.id === actor.id) ||
      input.participantIds.some((id) => !eligible.some((u) => u.id === id))
    )
      throw new AppError('validation', 'Choose active workspace participants.', 400);
    return this.store.transact((data) => {
      const key = `${actor.workspaceId}:${actor.id}:${requestId}`;
      const fingerprint = JSON.stringify(input);
      const receipt = data.receipts[key];
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          throw new AppError(
            'conflict',
            'This submission has already been used. Reopen the form for a new incident.',
            409,
          );
        return data.incidents.find((i) => i.number === receipt.number)!;
      }
      const number = `INC-${data.nextNumber++}`;
      const time = new Date(this.now()).toISOString();
      const incident = incidentSchema.parse({
        ...input,
        id: `fictional-incident-${number}`,
        number,
        workspaceId: actor.workspaceId,
        status: 'triggered',
        commanderId: actor.id,
        participantIds: [...new Set([actor.id, ...input.participantIds])],
        createdAt: time,
        updatedAt: time,
        resolvedAt: null,
      });
      data.incidents.push(incident);
      data.receipts[key] = { number, fingerprint };
      return incident;
    });
  }
}
