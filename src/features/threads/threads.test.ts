import { expect, it, vi } from 'vitest';
import { incidentSchema } from '@/entities/incident/model';
import {
  threadMessageSchema,
  compareMessages,
  mergeMessages,
  mergeThread,
  replyPreview,
  type ThreadMessage,
  type ThreadWindow,
} from '@/entities/thread/model';
import { threadHref, parseThreadLocation } from '@/entities/thread/navigation';
import {
  LocalWorkService,
  emptyLocalData,
  localDataSchema,
  identityKey,
  type OutboxRecord,
} from '@/shared/messaging/local-work';
import { MemoryAtomicStore } from '@/shared/persistence/atomic-store';
import { AppError } from '@/shared/errors/app-error';
import { MockThreadAuthority, seedThreads } from './authority';
import { ThreadProjection } from './projection';
import { ThreadDelivery } from './delivery';

const scope = {
  userId: 'demo-river',
  workspaceId: 'demo-orbit',
  incidentId: 'fictional-incident-2841',
  rootTimelineEntryId: 'fictional-incident-2841:evt-42',
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
  title: 'Fictional context',
  description: '',
  severity: 'P1',
  status: 'investigating',
  commanderId: actor.id,
  participantIds: [actor.id],
  serviceIds: [],
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-01T09:00:00.000Z',
  resolvedAt: null,
});
const mutation = '00000000-0000-4000-8000-000000000001';
const otherRoot = 'fictional-incident-2841:evt-3999';
const setup = () => {
  const store = new MemoryAtomicStore(seedThreads);
  const rootExists = vi.fn(async () => {});
  return { store, rootExists, authority: new MockThreadAuthority(store, rootExists) };
};
const message = (id = 'reply-one', overrides: Partial<ThreadMessage> = {}): ThreadMessage =>
  threadMessageSchema.parse({
    id,
    threadId: `${scope.incidentId}:thread:${scope.rootTimelineEntryId}`,
    ...scope,
    authorId: actor.id,
    body: 'Fictional reply',
    replyToMessageId: null,
    occurredAt: incident.createdAt,
    createdAt: incident.createdAt,
    serverTieOrder: 1,
    revision: 1,
    tombstone: null,
    ...overrides,
  });
const window = (items: ThreadMessage[], olderCursor: string | null = null): ThreadWindow => ({
  items,
  olderCursor,
  newerCursor: null,
  total: items.length,
});
it('validates flat message with reference identity, not recursive children', () => {
  const parsed = message('one', { replyToMessageId: 'parent' });
  expect(parsed.replyToMessageId).toBe('parent');
  expect(threadMessageSchema.safeParse({ ...parsed, revision: 0 }).success).toBe(false);
  expect(threadMessageSchema.safeParse({ ...parsed, body: 'x'.repeat(4001) }).success).toBe(false);
  expect('children' in threadMessageSchema.parse({ ...parsed, children: [parsed] })).toBe(false);
});
it('orders by occurredAt, server tie order, then ID regardless of arrival', () => {
  expect(
    [message('z'), message('b', { serverTieOrder: 2 }), message('a')]
      .sort(compareMessages)
      .map((m) => m.id),
  ).toEqual(['a', 'z', 'b']);
});
it('revision merge preserves corrections and tombstones against stale pages', () => {
  const original = message();
  const deleted = {
    ...original,
    revision: 3,
    tombstone: { deletedAt: incident.createdAt, reason: 'Withdrawn' },
    body: '',
  };
  const index = mergeMessages(new Map(), [deleted, original, { ...original, revision: 2 }]);
  expect(index.get(original.id)).toEqual(deleted);
  mergeMessages(index, [{ ...deleted, tombstone: null }]);
  expect(index.get(original.id)?.tombstone).not.toBeNull();
});
it('reply preview resolves loaded, unloaded and deleted parents without recursion', () => {
  const parent = message('parent');
  const index = new Map([[parent.id, parent]]);
  expect(replyPreview('parent', index, () => 'River')).toBe('River: Fictional reply');
  expect(replyPreview('missing', index, () => 'River')).toContain('Unloaded');
  index.set('parent', { ...parent, tombstone: { deletedAt: incident.createdAt, reason: 'gone' } });
  expect(replyPreview('parent', index, () => 'River')).toBe('Deleted message');
});
it('summary replacement is revision-safe, never count increments on duplicate payload', async () => {
  const s = setup();
  const summary = (await s.authority.detail(actor, incident, scope.rootTimelineEntryId))!;
  expect(mergeThread(summary, summary)).toBe(summary);
  expect(mergeThread({ ...summary, revision: 5 }, summary).revision).toBe(5);
});
it('central URL contract preserves event, unrelated parameters and hash; close removes both thread targets', () => {
  const url = new URL('https://example.test/app/incidents/INC-2841?event=older&filter=x#context');
  const href = threadHref(url, 'root', 'reply');
  expect(parseThreadLocation(new URL(href, url).searchParams)).toEqual({
    root: 'root',
    message: 'reply',
    event: 'older',
  });
  expect(threadHref(new URL(href, url), null)).toBe(
    '/app/incidents/INC-2841?event=older&filter=x#context',
  );
});
it('empty open creates no Thread; first reply atomically creates exactly one summary', async () => {
  const s = setup();
  expect(await s.authority.detail(actor, incident, otherRoot)).toBeNull();
  expect((await s.authority.window(actor, incident, otherRoot, null)).items).toHaveLength(0);
  const entry = await s.authority.create(actor, incident, otherRoot, {
    clientMutationId: mutation,
    body: 'First reply',
    replyToMessageId: null,
  });
  expect(entry.rootTimelineEntryId).toBe(otherRoot);
  expect(await s.authority.detail(actor, incident, otherRoot)).toMatchObject({
    confirmedMessageCount: 1,
    participantCount: 1,
    revision: 1,
  });
});
it('room metadata/journal reads never materialize unopened Thread history fixtures', async () => {
  const s = setup();
  await s.authority.changes(actor, incident);
  await s.authority.summaries(actor, incident, [scope.rootTimelineEntryId]);
  const data = await s.store.transact(
    JSON.stringify([scope.workspaceId, scope.incidentId]),
    (d) => d,
  );
  expect(data.messages).toEqual({});
  expect(data.fixtureCounts[scope.rootTimelineEntryId]).toBe(2000);
  await s.authority.window(actor, incident, scope.rootTimelineEntryId, null);
  const loaded = await s.store.transact(
    JSON.stringify([scope.workspaceId, scope.incidentId]),
    (d) => d,
  );
  expect(loaded.messages[scope.rootTimelineEntryId]).toHaveLength(2000);
  expect(loaded.messages[otherRoot]).toBeUndefined();
  expect(loaded.fixtureCounts[scope.rootTimelineEntryId]).toBeUndefined();
});
it('bounded recent and opaque older windows include newest, exclude overlap, locate without linear paging', async () => {
  const s = setup();
  const recent = await s.authority.window(actor, incident, scope.rootTimelineEntryId, null);
  expect(recent.items).toHaveLength(60);
  expect(recent.items.at(-1)?.serverTieOrder).toBe(2000);
  const older = await s.authority.window(
    actor,
    incident,
    scope.rootTimelineEntryId,
    recent.olderCursor,
  );
  expect(older.items.at(-1)?.serverTieOrder).toBe(1940);
  const located = await s.authority.locate(
    actor,
    incident,
    scope.rootTimelineEntryId,
    `${incident.id}:reply-42-8`,
  );
  const target = await s.authority.window(
    actor,
    incident,
    scope.rootTimelineEntryId,
    located.cursor,
  );
  expect(target.items.length).toBeLessThanOrEqual(51);
  expect(target.items.some((m) => m.id === located.entryId)).toBe(true);
  await expect(
    s.authority.window(actor, incident, otherRoot, located.cursor),
  ).rejects.toMatchObject({ category: 'validation' });
});
it('Thread snapshot reads recent, loaded IDs and summary atomically after one root validation', async () => {
  const s = setup();
  const transact = vi.spyOn(s.store, 'transact');
  const result = await s.authority.snapshot(actor, incident, scope.rootTimelineEntryId, [
    `${incident.id}:reply-42-8`,
  ]);
  expect(s.rootExists).toHaveBeenCalledTimes(1);
  expect(transact).toHaveBeenCalledTimes(1);
  expect(result.summary?.confirmedMessageCount).toBe(2000);
  expect(result.windows[0]?.items).toHaveLength(60);
  expect(result.windows[0]?.items.at(-1)?.serverTieOrder).toBe(2000);
  expect(result.windows[1]?.items.map((m) => m.serverTieOrder)).toEqual([8]);
});
it('authority independently rejects resolved admin and nonparticipant writes, allowing workspace reads', async () => {
  const s = setup();
  const input = { clientMutationId: mutation, body: 'reply', replyToMessageId: null };
  await expect(
    s.authority.create(actor, { ...incident, status: 'resolved' }, otherRoot, input),
  ).rejects.toMatchObject({ category: 'authorization' });
  const observer = { ...actor, id: 'observer', role: 'member' as const };
  await expect(s.authority.create(observer, incident, otherRoot, input)).rejects.toMatchObject({
    category: 'authorization',
  });
  expect(
    (await s.authority.window(observer, incident, scope.rootTimelineEntryId, null)).items,
  ).toHaveLength(60);
  await expect(
    s.authority.window({ ...observer, workspaceId: 'other' }, incident, otherRoot, null),
  ).rejects.toMatchObject({ category: 'authorization' });
});
it('authority checks root existence and rejects cross-Thread reply reference', async () => {
  const s = setup();
  await expect(
    s.authority.create(actor, incident, otherRoot, {
      clientMutationId: mutation,
      body: 'reply',
      replyToMessageId: `${incident.id}:reply-42-1`,
    }),
  ).rejects.toMatchObject({ category: 'validation' });
  expect(s.rootExists).toHaveBeenCalledWith(actor, incident, otherRoot);
});
it('mutation retries preserve original identity, summary and activity; changed payload or root conflicts', async () => {
  const s = setup();
  const input = { clientMutationId: mutation, body: 'reply', replyToMessageId: null };
  const first = await s.authority.create(actor, incident, otherRoot, input);
  expect(await s.authority.create(actor, incident, otherRoot, input)).toEqual(first);
  expect(await s.authority.detail(actor, incident, otherRoot)).toMatchObject({
    confirmedMessageCount: 1,
    revision: 1,
  });
  for (const changed of [
    { ...input, body: 'different' },
    { ...input, replyToMessageId: 'another' },
  ])
    await expect(s.authority.create(actor, incident, otherRoot, changed)).rejects.toMatchObject({
      category: 'conflict',
    });
  await expect(
    s.authority.create(actor, incident, scope.rootTimelineEntryId, input),
  ).rejects.toMatchObject({ category: 'conflict' });
  expect(await s.authority.outcome(actor, incident, otherRoot, mutation)).toEqual({
    status: 'found',
    entry: first,
  });
});
it('tombstone correction keeps reference identity and confirmed count, duplicate simulation does not re-journal', async () => {
  const s = setup();
  const entry = await s.authority.create(actor, incident, otherRoot, {
    clientMutationId: mutation,
    body: 'reply',
    replyToMessageId: null,
  });
  const deleted = {
    ...entry,
    revision: 2,
    body: '',
    tombstone: { deletedAt: entry.createdAt, reason: 'withdrawn' },
  };
  await s.authority.simulate(actor, incident, deleted);
  const count = (await s.authority.changes(actor, incident)).length;
  await s.authority.simulate(actor, incident, entry);
  expect((await s.authority.changes(actor, incident)).length).toBe(count);
  expect(await s.authority.detail(actor, incident, otherRoot)).toMatchObject({
    confirmedMessageCount: 1,
    revision: 2,
  });
  expect(
    (await s.authority.snapshot(actor, incident, otherRoot, [entry.id])).windows
      .flatMap((w) => w.items)
      .every((m) => !!m.tombstone),
  ).toBe(true);
});
it.each(['http-first', 'echo-first'])(
  'projection reconciles pages, target window, local alias and %s duplicate',
  async (order) => {
    const storage = new LocalWorkService(new MemoryAtomicStore(emptyLocalData));
    const lease = storage.lease(scope);
    const record = await storage.handoff(lease, 'reply', Date.now(), mutation, 'parent');
    const entry = message('confirmed', {
      body: 'reply',
      originatingClientMutationId: mutation,
      replyToMessageId: 'parent',
    });
    const projection = new ThreadProjection();
    const localRows = projection.build([], [], [record]);
    const rows =
      order === 'http-first'
        ? projection.build([window([entry])], [entry], [record])
        : projection.build([], [entry], [record]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe(localRows[0]?.key);
    const corrected = { ...entry, revision: 3, body: 'Corrected' };
    expect(
      projection.build([window([entry]), window([corrected])], [entry], [])[0]?.entry?.body,
    ).toBe('Corrected');
  },
);
it('sparse target/recent projection exposes gap rather than pretending uninterrupted history', () => {
  const projection = new ThreadProjection();
  const rows = projection.build(
    [window([message('old')]), window([message('new', { serverTieOrder: 100 })], 'opaque')],
    [],
    [],
  );
  expect(rows.some((row) => 'gap' in row)).toBe(true);
  expect(rows.filter((r) => r.entry)).toHaveLength(2);
});
it('per-Thread draft and reply target do not overwrite Timeline, other roots or identities', async () => {
  const work = new LocalWorkService(new MemoryAtomicStore(emptyLocalData));
  const a = work.lease(scope),
    b = work.lease({ ...scope, rootTimelineEntryId: otherRoot }),
    timeline = work.lease({ ...scope, rootTimelineEntryId: undefined }),
    other = work.lease({ ...scope, userId: 'other' });
  await work.draft(a, 'thread A', 'parent');
  await work.draft(b, 'thread B');
  await work.draft(timeline, 'timeline');
  expect(await work.read(a)).toMatchObject({ draft: 'thread A', replyToMessageId: 'parent' });
  expect((await work.read(b)).draft).toBe('thread B');
  expect((await work.read(timeline)).draft).toBe('timeline');
  expect((await work.read(other)).draft).toBe('');
});
it('old Phase 5 local bucket validates with additive migration, no second local database', () => {
  expect(localDataSchema.parse({ drafts: { room: 'old draft' }, outbox: [] })).toEqual({
    drafts: { room: 'old draft' },
    outbox: [],
    threadDrafts: {},
  });
});
it('atomic durable handoff includes reply target, clears only its own Thread draft, reload finds outbox', async () => {
  const store = new MemoryAtomicStore(emptyLocalData);
  const work = new LocalWorkService(store);
  const lease = work.lease(scope);
  await work.draft(lease, 'reply', 'parent');
  await work.draft(work.lease({ ...scope, rootTimelineEntryId: otherRoot }), 'retained');
  const record = await work.handoff(lease, 'reply', Date.now(), mutation, 'parent');
  expect(record).toMatchObject({
    replyToMessageId: 'parent',
    rootTimelineEntryId: scope.rootTimelineEntryId,
  });
  expect(
    await new LocalWorkService(store).read(new LocalWorkService(store).lease(scope)),
  ).toMatchObject({ draft: '', replyToMessageId: null, records: [record] });
  expect((await work.read(work.lease({ ...scope, rootTimelineEntryId: otherRoot }))).draft).toBe(
    'retained',
  );
});
it('persist failure retains body and reply target, no optimistic record or network dispatch', async () => {
  const store = new MemoryAtomicStore(emptyLocalData);
  const work = new LocalWorkService(store);
  const lease = work.lease(scope);
  await work.draft(lease, 'reply', 'parent');
  const original = store.transact.bind(store);
  store.transact = () => Promise.reject(new Error('disk'));
  const create = vi.fn();
  const delivery = new ThreadDelivery(work, lease, {
    create,
    lookup: async () => ({ status: 'missing' }),
    changed: vi.fn(),
    confirmed: vi.fn(),
  });
  await expect(delivery.prepare('reply', 'parent')).rejects.toThrow('disk');
  expect(create).not.toHaveBeenCalled();
  store.transact = original;
  expect(await work.read(lease)).toMatchObject({
    draft: 'reply',
    replyToMessageId: 'parent',
    records: [],
  });
  delivery.dispose();
});
function deliverySetup() {
  const store = new MemoryAtomicStore(emptyLocalData),
    work = new LocalWorkService(store),
    lease = work.lease(scope);
  const confirmed = vi.fn(),
    changed = vi.fn();
  const port = {
    create: vi.fn(async (record: OutboxRecord) =>
      message('confirmed', {
        body: record.body,
        originatingClientMutationId: record.clientMutationId,
        replyToMessageId: record.replyToMessageId ?? null,
      }),
    ),
    lookup: vi.fn(async () => ({ status: 'missing' as const })),
    confirmed,
    changed,
  };
  return { store, work, lease, port, delivery: new ThreadDelivery(work, lease, port) };
}
it('ambiguous delivery is looked up before retry; retry preserves UUID and contextual target', async () => {
  const s = deliverySetup();
  const record = await s.delivery.prepare('reply', 'parent');
  s.port.create.mockRejectedValueOnce(new AppError('network', 'Ambiguous'));
  await s.delivery.exposeAndSend(record);
  expect(s.port.lookup).toHaveBeenCalled();
  expect((await s.work.read(s.lease)).records[0]).toMatchObject({
    state: 'failed',
    retryAllowed: true,
  });
  await s.delivery.retry(record.clientMutationId);
  expect(s.port.create.mock.calls.map((call) => call[0].clientMutationId)).toEqual([
    record.clientMutationId,
    record.clientMutationId,
  ]);
  expect((await s.work.read(s.lease)).records).toHaveLength(0);
  s.delivery.dispose();
});
it('unknown outcome resolves from realtime echo, even when delayed failed HTTP arrives afterwards', async () => {
  const s = deliverySetup();
  const record = await s.delivery.prepare('reply', 'parent');
  let reject!: (error: unknown) => void;
  s.port.create.mockImplementation(
    () =>
      new Promise((_resolve, rejecter) => {
        reject = rejecter;
      }),
  );
  const sending = s.delivery.exposeAndSend(record);
  await vi.waitFor(() => expect(s.port.create).toHaveBeenCalled());
  const entry = message('confirmed', {
    body: 'reply',
    replyToMessageId: 'parent',
    originatingClientMutationId: record.clientMutationId,
  });
  await s.delivery.acknowledge(entry);
  reject(new AppError('network', 'late failure'));
  await sending;
  expect((await s.work.read(s.lease)).records).toHaveLength(0);
  expect(s.port.lookup).not.toHaveBeenCalled();
  expect(s.port.confirmed).toHaveBeenCalledWith(entry);
  s.delivery.dispose();
});
it('reload checks an outbox record without automatic resend', async () => {
  const s = deliverySetup();
  await s.work.handoff(s.lease, 'pending', Date.now(), mutation, 'parent');
  await s.delivery.restore();
  expect(s.port.lookup).toHaveBeenCalledWith(mutation, expect.any(AbortSignal));
  expect(s.port.create).not.toHaveBeenCalled();
  s.delivery.dispose();
});
it('confirmation with wrong Thread identity or original reply target cannot clear outbox', async () => {
  const s = deliverySetup();
  const record = await s.delivery.prepare('reply', 'parent');
  await expect(
    s.delivery.acknowledge(
      message('bad', {
        body: 'reply',
        originatingClientMutationId: record.clientMutationId,
        rootTimelineEntryId: otherRoot,
        replyToMessageId: 'parent',
      }),
    ),
  ).rejects.toMatchObject({ category: 'validation' });
  await expect(
    s.delivery.acknowledge(
      message('bad', {
        body: 'reply',
        originatingClientMutationId: record.clientMutationId,
        replyToMessageId: 'different',
      }),
    ),
  ).rejects.toMatchObject({ category: 'validation' });
  expect((await s.work.read(s.lease)).records).toHaveLength(1);
  s.delivery.dispose();
});
it('logout stops identity leases, clears all its Thread drafts/outbox but leaves another user untouched', async () => {
  const store = new MemoryAtomicStore(emptyLocalData),
    work = new LocalWorkService(store),
    lease = work.lease(scope),
    other = work.lease({ ...scope, userId: 'another' });
  await work.draft(lease, 'draft', 'parent');
  await work.handoff(lease, 'pending', Date.now(), mutation, 'parent');
  await work.draft(other, 'other draft');
  await work.stop(scope);
  await work.clearDurableOnLogout(scope);
  expect(lease.valid()).toBe(false);
  await expect(work.draft(lease, 'late')).rejects.toMatchObject({ name: 'AbortError' });
  expect(await store.transact(identityKey(scope), (d) => d)).toEqual(emptyLocalData());
  expect((await work.read(other)).draft).toBe('other draft');
});
