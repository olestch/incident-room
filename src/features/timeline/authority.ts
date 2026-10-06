import { z } from 'zod';
import {
  createMessageSchema,
  timelineEntrySchema,
  type TimelineEntry,
} from '@/entities/timeline/model';
import { canViewIncident, canWriteIncident, type IncidentActor } from '@/entities/incident/policy';
import type { Incident } from '@/entities/incident/model';
import { AppError } from '@/shared/errors/app-error';
import { IndexedDbAtomicStore, type AtomicStore } from '@/shared/persistence/atomic-store';
import { generateTimeline } from './fixtures';

export const authorityDataSchema = z.object({
  entries: z.array(timelineEntrySchema),
  receipts: z.record(z.string(), z.object({ id: z.string(), body: z.string() })),
  nextOrder: z.number().int(),
  fault: z.enum(['none', 'reject-once', 'ambiguous-once', 'missing-once']).default('none'),
  responseDelayMs: z.number().int().min(0).max(5000).default(0),
  locateDelayMs: z.number().int().min(0).max(5000).default(0),
  searchControls: z
    .object({
      delayMs: z.number().min(0).max(5000).default(0),
      failOnce: z.boolean().default(false),
      failuresRemaining: z.number().int().min(0).max(10).default(0),
      started: z.number().int().nonnegative().default(0),
      completed: z.number().int().nonnegative().default(0),
    })
    .default({ delayMs: 0, failOnce: false, failuresRemaining: 0, started: 0, completed: 0 }),
  changes: z
    .array(
      z.object({
        kind: z.enum(['timeline_created', 'timeline_updated', 'timeline_tombstoned']),
        entry: timelineEntrySchema,
      }),
    )
    .default([]),
});
export type AuthorityData = z.infer<typeof authorityDataSchema>;
export function seedTimeline(key: string): AuthorityData {
  const incidentId = JSON.parse(key)[1] as string;
  const number = Number(incidentId.split('-').at(-1));
  const count = number === 2841 ? 4000 : number >= 2841 && number <= 2872 ? 160 : 0;
  return {
    entries: generateTimeline(incidentId, count),
    receipts: {},
    nextOrder: count + 1,
    fault: 'none',
    responseDelayMs: 0,
    locateDelayMs: 0,
    searchControls: { delayMs: 0, failOnce: false, failuresRemaining: 0, started: 0, completed: 0 },
    changes: [],
  };
}
export const makeTimelineAuthorityStore = () =>
  new IndexedDbAtomicStore('incident-room-fictional-timeline-v1', seedTimeline, (raw) =>
    authorityDataSchema.parse(raw),
  );
const cursorSchema = z.object({
  room: z.string(),
  before: z.string().nullable(),
  target: z.string().nullable(),
});
function cursor(room: string, before: string | null, target: string | null = null) {
  return btoa(JSON.stringify({ room, before, target }));
}
function decode(value: string, room: string) {
  try {
    const parsed = cursorSchema.parse(JSON.parse(atob(value)));
    if (parsed.room !== room) throw new Error();
    return parsed;
  } catch {
    throw new AppError('validation', 'Invalid Timeline cursor.', 400);
  }
}
export class MockTimelineAuthority {
  constructor(
    private readonly store: AtomicStore<AuthorityData>,
    private readonly now = Date.now,
  ) {}
  replaceDataset(actor: IncidentActor, incident: Incident, count: number) {
    if (![100, 1000, 10000, 50000].includes(count))
      throw new AppError('validation', 'Invalid dataset size.', 400);
    return this.store.transact(this.room(actor, incident), (data) => {
      Object.assign(data, seedTimeline(JSON.stringify([incident.workspaceId, incident.id])), {
        entries: generateTimeline(incident.id, count),
        nextOrder: count + 1,
      });
    });
  }
  generate(
    actor: IncidentActor,
    incident: Incident,
    kind: 'monitoring' | 'deployment' | 'human',
    authorId: string,
  ) {
    if (!canWriteIncident(actor, incident))
      throw new AppError('authorization', 'Active incident participation is required.', 403);
    return this.store.transact(this.room(actor, incident), (data) => {
      const order = data.nextOrder++;
      const time = new Date(
        Math.max(
          Date.parse(incident.createdAt),
          Date.parse(data.entries.at(-1)?.occurredAt ?? incident.createdAt),
        ) + 60000,
      ).toISOString();
      const variants = {
        monitoring: {
          type: 'monitoring_event',
          source: 'Demo Lumen monitor',
          summary: `Demo activity ${order}: fictional edge latency probe completed.`,
        },
        deployment: {
          type: 'deployment_event',
          service: 'Aurora Edge',
          version: `v0.demo.${order}`,
          summary: `Demo activity ${order}: fictional canary deployed.`,
        },
        human: {
          type: 'human_message',
          authorId,
          body: `Demo activity ${order}: checking the fictional mitigation with @River [demo-river].`,
        },
      };
      const entry = timelineEntrySchema.parse({
        id: `${incident.id}:demo-${order}`,
        incidentId: incident.id,
        occurredAt: time,
        createdAt: time,
        serverTieOrder: order,
        revision: 1,
        important: false,
        tombstone: null,
        ...variants[kind],
      });
      data.entries.push(entry);
      data.changes.push({ kind: 'timeline_created', entry });
      return entry;
    });
  }
  inspectSearchable<T>(
    actor: IncidentActor,
    incident: Incident,
    inspect: (entries: readonly TimelineEntry[]) => T,
  ) {
    return this.store.transact(this.room(actor, incident), (data) => inspect(data.entries));
  }
  searchPolicy(actor: IncidentActor, incident: Incident) {
    return this.store.transact(this.room(actor, incident), (data) => {
      const policy = {
        delayMs: data.searchControls.delayMs,
        fail: data.searchControls.failOnce || data.searchControls.failuresRemaining > 0,
      };
      data.searchControls.failOnce = false;
      data.searchControls.failuresRemaining = Math.max(
        0,
        data.searchControls.failuresRemaining - 1,
      );
      data.searchControls.started++;
      return policy;
    });
  }
  completeSearch(actor: IncidentActor, incident: Incident) {
    return this.store.transact(this.room(actor, incident), (data) => {
      data.searchControls.completed++;
    });
  }
  private room(actor: IncidentActor, incident: Incident) {
    if (!canViewIncident(actor, incident))
      throw new AppError('authorization', 'Access denied.', 403);
    return JSON.stringify([incident.workspaceId, incident.id]);
  }
  async window(actor: IncidentActor, incident: Incident, rawCursor: string | null) {
    const room = this.room(actor, incident);
    const parsed = rawCursor ? decode(rawCursor, room) : null;
    return this.store.transact(room, (data) => {
      const entries = data.entries;
      let end = entries.length;
      if (parsed?.before) {
        end = entries.findIndex((entry) => entry.id === parsed.before);
        if (end < 0) throw new AppError('not-found', 'History boundary unavailable.', 404);
      }
      let start = Math.max(0, end - 60);
      if (parsed?.target) {
        const index = entries.findIndex((entry) => entry.id === parsed.target);
        if (index < 0) throw new AppError('not-found', 'Timeline target missing.', 404);
        start = Math.max(0, index - 25);
        end = Math.min(entries.length, index + 26);
      }
      return {
        items: entries.slice(start, end),
        olderCursor: start > 0 ? cursor(room, entries[start]!.id) : null,
        newerCursor: end < entries.length ? cursor(room, null, entries[end]!.id) : null,
        total: entries.length,
      };
    });
  }
  async locate(actor: IncidentActor, incident: Incident, entryId: string) {
    const room = this.room(actor, incident);
    const result = await this.store.transact(room, (data) => {
      if (!data.entries.some((entry) => entry.id === entryId))
        throw new AppError('not-found', 'Timeline target missing.', 404);
      return { entryId, cursor: cursor(room, null, entryId), delay: data.locateDelayMs };
    });
    if (result.delay) await new Promise((resolve) => setTimeout(resolve, result.delay));
    return { entryId: result.entryId, cursor: result.cursor };
  }
  outcome(actor: IncidentActor, incident: Incident, mutationId: string) {
    z.uuid().parse(mutationId);
    const room = this.room(actor, incident);
    return this.store.transact(room, (data) => {
      const receipt = data.receipts[JSON.stringify([actor.id, mutationId])];
      const entry = receipt && data.entries.find((entry) => entry.id === receipt.id);
      return entry ? { status: 'found' as const, entry } : { status: 'missing' as const };
    });
  }
  async create(
    actor: IncidentActor,
    incident: Incident,
    raw: unknown,
    persisted: (entry: TimelineEntry) => Promise<void> = async () => {},
  ): Promise<TimelineEntry> {
    const input = createMessageSchema.parse(raw);
    const room = this.room(actor, incident);
    if (!canWriteIncident(actor, incident))
      throw new AppError(
        'authorization',
        incident.status === 'resolved'
          ? 'Resolved incidents are read-only.'
          : 'Incident participation is required.',
        403,
      );
    const result = await this.store.transact(room, (data) => {
      const key = JSON.stringify([actor.id, input.clientMutationId]);
      const previous = data.receipts[key];
      if (previous) {
        if (previous.body !== input.body)
          throw new AppError(
            'conflict',
            'Mutation identity cannot be reused for different content.',
            409,
          );
        return {
          entry: data.entries.find((entry) => entry.id === previous.id)!,
          ambiguous: false,
          delay: data.responseDelayMs,
        };
      }
      // Internal deterministic test fixtures only; no API/UI controls or client special fields.
      const fault = data.fault;
      data.fault = 'none';
      if (fault === 'reject-once' || fault === 'missing-once')
        return { entry: null, ambiguous: fault === 'missing-once', delay: data.responseDelayMs };
      const time = new Date(
        Math.max(this.now(), Date.parse(data.entries.at(-1)?.occurredAt ?? incident.createdAt)),
      ).toISOString();
      const entry = timelineEntrySchema.parse({
        id: `${incident.id}:msg-${actor.id}-${input.clientMutationId}`,
        incidentId: incident.id,
        occurredAt: time,
        createdAt: time,
        serverTieOrder: data.nextOrder++,
        revision: 1,
        important: false,
        tombstone: null,
        type: 'human_message',
        authorId: actor.id,
        body: input.body,
        originatingClientMutationId: input.clientMutationId,
      });
      data.entries.push(entry);
      data.changes.push({ kind: 'timeline_created', entry: structuredClone(entry) });
      data.receipts[key] = { id: entry.id, body: input.body };
      return { entry, ambiguous: fault === 'ambiguous-once', delay: data.responseDelayMs };
    });
    if (result.entry) await persisted(result.entry);
    if (result.delay) await new Promise((resolve) => setTimeout(resolve, result.delay));
    if (result.ambiguous) throw new AppError('network', 'Mutation outcome unknown.', 503);
    if (!result.entry)
      throw new AppError(
        'validation',
        'Fictional authority rejected this attempt. Retry is available.',
        422,
      );
    return result.entry;
  }
  changes(actor: IncidentActor, incident: Incident) {
    return this.store.transact(this.room(actor, incident), (data) => data.changes);
  }
  acknowledgeChanges(actor: IncidentActor, incident: Incident, ids: string[]) {
    const confirmed = new Set(ids);
    return this.store.transact(this.room(actor, incident), (data) => {
      data.changes = data.changes.filter(
        (change) => !confirmed.has(`${change.entry.id}:${change.entry.revision}`),
      );
    });
  }
  snapshot(actor: IncidentActor, incident: Incident, ids: string[]) {
    if (ids.length > 60) throw new AppError('validation', 'Snapshot window too large.', 400);
    return this.store.transact(this.room(actor, incident), (data) => ({
      items: data.entries.filter((entry) => ids.includes(entry.id)),
      olderCursor: null,
      newerCursor: null,
      total: data.entries.length,
    }));
  }
  /** Internal authority correction/tombstone fixture; confirmed messages have no edit UI. */
  simulate(actor: IncidentActor, incident: Incident, raw: unknown) {
    const entry = timelineEntrySchema.parse(raw);
    if (entry.incidentId !== incident.id) throw new AppError('validation', 'Invalid room.', 400);
    return this.store.transact(this.room(actor, incident), (data) => {
      const index = data.entries.findIndex((value) => value.id === entry.id);
      if (index >= 0 && data.entries[index]!.revision >= entry.revision) return;
      if (index < 0) data.entries.push(entry);
      else data.entries[index] = entry;
      data.changes.push({
        kind: entry.tombstone
          ? 'timeline_tombstoned'
          : index < 0
            ? 'timeline_created'
            : 'timeline_updated',
        entry,
      });
    });
  }
}
