import { z } from 'zod';
import { canViewIncident, canWriteIncident, type IncidentActor } from '@/entities/incident/policy';
import type { Incident } from '@/entities/incident/model';
import {
  createReplySchema,
  threadMessageSchema,
  threadSchema,
  rootIdSchema,
  compareMessages,
  type Thread,
} from '@/entities/thread/model';
import { AppError } from '@/shared/errors/app-error';
import { IndexedDbAtomicStore, type AtomicStore } from '@/shared/persistence/atomic-store';

export const threadChangeSchema = z.discriminatedUnion('resourceType', [
  z.object({
    resourceType: z.literal('thread'),
    kind: z.enum(['thread_created', 'thread_summary_updated']),
    payload: threadSchema,
  }),
  z.object({
    resourceType: z.literal('thread_message'),
    kind: z.enum(['thread_message_created', 'thread_message_updated', 'thread_message_tombstoned']),
    payload: threadMessageSchema,
  }),
]);
export const threadAuthoritySchema = z.object({
  threads: z.record(z.string(), threadSchema),
  messages: z.record(z.string(), z.array(threadMessageSchema)),
  fixtureCounts: z.record(z.string(), z.number().int().min(0).max(50000)).default({}),
  receipts: z.record(
    z.string(),
    z.object({
      id: z.string(),
      root: z.string(),
      body: z.string(),
      replyToMessageId: z.string().nullable(),
    }),
  ),
  changes: z.array(threadChangeSchema),
  fault: z.enum(['none', 'reject-once', 'ambiguous-once', 'missing-once']).default('none'),
  responseDelayMs: z.number().min(0).max(5000).default(0),
});
export type ThreadAuthorityData = z.infer<typeof threadAuthoritySchema>;
export const threadIdentity = (incident: Incident, root: string) => `${incident.id}:thread:${root}`;
export function seedThreads(key: string): ThreadAuthorityData {
  const [workspaceId, incidentId] = JSON.parse(key) as [string, string];
  const data: ThreadAuthorityData = {
    threads: {},
    messages: {},
    fixtureCounts: {},
    receipts: {},
    changes: [],
    fault: 'none',
    responseDelayMs: 0,
  };
  // Independently authored, lazy room seed: one populated recent root and one large old discussion.
  if (incidentId !== 'fictional-incident-2841') return data;
  for (const [rootIndex, count] of [
    [4000, 8],
    [42, 2000],
  ] as const) {
    const root = `${incidentId}:evt-${rootIndex}`;
    const threadId = `${incidentId}:thread:${root}`;
    data.fixtureCounts[root] = count;
    data.threads[root] = threadSchema.parse({
      id: threadId,
      workspaceId,
      incidentId,
      rootTimelineEntryId: root,
      revision: 1,
      confirmedMessageCount: count,
      participantIds: ['demo-river', 'demo-sage'],
      participantCount: 2,
      lastActivityAt: new Date(Date.UTC(2026, 8, 1, 10) + (count - 1) * 1000).toISOString(),
    });
  }
  return data;
}
function generateThreadFixture(
  workspaceId: string,
  incidentId: string,
  rootIndex: number,
  count: number,
) {
  const root = `${incidentId}:evt-${rootIndex}`;
  const threadId = `${incidentId}:thread:${root}`;
  const messages = Array.from({ length: count }, (_, index) =>
    threadMessageSchema.parse({
      id: `${incidentId}:reply-${rootIndex}-${index + 1}`,
      threadId,
      rootTimelineEntryId: root,
      workspaceId,
      incidentId,
      authorId: index % 2 ? 'demo-sage' : 'demo-river',
      body: `Fictional contextual reply ${index + 1}. ${'Aurora responders compare queue measurements. '.repeat(1 + (index % 4))}`,
      replyToMessageId: index % 7 === 0 && index ? `${incidentId}:reply-${rootIndex}-1` : null,
      occurredAt: new Date(Date.UTC(2026, 8, 1, 10) + index * 1000).toISOString(),
      createdAt: new Date(Date.UTC(2026, 8, 1, 10) + index * 1000).toISOString(),
      serverTieOrder: index + 1,
      revision: 1,
      tombstone: null,
    }),
  );
  return messages;
}

export const makeThreadAuthorityStore = () =>
  new IndexedDbAtomicStore('incident-room-fictional-threads-v1', seedThreads, (raw) =>
    threadAuthoritySchema.parse(raw),
  );
const cursorSchema = z.object({
  room: z.string(),
  root: z.string(),
  before: z.string().nullable(),
  target: z.string().nullable(),
});
function cursor(room: string, root: string, before: string | null, target: string | null = null) {
  return btoa(JSON.stringify({ room, root, before, target }));
}
function decode(value: string, room: string, root: string) {
  try {
    const data = cursorSchema.parse(JSON.parse(atob(value)));
    if (data.room !== room || data.root !== root) throw new Error();
    return data;
  } catch {
    throw new AppError('validation', 'Invalid Thread cursor.', 400);
  }
}
export class MockThreadAuthority {
  constructor(
    private readonly store: AtomicStore<ThreadAuthorityData>,
    private readonly rootExists: (
      actor: IncidentActor,
      incident: Incident,
      root: string,
    ) => Promise<void>,
    private readonly now = Date.now,
  ) {}
  private materialize(data: ThreadAuthorityData, incident: Incident, root: string) {
    const count = data.fixtureCounts[root];
    if (count !== undefined) {
      data.messages[root] = generateThreadFixture(
        incident.workspaceId,
        incident.id,
        Number(root.split('-').at(-1)),
        count,
      );
      delete data.fixtureCounts[root];
    }
    return data.messages[root] ?? [];
  }
  private room(actor: IncidentActor, incident: Incident) {
    if (!canViewIncident(actor, incident))
      throw new AppError('authorization', 'Thread access denied.', 403);
    return JSON.stringify([incident.workspaceId, incident.id]);
  }
  private async resource(actor: IncidentActor, incident: Incident, root: string) {
    const room = this.room(actor, incident);
    rootIdSchema.parse(root);
    // Tombstoned roots exist; root contents are never copied into Thread authority.
    await this.rootExists(actor, incident, root);
    return room;
  }
  async summaries(actor: IncidentActor, incident: Incident, roots: string[]) {
    z.array(rootIdSchema).max(60).parse(roots);
    return this.store.transact(this.room(actor, incident), (data) =>
      roots.flatMap((root) => (data.threads[root] ? [data.threads[root]!] : [])),
    );
  }
  async detail(actor: IncidentActor, incident: Incident, root: string) {
    return this.store.transact(
      await this.resource(actor, incident, root),
      (data) => data.threads[root] ?? null,
    );
  }
  async window(actor: IncidentActor, incident: Incident, root: string, rawCursor: string | null) {
    const room = await this.resource(actor, incident, root);
    const parsed = rawCursor ? decode(rawCursor, room, root) : null;
    return this.store.transact(room, (data) => {
      const messages = this.materialize(data, incident, root).slice().sort(compareMessages);
      let end = messages.length;
      if (parsed?.before) {
        end = messages.findIndex((m) => m.id === parsed.before);
        if (end < 0) throw new AppError('not-found', 'Thread history boundary missing.', 404);
      }
      let start = Math.max(0, end - 60);
      if (parsed?.target) {
        const index = messages.findIndex((m) => m.id === parsed.target);
        if (index < 0) throw new AppError('not-found', 'Thread message missing.', 404);
        start = Math.max(0, index - 25);
        end = Math.min(messages.length, index + 26);
      }
      return {
        items: messages.slice(start, end),
        olderCursor: start ? cursor(room, root, messages[start]!.id) : null,
        newerCursor: end < messages.length ? cursor(room, root, null, messages[end]!.id) : null,
        total: messages.length,
      };
    });
  }
  async locate(actor: IncidentActor, incident: Incident, root: string, id: string) {
    const room = await this.resource(actor, incident, root);
    return this.store.transact(room, (data) => {
      if (!this.materialize(data, incident, root).some((m) => m.id === id))
        throw new AppError('not-found', 'Thread message missing.', 404);
      return { entryId: id, cursor: cursor(room, root, null, id) };
    });
  }
  async outcome(actor: IncidentActor, incident: Incident, root: string, id: string) {
    z.uuid().parse(id);
    const room = await this.resource(actor, incident, root);
    return this.store.transact(room, (data) => {
      const receipt = data.receipts[JSON.stringify([actor.id, id])];
      const entry = receipt?.root === root && data.messages[root]?.find((m) => m.id === receipt.id);
      return entry ? { status: 'found' as const, entry } : { status: 'missing' as const };
    });
  }
  async create(actor: IncidentActor, incident: Incident, root: string, raw: unknown) {
    const input = createReplySchema.parse(raw);
    const room = await this.resource(actor, incident, root);
    if (!canWriteIncident(actor, incident))
      throw new AppError(
        'authorization',
        incident.status === 'resolved'
          ? 'Resolved incidents are read-only.'
          : 'Incident participation is required.',
        403,
      );
    const result = await this.store.transact(room, (data) => {
      // Identity is user + incident + UUID, not root: reusing a UUID across roots conflicts.
      const key = JSON.stringify([actor.id, input.clientMutationId]);
      const receipt = data.receipts[key];
      if (receipt) {
        if (
          receipt.root !== root ||
          receipt.body !== input.body ||
          receipt.replyToMessageId !== input.replyToMessageId
        )
          throw new AppError(
            'conflict',
            'Mutation identity cannot be reused for different content or Thread.',
            409,
          );
        return {
          entry: data.messages[root]!.find((m) => m.id === receipt.id)!,
          ambiguous: false,
          delay: data.responseDelayMs,
        };
      }
      const messages = this.materialize(data, incident, root);
      if (input.replyToMessageId && !messages.some((m) => m.id === input.replyToMessageId))
        throw new AppError('validation', 'Reply target is not available in this Thread.', 422);
      const fault = data.fault;
      data.fault = 'none';
      if (fault === 'reject-once' || fault === 'missing-once')
        return { entry: null, ambiguous: fault === 'missing-once', delay: data.responseDelayMs };
      const time = new Date(
        Math.max(this.now(), Date.parse(messages.at(-1)?.occurredAt ?? incident.createdAt)),
      ).toISOString();
      const entry = threadMessageSchema.parse({
        id: `${incident.id}:reply-${actor.id}-${input.clientMutationId}`,
        threadId: threadIdentity(incident, root),
        workspaceId: incident.workspaceId,
        incidentId: incident.id,
        rootTimelineEntryId: root,
        authorId: actor.id,
        body: input.body,
        replyToMessageId: input.replyToMessageId,
        originatingClientMutationId: input.clientMutationId,
        occurredAt: time,
        createdAt: time,
        serverTieOrder: Math.max(0, ...messages.map((m) => m.serverTieOrder)) + 1,
        revision: 1,
        tombstone: null,
      });
      messages.push(entry);
      data.messages[root] = messages;
      data.receipts[key] = {
        id: entry.id,
        root,
        body: input.body,
        replyToMessageId: input.replyToMessageId,
      };
      this.refreshSummary(data, incident, root);
      data.changes.push({
        resourceType: 'thread_message',
        kind: 'thread_message_created',
        payload: entry,
      });
      return { entry, ambiguous: fault === 'ambiguous-once', delay: data.responseDelayMs };
    });
    if (result.delay) await new Promise((resolve) => setTimeout(resolve, result.delay));
    if (result.ambiguous) throw new AppError('network', 'Thread mutation outcome unknown.', 503);
    if (!result.entry)
      throw new AppError(
        'validation',
        'Fictional authority rejected this reply. Retry is available.',
        422,
      );
    return result.entry;
  }
  private refreshSummary(data: ThreadAuthorityData, incident: Incident, root: string) {
    const messages = data.messages[root]!;
    const previous = data.threads[root];
    const participants = [...new Set(messages.filter((m) => !m.tombstone).map((m) => m.authorId))];
    const summary: Thread = {
      id: threadIdentity(incident, root),
      workspaceId: incident.workspaceId,
      incidentId: incident.id,
      rootTimelineEntryId: root,
      revision: (previous?.revision ?? 0) + 1,
      confirmedMessageCount: messages.length,
      participantIds: participants.slice(0, 200),
      participantCount: participants.length,
      lastActivityAt: messages.slice().sort(compareMessages).at(-1)!.occurredAt,
    };
    data.threads[root] = summary;
    data.changes.push({
      resourceType: 'thread',
      kind: previous ? 'thread_summary_updated' : 'thread_created',
      payload: summary,
    });
  }
  changes(actor: IncidentActor, incident: Incident) {
    return this.store.transact(this.room(actor, incident), (data) => data.changes);
  }
  acknowledgeChanges(actor: IncidentActor, incident: Incident, ids: string[]) {
    return this.store.transact(this.room(actor, incident), (data) => {
      data.changes = data.changes.filter(
        (c) => !ids.includes(`${c.resourceType}:${c.payload.id}:${c.payload.revision}`),
      );
    });
  }
  async snapshot(actor: IncidentActor, incident: Incident, root: string, ids: string[]) {
    z.array(z.string()).max(60).parse(ids);
    const room = await this.resource(actor, incident, root);
    return this.store.transact(room, (data) => {
      // One authorized, consistent authority read: no second root lookup/window transaction.
      const messages = this.materialize(data, incident, root).slice().sort(compareMessages);
      const start = Math.max(0, messages.length - 60);
      return {
        root,
        summary: data.threads[root] ?? null,
        windows: [
          {
            items: messages.slice(start),
            olderCursor: start ? cursor(room, root, messages[start]!.id) : null,
            newerCursor: null,
            total: messages.length,
          },
          {
            items: messages.filter((m) => ids.includes(m.id)),
            olderCursor: null,
            newerCursor: null,
            total: messages.length,
          },
        ],
      };
    });
  }
  /** Test authority correction/tombstone; no user-facing edit API. */
  async simulate(actor: IncidentActor, incident: Incident, raw: unknown) {
    const message = threadMessageSchema.parse(raw);
    if (
      message.workspaceId !== incident.workspaceId ||
      message.incidentId !== incident.id ||
      message.threadId !== threadIdentity(incident, message.rootTimelineEntryId)
    )
      throw new AppError('validation', 'Invalid Thread scope.', 400);
    const room = await this.resource(actor, incident, message.rootTimelineEntryId);
    return this.store.transact(room, (data) => {
      const messages = this.materialize(data, incident, message.rootTimelineEntryId);
      const index = messages.findIndex((m) => m.id === message.id);
      if (index >= 0 && messages[index]!.revision >= message.revision) return;
      if (index >= 0) messages[index] = message;
      else messages.push(message);
      data.messages[message.rootTimelineEntryId] = messages;
      this.refreshSummary(data, incident, message.rootTimelineEntryId);
      data.changes.push({
        resourceType: 'thread_message',
        kind: message.tombstone
          ? 'thread_message_tombstoned'
          : index < 0
            ? 'thread_message_created'
            : 'thread_message_updated',
        payload: message,
      });
    });
  }
}
