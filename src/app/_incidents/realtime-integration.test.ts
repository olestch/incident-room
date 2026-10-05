import { expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { TimelineProjection } from '@/features/timeline/projection';
import { DeliveryCoordinator, type DeliveryPort } from '@/features/timeline/delivery';
import {
  LocalWorkService,
  emptyLocalData,
  type OutboxRecord,
} from '@/features/timeline/local-work';
import { MockTimelineAuthority, seedTimeline } from '@/features/timeline/authority';
import {
  MockIncidentAuthority,
  MemoryIncidentStore,
} from '@/features/incident-management/authority';
import { MemoryAtomicStore } from '@/shared/persistence/atomic-store';
import { mergeEntries, timelineKeys, type TimelineEntry } from '@/entities/timeline/model';
import { EventJournal, seedJournal } from '@/features/realtime/journal';
import { AppError } from '@/shared/errors/app-error';

const scope = {
  userId: 'demo-river',
  workspaceId: 'demo-orbit',
  incidentId: 'fictional-incident-2841',
};
const actor = {
  id: scope.userId,
  workspaceId: scope.workspaceId,
  role: 'admin' as const,
  status: 'active' as const,
};
const setup = () => {
  const storage = new MemoryAtomicStore(emptyLocalData);
  const work = new LocalWorkService(storage);
  const lease = work.lease(scope);
  const cache = new QueryClient();
  const key = timelineKeys.acknowledgments(scope.userId, scope.workspaceId, scope.incidentId);
  const changed = vi.fn();
  const port: DeliveryPort = {
    create: vi.fn(),
    lookup: vi.fn(),
    changed,
    confirmed(entry) {
      cache.setQueryData<TimelineEntry[]>(key, (previous = []) => [
        ...mergeEntries(new Map(previous.map((value) => [value.id, value])), [entry]).values(),
      ]);
    },
  };
  const delivery = new DeliveryCoordinator(work, lease, port);
  const confirm = (record: OutboxRecord): Extract<TimelineEntry, { type: 'human_message' }> => ({
    id: 'confirmed-one',
    incidentId: scope.incidentId,
    type: 'human_message',
    authorId: scope.userId,
    originatingClientMutationId: record.clientMutationId,
    body: record.body,
    revision: 1,
    tombstone: null,
    important: false,
    serverTieOrder: 1,
    occurredAt: record.provisionalAt,
    createdAt: record.provisionalAt,
  });
  const rows = async (projection = new TimelineProjection()) =>
    projection.build(
      [],
      cache.getQueryData<TimelineEntry[]>(key) ?? [],
      (await work.read(lease)).records,
    );
  return { storage, work, lease, cache, key, port, delivery, confirm, rows };
};
it('realtime echo before delayed HTTP confirmation keeps one stable logical row and removes outbox', async () => {
  const s = setup();
  const record = await s.delivery.prepare('Fictional mitigation confirmed');
  const entry = s.confirm(record);
  let resolve!: (entry: TimelineEntry) => void;
  s.port.create = () =>
    new Promise<TimelineEntry>((value) => {
      resolve = value;
    });
  const sending = s.delivery.exposeAndSend(record);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const key = (await s.rows())[0]!.key;
  await s.delivery.acknowledge(entry);
  expect(await s.rows()).toHaveLength(1);
  expect((await s.rows())[0]!.key).toBe(key);
  expect((await s.work.read(s.lease)).records).toHaveLength(0);
  resolve(entry);
  await sending;
  expect(await s.rows()).toHaveLength(1);
  s.delivery.dispose();
  s.cache.clear();
});
it('HTTP before realtime echo deduplicates, and old pagination overlap cannot overwrite correction', async () => {
  const s = setup();
  const record = await s.delivery.prepare('Fictional original');
  const entry = s.confirm(record);
  s.port.create = async () => entry;
  await s.delivery.exposeAndSend(record);
  await s.delivery.acknowledge(entry);
  const correction = { ...entry, revision: 5, body: 'Fictional corrected source' };
  s.port.confirmed(correction);
  const projection = new TimelineProjection();
  const rows = projection.build(
    [{ items: [entry], olderCursor: null, newerCursor: null, total: 1 }],
    s.cache.getQueryData<TimelineEntry[]>(s.key)!,
    [],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.entry?.revision).toBe(5);
  expect(await s.rows()).toHaveLength(1);
  s.delivery.dispose();
  s.cache.clear();
});
it('unknown resolves immediately from echo without resend or another outcome lookup', async () => {
  const s = setup();
  const record = await s.delivery.prepare('Fictional unknown outcome');
  s.port.create = async () => {
    throw new AppError('network', 'Outcome ambiguous');
  };
  s.port.lookup = vi.fn(async () => {
    throw new AppError('network', 'Lookup unavailable');
  });
  await s.delivery.exposeAndSend(record);
  expect((await s.work.read(s.lease)).records[0]?.state).toBe('unknown');
  await s.delivery.acknowledge(s.confirm(record));
  expect((await s.work.read(s.lease)).records).toHaveLength(0);
  expect(s.port.lookup).toHaveBeenCalledTimes(1);
  expect(await s.rows()).toHaveLength(1);
  s.delivery.dispose();
  s.cache.clear();
});
it('late HTTP failure or missing lookup cannot resurrect a realtime-confirmed local item', async () => {
  const s = setup();
  const record = await s.delivery.prepare('Fictional echo wins');
  let reject!: (reason: unknown) => void;
  s.port.create = () =>
    new Promise<TimelineEntry>((_resolve, value) => {
      reject = value;
    });
  const task = s.delivery.exposeAndSend(record);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await s.delivery.acknowledge(s.confirm(record));
  reject(new AppError('validation', 'Rejected response', 422));
  await task;
  expect((await s.work.read(s.lease)).records).toHaveLength(0);
  expect(s.port.changed).toHaveBeenLastCalledWith([]);
  s.delivery.dispose();
  s.cache.clear();
});
it('author-scoped echo cannot acknowledge another author with the same UUID', async () => {
  const s = setup();
  const record = await s.delivery.prepare('Fictional local');
  await s.delivery.acknowledge({ ...s.confirm(record), authorId: 'demo-sage' });
  expect((await s.work.read(s.lease)).records).toHaveLength(1);
  s.delivery.dispose();
  s.cache.clear();
});
it('persistent mutations atomically retain changes; interruption before journal ingestion is recoverable/idempotent', async () => {
  const store = new MemoryAtomicStore(seedTimeline);
  const timeline = new MockTimelineAuthority(store);
  const incidents = new MockIncidentAuthority(new MemoryIncidentStore());
  const incident = await incidents.detail(actor, 'INC-2841');
  const entry = await timeline.create(actor, incident, {
    body: 'Fictional recovery',
    clientMutationId: crypto.randomUUID(),
  });
  const restored = new MockTimelineAuthority(store);
  const changes = await restored.changes(actor, incident);
  expect(changes).toHaveLength(1);
  const journal = new EventJournal(new MemoryAtomicStore(seedJournal));
  const envelope = {
    eventId: `timeline:${entry.id}:1`,
    workspaceId: actor.workspaceId,
    resourceType: 'timeline' as const,
    resourceId: entry.id,
    incidentId: incident.id,
    revision: 1,
    occurredAt: entry.createdAt,
    kind: 'timeline_created' as const,
    payload: entry,
  };
  await journal.append(actor.workspaceId, [envelope]);
  await journal.append(actor.workspaceId, [envelope]);
  expect((await journal.read(actor.workspaceId, 0)).events).toHaveLength(1);
  await restored.acknowledgeChanges(actor, incident, [`${entry.id}:1`]);
  expect(await restored.changes(actor, incident)).toHaveLength(0);
});
it('incident revisions and internal simulated metadata corrections are journaled without mutation UI', async () => {
  const authority = new MockIncidentAuthority(new MemoryIncidentStore());
  const initial = await authority.detail(actor, 'INC-2841');
  const next = await authority.simulate(actor, initial.number, {
    status: 'investigating',
    severity: 'P2',
  });
  expect(next.revision).toBe(initial.revision + 1);
  expect(await authority.changes(actor)).toMatchObject([
    { kind: 'status_changed', incident: { status: 'investigating', severity: 'P2' } },
  ]);
});
