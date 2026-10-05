import { expect, it, vi } from 'vitest';
import { incidentSchema } from '@/entities/incident/model';
import { AppError } from '@/shared/errors/app-error';
import { MemoryAtomicStore } from '@/shared/persistence/atomic-store';
import type { TimelineEntry, TimelineWindow } from '@/entities/timeline/model';
import { generateTimeline } from './fixtures';
import { MockTimelineAuthority, seedTimeline } from './authority';
import { emptyLocalData, LocalWorkService, type OutboxRecord } from './local-work';
import { DeliveryCoordinator, type DeliveryPort } from './delivery';
import { TimelineProjection } from './projection';
import { TargetNavigation } from './target-navigation';

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
const incident = incidentSchema.parse({
  id: scope.incidentId,
  workspaceId: scope.workspaceId,
  number: 'INC-2841',
  title: 'Fictional investigation',
  description: '',
  severity: 'P1',
  status: 'triggered',
  commanderId: actor.id,
  participantIds: [actor.id],
  serviceIds: [],
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  resolvedAt: null,
});
const mutationId = '00000000-0000-4000-8000-000000000001';
function confirmation(record: OutboxRecord): TimelineEntry {
  return {
    ...generateTimeline(scope.incidentId, 1)[0]!,
    type: 'human_message',
    body: record.body,
    authorId: record.userId,
    id: 'confirmed-message',
    originatingClientMutationId: record.clientMutationId,
  };
}
function localSetup() {
  const store = new MemoryAtomicStore(emptyLocalData);
  const work = new LocalWorkService(store);
  const lease = work.lease(scope);
  const changed = vi.fn();
  const confirmed = vi.fn();
  const port: DeliveryPort = {
    create: vi.fn(async (record) => confirmation(record)),
    lookup: vi.fn(async () => ({ status: 'missing' as const })),
    changed,
    confirmed,
  };
  const delivery = new DeliveryCoordinator(work, lease, port);
  return { store, work, lease, delivery, port, changed, confirmed };
}
function window(items: TimelineEntry[]): TimelineWindow {
  return { items, total: 10000, olderCursor: 'cursor', newerCursor: null };
}
it('generator is deterministic for 10,000 and capable of 50,000 without default eager production generation', () => {
  const ten = generateTimeline(scope.incidentId, 10000);
  expect(ten).toHaveLength(10000);
  expect(ten.slice(0, 50)).toEqual(generateTimeline(scope.incidentId, 50));
  expect(generateTimeline(scope.incidentId, 50000)).toHaveLength(50000);
  expect(() => generateTimeline(scope.incidentId, 50001)).toThrow();
});
it('authority recent/history cursor is bounded and old target uses one locator/window', async () => {
  const authority = new MockTimelineAuthority(new MemoryAtomicStore(seedTimeline));
  const recent = await authority.window(actor, incident, null);
  expect(recent.items).toHaveLength(60);
  expect(recent.items.at(-1)?.serverTieOrder).toBe(4000);
  const older = await authority.window(actor, incident, recent.olderCursor);
  expect(older.items.at(-1)?.serverTieOrder).toBe(3940);
  const locator = await authority.locate(actor, incident, `${incident.id}:evt-10`);
  const target = await authority.window(actor, incident, locator.cursor);
  expect(target.items.length).toBeLessThanOrEqual(51);
  expect(target.items.some((entry) => entry.id.endsWith('evt-10'))).toBe(true);
  await expect(
    authority.window(actor, { ...incident, id: 'another' }, recent.olderCursor),
  ).rejects.toMatchObject({ category: 'validation' });
});
it('idempotency survives retries, rejects content conflicts and enforces resolved/nonparticipant policies', async () => {
  const store = new MemoryAtomicStore(seedTimeline);
  const authority = new MockTimelineAuthority(store);
  const input = { clientMutationId: mutationId, body: 'Fictional message' };
  const entry = await authority.create(actor, incident, input);
  expect(await authority.create(actor, incident, input)).toEqual(entry);
  expect((await authority.window(actor, incident, null)).total).toBe(4001);
  await expect(
    authority.create(actor, incident, { ...input, body: 'Different' }),
  ).rejects.toMatchObject({ category: 'conflict' });
  await expect(
    authority.create({ ...actor, id: 'other', role: 'member' }, incident, input),
  ).rejects.toMatchObject({ category: 'authorization' });
  await expect(
    authority.create(actor, { ...incident, status: 'resolved' }, input),
  ).rejects.toMatchObject({ category: 'authorization' });
  const other = await authority.create({ ...actor, id: 'demo-sage' }, incident, input);
  expect(other.id).not.toBe(entry.id);
  expect(await authority.outcome(actor, incident, mutationId)).toEqual({ status: 'found', entry });
});
it('overlapping windows/revisions/tombstones converge and confirmation keeps the optimistic row key', async () => {
  const { work, lease } = localSetup();
  const local = await work.handoff(lease, 'Fictional', Date.now(), mutationId);
  const confirmed = confirmation(local);
  const projection = new TimelineProjection();
  const optimistic = projection.build([], [], [local]);
  const deleted = {
    ...confirmed,
    revision: 3,
    tombstone: { deletedAt: confirmed.createdAt, reason: 'Withdrawn' },
  };
  const merged = projection.build(
    [window([confirmed]), window([deleted, confirmed])],
    [confirmed],
    [local],
  );
  expect(merged).toHaveLength(1);
  expect(merged[0]?.key).toBe(optimistic[0]?.key);
  expect(merged[0]?.entry?.revision).toBe(3);
  expect(projection.build([window([confirmed])], [], [])[0]?.entry?.tombstone).toBeTruthy();
});
it('confirmation-first duplicates do not create another logical row and sparse windows expose a gap', () => {
  const entries = generateTimeline(scope.incidentId, 100);
  const projection = new TimelineProjection();
  const rows = projection.build(
    [window(entries.slice(0, 10)), window(entries.slice(90)), window(entries.slice(0, 10))],
    [],
    [],
  );
  expect(rows.filter((row) => row.entry)).toHaveLength(20);
  expect(rows.filter((row) => 'gap' in row)).toHaveLength(1);
});
it('draft survives service recreation and handoff atomically clears draft only with durable outbox', async () => {
  const { store, work, lease } = localSetup();
  await work.draft(lease, 'Persistent draft');
  const recreated = new LocalWorkService(store);
  expect((await recreated.read(recreated.lease(scope))).draft).toBe('Persistent draft');
  const record = await work.handoff(lease, 'Persistent draft', Date.now(), mutationId);
  const data = await work.read(lease);
  expect(data.draft).toBe('');
  expect(data.records).toEqual([record]);
  await expect(work.handoff(lease, '  ')).rejects.toThrow();
  expect((await work.read(lease)).records).toHaveLength(1);
});
it('identity isolation, expiry quarantine and explicit logout clear only the exact identity', async () => {
  const { work, lease } = localSetup();
  await work.draft(lease, 'A');
  const other = work.lease({ ...scope, userId: 'other' });
  await work.draft(other, 'B');
  await work.stop(scope);
  await expect(work.draft(lease, 'late')).rejects.toMatchObject({ name: 'AbortError' });
  expect((await work.read(work.lease(scope))).draft).toBe('A');
  await work.clearDurableOnLogout(scope);
  expect((await work.read(work.lease(scope))).draft).toBe('');
  expect((await work.read(other)).draft).toBe('B');
});
it('persistence failure does not expose optimistic work or dispatch HTTP', async () => {
  const work = new LocalWorkService({
    transact: async () => {
      throw new Error('Quota');
    },
  });
  const port = { create: vi.fn(), lookup: vi.fn(), changed: vi.fn(), confirmed: vi.fn() };
  const delivery = new DeliveryCoordinator(work, work.lease(scope), port);
  await expect(delivery.prepare('Keep editor body')).rejects.toThrow('Quota');
  expect(port.create).not.toHaveBeenCalled();
  expect(port.changed).not.toHaveBeenCalled();
});
it('success enters Query association before durable removal; never persists confirmed resources locally', async () => {
  const { work, lease, delivery, port } = localSetup();
  const record = await delivery.prepare('Successful fictional message');
  let pendingAtAssociation = false;
  port.confirmed = () => {
    pendingAtAssociation = true;
  };
  await delivery.exposeAndSend(record);
  expect(pendingAtAssociation).toBe(true);
  expect((await work.read(lease)).records).toHaveLength(0);
  expect(port.create).toHaveBeenCalledTimes(1);
});
it('ambiguous persisted outcome performs lookup, confirms, and never sends twice', async () => {
  const { delivery, port, work, lease } = localSetup();
  const record = await delivery.prepare('Ambiguous');
  port.create = vi.fn(async () => {
    throw new AppError('network', 'Dropped after persistence');
  });
  port.lookup = vi.fn(async () => ({ status: 'found' as const, entry: confirmation(record) }));
  await delivery.exposeAndSend(record);
  expect(port.create).toHaveBeenCalledTimes(1);
  expect(port.lookup).toHaveBeenCalledTimes(1);
  expect((await work.read(lease)).records).toHaveLength(0);
});
it('unknown missing permits explicit same-ID retry only after lookup, not automatic replay', async () => {
  const { delivery, port, work, lease } = localSetup();
  const record = await delivery.prepare('Unknown missing');
  port.create = vi
    .fn()
    .mockRejectedValueOnce(new AppError('network', 'Drop'))
    .mockImplementation(async (value: OutboxRecord) => confirmation(value));
  await delivery.exposeAndSend(record);
  expect(port.create).toHaveBeenCalledTimes(1);
  expect((await work.read(lease)).records[0]?.state).toBe('failed');
  await delivery.retry(record.clientMutationId);
  expect(port.lookup).toHaveBeenCalledTimes(2);
  expect(vi.mocked(port.create).mock.calls.map((call) => call[0].clientMutationId)).toEqual([
    record.clientMutationId,
    record.clientMutationId,
  ]);
});
it('reload turns sending into checking and found/missing reconciliation occurs before any replay', async () => {
  const { work, lease, port } = localSetup();
  const record = await work.handoff(lease, 'Reload', Date.now(), mutationId);
  port.lookup = vi.fn(async () => ({ status: 'found' as const, entry: confirmation(record) }));
  const restored = new DeliveryCoordinator(work, lease, port);
  await restored.restore();
  expect(port.create).not.toHaveBeenCalled();
  expect(port.lookup).toHaveBeenCalledWith(mutationId, expect.any(AbortSignal));
  expect((await work.read(lease)).records).toHaveLength(0);
});
it('lookup network failure keeps unknown; Delete cannot silently delete an ambiguous message', async () => {
  const { work, lease, port, delivery } = localSetup();
  const record = await delivery.prepare('Uncertain');
  port.create = vi.fn(async () => {
    throw new Error('Network');
  });
  port.lookup = vi.fn(async () => {
    throw new Error('Network');
  });
  await delivery.exposeAndSend(record);
  expect((await work.read(lease)).records[0]?.state).toBe('unknown');
  await delivery.remove(record.clientMutationId);
  expect((await work.read(lease)).records).toHaveLength(1);
});
it('room disposal quarantines a late signal-ignoring HTTP success without exposing cross-identity results', async () => {
  const { port, work, lease, delivery } = localSetup();
  const record = await delivery.prepare('Late');
  let resolve!: (entry: TimelineEntry) => void;
  port.create = () =>
    new Promise((done) => {
      resolve = done;
    });
  const sending = delivery.exposeAndSend(record);
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  delivery.dispose();
  resolve(confirmation(record));
  await sending;
  expect(port.confirmed).not.toHaveBeenCalled();
  expect((await work.read(lease)).records).toHaveLength(1);
});
it('target navigation supersedes unfinished work and reports missing/malformed without latest fallback', async () => {
  const navigation = new TargetNavigation();
  const report = vi.fn();
  const viewport = { reveal: vi.fn(async () => {}), latest: vi.fn() };
  let resolve!: (value: { deleted: boolean }) => void;
  const old = navigation.navigate(
    'old',
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    viewport,
    report,
  );
  await navigation.navigate('new', async () => ({ deleted: true }), viewport, report);
  resolve({ deleted: false });
  await old;
  expect(viewport.reveal).toHaveBeenCalledTimes(1);
  expect(viewport.reveal).toHaveBeenCalledWith('new', expect.any(AbortSignal));
  expect(report).toHaveBeenLastCalledWith('Target found: deleted entry.', 'new');
  await navigation.navigate('bad target', async () => ({ deleted: false }), viewport, report);
  expect(report).toHaveBeenLastCalledWith('Malformed Timeline target.', null);
  await navigation.navigate(
    'missing',
    async () => {
      throw new AppError('not-found', 'Missing');
    },
    viewport,
    report,
  );
  expect(report).toHaveBeenLastCalledWith('Timeline target missing.', null);
  expect(viewport.latest).not.toHaveBeenCalled();
});
it('malformed HTTP acknowledgment remains unknown until authoritative outcome lookup confirms it', async () => {
  const { delivery, port, work, lease } = localSetup();
  const record = await delivery.prepare('Fictional malformed response');
  port.create = vi.fn(async () => {
    throw new AppError('validation', 'Invalid external response.');
  });
  port.lookup = vi.fn(async () => ({ status: 'found' as const, entry: confirmation(record) }));
  await delivery.exposeAndSend(record);
  expect(port.lookup).toHaveBeenCalledTimes(1);
  expect(port.create).toHaveBeenCalledTimes(1);
  expect((await work.read(lease)).records).toHaveLength(0);
});
it('mutation UUID aliases include author identity, so another author cannot absorb local work', async () => {
  const { work, lease } = localSetup();
  const record = await work.handoff(lease, 'Mine', Date.now(), mutationId);
  const other = {
    ...confirmation(record),
    authorId: 'another-author',
    id: 'other-server-id',
  } as TimelineEntry;
  const rows = new TimelineProjection().build([window([other])], [], [record]);
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((row) => row.key)).size).toBe(2);
});
it('a mismatched persisted identity record is never hydrated into this identity projection', async () => {
  const { store, work, lease } = localSetup();
  const record = await work.handoff(lease, 'Fictional foreign work', Date.now(), mutationId);
  await store.transact(JSON.stringify([scope.userId, scope.workspaceId]), (data) => {
    data.outbox[0] = { ...record, userId: 'another-user' };
  });
  expect((await work.read(lease)).records).toHaveLength(0);
  await expect(work.update(lease, { ...record, userId: 'another-user' })).rejects.toThrow(
    'scope mismatch',
  );
});
it('target deadline reports a bounded failure even when a load ignores cancellation', async () => {
  vi.useFakeTimers();
  try {
    const navigation = new TargetNavigation();
    const report = vi.fn();
    const viewport = { reveal: vi.fn(), latest: vi.fn() };
    const attempt = navigation.navigate('slow', () => new Promise(() => {}), viewport, report);
    await vi.advanceTimersByTimeAsync(20000);
    await attempt;
    expect(report).toHaveBeenLastCalledWith(
      'Timeline target navigation timed out. Retry is available.',
      null,
    );
    expect(viewport.latest).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
