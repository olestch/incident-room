import { expect, it, vi } from 'vitest';
import {
  threadMessageSchema,
  threadSchema,
  mergeMessages,
  mergeThread,
  type ThreadMessage,
  type Thread,
} from '@/entities/thread/model';
import { RealtimeCoordinator, type RealtimePort } from '@/features/realtime/coordinator';
import {
  persistentEventSchema,
  snapshotSchema,
  type PersistentEvent,
} from '@/features/realtime/protocol';
import { EventJournal, seedJournal } from '@/features/realtime/journal';
import { MemoryAtomicStore } from '@/shared/persistence/atomic-store';
import type { RealtimeTransport, TransportEvent } from '@/features/realtime/transport';
import { MockRealtimeTransport } from '@/features/realtime/mock-transport';
import { TargetNavigation } from '@/shared/messaging/target-navigation';
import { QueryClient } from '@tanstack/react-query';
import { threadKeys } from '@/entities/thread/model';
import { hasAcquiredThreadMessage, mergeThreadSnapshotWindow } from './thread-cache';
const message = threadMessageSchema.parse({
  id: 'message',
  threadId: 'room:thread:root',
  rootTimelineEntryId: 'root',
  workspaceId: 'orbit',
  incidentId: 'room',
  authorId: 'river',
  body: 'Fictional reply',
  replyToMessageId: null,
  occurredAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  serverTieOrder: 1,
  revision: 1,
  tombstone: null,
});
const summary = threadSchema.parse({
  id: 'room:thread:root',
  rootTimelineEntryId: 'root',
  workspaceId: 'orbit',
  incidentId: 'room',
  revision: 1,
  confirmedMessageCount: 1,
  participantIds: ['river'],
  participantCount: 1,
  lastActivityAt: message.occurredAt,
});
const event = (sequence: number, payload = message) =>
  persistentEventSchema.parse({
    eventId: `${payload.id}:${payload.revision}`,
    workspaceId: 'orbit',
    incidentId: 'room',
    resourceType: 'thread_message',
    resourceId: payload.id,
    revision: payload.revision,
    occurredAt: payload.createdAt,
    kind: payload.tombstone ? 'thread_message_tombstoned' : 'thread_message_created',
    payload,
    sequence,
  });
const summaryEvent = (sequence: number, payload = summary) =>
  persistentEventSchema.parse({
    eventId: `${payload.id}:${payload.revision}`,
    workspaceId: 'orbit',
    incidentId: 'room',
    resourceType: 'thread',
    resourceId: payload.id,
    revision: payload.revision,
    occurredAt: payload.lastActivityAt,
    kind: 'thread_summary_updated',
    payload,
    sequence,
  });
class Transport implements RealtimeTransport {
  listeners = new Set<(event: TransportEvent) => void>();
  connect = vi.fn(async () => {});
  disconnect = vi.fn();
  typing = vi.fn();
  subscribe(listener: (event: TransportEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(event: TransportEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
const flush = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
function setup(active = true) {
  const transport = new Transport();
  const source: PersistentEvent[] = [];
  const messages = new Map<string, ThreadMessage>();
  let current: Thread | undefined;
  const port: RealtimePort = {
    boundary: async () => source.at(-1)?.sequence ?? 0,
    sync: async (after, boundary) => ({
      events: source.filter((e) => e.sequence > after && e.sequence <= boundary),
      highWater: boundary,
      through: boundary,
      expired: false,
    }),
    snapshot: vi.fn(async () => {}),
    changed: vi.fn(),
    ephemeral: vi.fn(),
    apply: vi.fn(async (e) => {
      if (e.resourceType === 'thread') current = mergeThread(current, e.payload);
      else if (e.resourceType === 'thread_message' && active) mergeMessages(messages, [e.payload]);
    }),
  };
  const service = new RealtimeCoordinator('orbit', 'room', transport, port);
  return { service, transport, source, messages, port, summary: () => current };
}
it('protocol rejects envelope revision, incident or workspace mismatch for Thread resources', () => {
  const value = event(1);
  expect(persistentEventSchema.safeParse({ ...value, revision: 2 }).success).toBe(false);
  expect(persistentEventSchema.safeParse({ ...value, workspaceId: 'other' }).success).toBe(false);
  expect(persistentEventSchema.safeParse({ ...value, incidentId: 'other' }).success).toBe(false);
});
it('snapshot boundary rejects foreign Thread summaries, roots and message ownership before cache association', () => {
  const incident = {
    id: 'room',
    workspaceId: 'orbit',
    number: 'INC-2841',
    title: 'Fictional incident',
    description: '',
    severity: 'P1',
    serviceIds: [],
    participantIds: ['river'],
    commanderId: 'river',
    status: 'triggered',
    createdAt: message.createdAt,
    updatedAt: message.createdAt,
    resolvedAt: null,
  };
  const window = { items: [message], olderCursor: null, newerCursor: null, total: 1 };
  const discussion = { root: 'root', summary, windows: [window] };
  const parse = (thread: unknown) =>
    snapshotSchema.safeParse({ incident, windows: [], threads: [thread] });
  expect(parse(discussion).success).toBe(true);
  for (const invalid of [
    { ...discussion, root: 'other' },
    { ...discussion, summary: { ...summary, workspaceId: 'other' } },
    { ...discussion, summary: { ...summary, incidentId: 'other' } },
    { ...discussion, summary: null },
    { ...discussion, windows: [{ ...window, items: [{ ...message, threadId: 'other' }] }] },
  ])
    expect(parse(invalid).success).toBe(false);
});
it('new-reply acquisition check sees pages, targets and acknowledgments, never summary identity as a message', () => {
  const cache = new QueryClient();
  const prefix = threadKeys.all('river', 'orbit', 'room', 'root');
  cache.setQueryData([...prefix, 'summary'], { ...summary, id: 'summary-id' });
  expect(hasAcquiredThreadMessage(cache, prefix, 'summary-id')).toBe(false);
  cache.setQueryData([...prefix, 'history'], { pages: [{ items: [message] }], pageParams: [null] });
  expect(hasAcquiredThreadMessage(cache, prefix, message.id)).toBe(true);
  cache.setQueryData([...prefix, 'target', 'target-id'], {
    items: [{ ...message, id: 'target-id' }],
  });
  cache.setQueryData([...prefix, 'acknowledgments'], [{ ...message, id: 'echo-id' }]);
  expect(hasAcquiredThreadMessage(cache, prefix, 'target-id')).toBe(true);
  expect(hasAcquiredThreadMessage(cache, prefix, 'echo-id')).toBe(true);
  expect(
    hasAcquiredThreadMessage(cache, threadKeys.all('another', 'orbit', 'room', 'root'), message.id),
  ).toBe(false);
  cache.clear();
});
it('Thread snapshot acquisition batches Query writes while preserving revision and logical-arrival guards', () => {
  const cache = new QueryClient();
  const prefix = threadKeys.all('river', 'orbit', 'room', 'root');
  const deleted = {
    ...message,
    revision: 3,
    body: '',
    tombstone: { deletedAt: message.createdAt, reason: 'Withdrawn' },
  };
  cache.setQueryData([...prefix, 'history'], { pages: [{ items: [message] }], pageParams: [null] });
  cache.setQueryData([...prefix, 'acknowledgments'], [deleted]);
  const set = vi.spyOn(cache, 'setQueryData');
  const incoming = { ...message, id: 'new-reply' };
  expect([...mergeThreadSnapshotWindow(cache, prefix, [message, incoming, incoming])]).toEqual([
    'new-reply',
  ]);
  expect(set).toHaveBeenCalledTimes(1);
  expect(cache.getQueryData([...prefix, 'acknowledgments'])).toEqual([deleted, incoming]);
  expect([...mergeThreadSnapshotWindow(cache, prefix, [incoming])]).toEqual([]);
  cache.clear();
});
it('same journal deduplicates Thread summary/message revisions independently', async () => {
  const journal = new EventJournal(new MemoryAtomicStore(seedJournal));
  const values = [summaryEvent(1), event(2), event(2), summaryEvent(1)];
  await journal.append('orbit', values);
  const result = await journal.read('orbit', 0);
  expect(result.events).toHaveLength(2);
  expect(result.highWater).toBe(2);
});
it('Thread duplicate echo and out-of-order correction converge through Phase 5 coordinator', async () => {
  const s = setup();
  s.service.start();
  await flush();
  const first = event(1),
    corrected = event(2, { ...message, revision: 2, body: 'corrected' });
  s.source.push(first, corrected);
  s.transport.emit({ type: 'payload', payload: corrected });
  s.transport.emit({ type: 'payload', payload: first });
  s.transport.emit({ type: 'payload', payload: first });
  await flush();
  expect(s.messages.size).toBe(1);
  expect(s.messages.get(message.id)?.body).toBe('corrected');
  s.service.dispose();
});
it('missed Thread reply and absolute summary recover on reconnect without a second runtime', async () => {
  const s = setup();
  s.service.start();
  await flush();
  s.service.setOnline(false);
  s.source.push(event(1), summaryEvent(2));
  s.service.setOnline(true);
  await flush();
  expect(s.messages.size).toBe(1);
  expect(s.summary()?.confirmedMessageCount).toBe(1);
  expect(s.transport.connect).toHaveBeenCalledTimes(2);
  s.service.dispose();
});
it('closed Thread replay replaces summaries without eagerly loading its message history', async () => {
  const s = setup(false);
  s.source.push(event(1), summaryEvent(2));
  s.service.start();
  await flush();
  expect(s.messages.size).toBe(0);
  expect(s.summary()?.confirmedMessageCount).toBe(1);
  s.service.dispose();
});
it('expired checkpoint takes Phase 5 snapshot before advancing and accepting subsequent Thread events', async () => {
  const s = setup();
  s.source.push(event(1));
  let expired = true;
  s.port.sync = async (after, boundary) => ({
    events: expired ? [] : s.source.filter((e) => e.sequence > after && e.sequence <= boundary),
    highWater: boundary,
    through: expired ? after : boundary,
    expired,
  });
  s.port.snapshot = vi.fn(async () => {
    mergeMessages(s.messages, [message]);
    expired = false;
  });
  s.service.start();
  await flush();
  expect(s.port.snapshot).toHaveBeenCalledTimes(1);
  expect(s.messages.size).toBe(1);
  const next = event(2, { ...message, id: 'next', serverTieOrder: 2 });
  s.source.push(next);
  s.transport.emit({ type: 'payload', payload: next });
  await flush();
  expect(s.messages.size).toBe(2);
  s.service.dispose();
});
it('semantic Thread typing uses the existing transport command and root scope', async () => {
  const s = setup();
  s.service.start();
  await flush();
  s.service.typing(true, 'root');
  expect(s.transport.typing).toHaveBeenCalledWith(true, 'root');
  s.service.typing(true);
  expect(s.transport.typing).toHaveBeenLastCalledWith(true, undefined);
  s.service.dispose();
});
it('superseded Thread target generation cannot reveal or announce stale messages', async () => {
  const navigation = new TargetNavigation('Thread');
  const reveal = vi.fn(async () => {});
  const report = vi.fn();
  let release!: (value: { deleted: boolean }) => void;
  const first = navigation.navigate(
    'old',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    { reveal, latest() {} },
    report,
  );
  await navigation.navigate(
    'new',
    async () => ({ deleted: false }),
    { reveal, latest() {} },
    report,
  );
  release({ deleted: false });
  await first;
  expect(reveal).toHaveBeenCalledTimes(1);
  expect(reveal).toHaveBeenCalledWith('new', expect.any(AbortSignal));
  expect(report).toHaveBeenLastCalledWith('Target found in Thread.', 'new');
  navigation.cancel();
});
it('mock transport accepts scoped typing without opening another connection', () => {
  const transport = new MockRealtimeTransport({
    open: async () => ({}),
    stream: async () => ({}),
    presence: async () => [],
  });
  transport.typing(true, 'root');
  transport.typing(false, 'root');
  transport.disconnect();
});
