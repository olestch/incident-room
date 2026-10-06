import { expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { MockPostmortemAuthority, seedPostmortems } from '@/features/postmortem/authority';
import { postmortemHandlers } from '@/features/postmortem/handlers';
import { MockNotificationAuthority, seedNotifications } from '@/features/notifications/authority';
import { MockTimelineAuthority, seedTimeline } from '@/features/timeline/authority';
import { MockThreadAuthority, seedThreads } from '@/features/threads/authority';
import { seedIncidents } from '@/features/incident-management/authority';
import { EventJournal, seedJournal } from '@/features/realtime/journal';
import { persistentEventSchema, recipientSync } from '@/features/realtime/protocol';
import { HttpSessionAdapter } from '@/features/session/http-session-adapter';
import { MemoryAtomicStore } from '@/shared/persistence/atomic-store';
import { composeNotificationIngestion } from '@/app/_mocks/notification-ingestion';
import { composePostmortemIngestion } from '@/app/_mocks/postmortem-ingestion';
import { notificationDestination } from '@/entities/notification/model';
import {
  postmortemSchema,
  postmortemDetailSchema,
  postmortemKeys,
  emptyPostmortemFields,
  emptyActionFields,
  mergePostmortemDetail,
  type PostmortemDetail,
} from '@/entities/postmortem/model';
import { applyPostmortemEvent } from './cache';
const river = {
  id: 'demo-river',
  workspaceId: 'demo-orbit',
  role: 'admin' as const,
  status: 'active' as const,
};
const sage = { ...river, id: 'demo-sage', role: 'member' as const };
const users = [
  { ...river, name: 'River', email: 'river@example.test' },
  { ...sage, name: 'Sage', email: 'sage@example.test' },
];
function setup() {
  const incident = seedIncidents().incidents[24]!;
  const store = new MemoryAtomicStore(seedPostmortems);
  const authority = new MockPostmortemAuthority(store, async (_actor, _incident, ids) => ids);
  const journalStore = new MemoryAtomicStore(seedJournal);
  const journal = new EventJournal(journalStore);
  const notifications = new MockNotificationAuthority(new MemoryAtomicStore(seedNotifications));
  const timeline = new MockTimelineAuthority(new MemoryAtomicStore(seedTimeline));
  const threads = new MockThreadAuthority(new MemoryAtomicStore(seedThreads), async () => {});
  const notify = composeNotificationIngestion(
    notifications,
    journal,
    async () => users,
    threads,
    timeline,
  );
  return {
    incident,
    store,
    authority,
    journal,
    journalStore,
    notifications,
    publish: composePostmortemIngestion(authority, journal, notify),
  };
}
it('validates HTTP fetch/initiation/save/conflict contracts through the existing session adapter', async () => {
  const { incident, authority, publish } = setup();
  const server = setupServer(
    ...postmortemHandlers(
      authority,
      async () => river,
      async () => incident,
      async () => users,
      publish,
      async () => [],
    ),
  );
  server.listen({ onUnhandledRequest: 'error' });
  try {
    const adapter = new HttpSessionAdapter(() => 'fixture', 'http://localhost');
    const signal = new AbortController().signal;
    const root = `/incidents/${incident.number}/postmortem`;
    expect(await adapter.resource(root, postmortemDetailSchema, signal)).toEqual({
      postmortem: null,
      items: [],
    });
    const document = await adapter.resource(`${root}/initiate`, postmortemSchema, signal, {});
    const command = {
      postmortemId: document.id,
      expectedRevision: 1,
      fields: { ...emptyPostmortemFields(), summary: 'Confirmed' },
    };
    expect(await adapter.resource(`${root}/save`, postmortemSchema, signal, command)).toMatchObject(
      { revision: 2 },
    );
    await expect(
      adapter.resource(`${root}/save`, postmortemSchema, signal, command),
    ).rejects.toMatchObject({ category: 'conflict', status: 409 });
    await expect(
      adapter.resource(`${root}/save`, postmortemSchema, signal, {
        ...command,
        expectedRevision: 'invalid',
      }),
    ).rejects.toMatchObject({ category: 'validation', status: 400 });
    expect((await adapter.resource(root, postmortemDetailSchema, signal)).postmortem?.summary).toBe(
      'Confirmed',
    );
  } finally {
    server.close();
  }
});
it('publishes initiation/assignment once, excludes actors and skips ordinary text/status notification spam', async () => {
  const { authority, incident, publish, journal, notifications } = setup();
  const document = await authority.initiate(river, incident);
  await publish(river);
  await publish(sage);
  const item = await authority.createAction(
    river,
    incident,
    {
      postmortemId: document.id,
      requestId: crypto.randomUUID(),
      fields: { ...emptyActionFields(), title: 'Repair', assigneeUserId: sage.id },
    },
    users,
  );
  await publish(river);
  await authority.saveAction(
    river,
    incident,
    {
      id: item.id,
      expectedRevision: 1,
      fields: {
        ...emptyActionFields(),
        title: 'Repair updated',
        assigneeUserId: sage.id,
        status: 'done',
      },
    },
    users,
  );
  await publish(river);
  await authority.save(river, incident, {
    postmortemId: document.id,
    expectedRevision: 1,
    fields: { ...emptyPostmortemFields(), summary: 'Revised' },
  });
  await publish(river);
  expect((await notifications.page(sage, null)).items.map((item) => item.type).sort()).toEqual([
    'action_item_assigned',
    'postmortem_initiated',
  ]);
  expect((await notifications.unread(river)).count).toBe(0);
  const events = (await journal.read(river.workspaceId, 0)).events;
  expect(events.filter((event) => event.resourceType === 'postmortem')).toHaveLength(2);
  expect(events.filter((event) => event.resourceType === 'action_item')).toHaveLength(2);
  expect(
    recipientSync(await journal.read(river.workspaceId, 0), river.id).events.filter(
      (event) => event.resourceType === 'notification',
    ),
  ).toHaveLength(0);
  expect(notificationDestination((await notifications.page(sage, null)).items[0]!)).toBe(
    `/app/incidents/${incident.number}/postmortem`,
  );
});
it('recovers interrupted notification/journal/source acknowledgement without duplicates or polling-actor misattribution', async () => {
  const { authority, incident, publish, journal, store, notifications } = setup();
  await authority.initiate(river, incident);
  const original = await authority.changes(river);
  await publish(sage);
  await store.transact(river.workspaceId, (data) => {
    data.changes.push(...original);
  });
  await publish(sage);
  expect((await notifications.unread(sage)).count).toBe(1);
  expect((await journal.read(river.workspaceId, 0)).events).toHaveLength(2);
  expect(await authority.changes(river)).toEqual([]);
});
it('reconciles only existing scoped Postmortem caches, preserving higher revisions and unrelated histories', async () => {
  const { authority, incident, publish, journal } = setup();
  const document = await authority.initiate(river, incident);
  await publish(river);
  const cache = new QueryClient();
  const key = postmortemKeys.detail(sage.id, sage.workspaceId, incident.id);
  const history = ['identity', sage.id, sage.workspaceId, 'timeline', incident.id, 'history'];
  cache.setQueryData(key, {
    postmortem: { ...document, revision: 5, summary: 'Newest' },
    items: [],
  });
  cache.setQueryData(history, ['unchanged']);
  const before = cache.getQueryData(history);
  const event = (await journal.read(river.workspaceId, 0)).events.find(
    (event) => event.resourceType === 'postmortem',
  )!;
  await applyPostmortemEvent(cache, sage.id, sage.workspaceId, event);
  await applyPostmortemEvent(cache, sage.id, sage.workspaceId, event);
  expect(cache.getQueryData(key)).toMatchObject({ postmortem: { revision: 5, summary: 'Newest' } });
  expect(cache.getQueryData(history)).toBe(before);
  await applyPostmortemEvent(cache, river.id, river.workspaceId, event);
  expect(
    cache.getQueryData(postmortemKeys.detail(river.id, river.workspaceId, incident.id)),
  ).toBeUndefined();
  cache.clear();
});
it('validates envelope scope and revisions; expired checkpoint still requires authoritative snapshots', async () => {
  const { authority, incident, publish, journal, journalStore } = setup();
  await authority.initiate(river, incident);
  await publish(river);
  const event = (await journal.read(river.workspaceId, 0)).events.find(
    (event) => event.resourceType === 'postmortem',
  )!;
  expect(persistentEventSchema.safeParse({ ...event, revision: 99 }).success).toBe(false);
  expect(persistentEventSchema.safeParse({ ...event, incidentId: 'foreign' }).success).toBe(false);
  expect(persistentEventSchema.safeParse({ ...event, workspaceId: 'foreign' }).success).toBe(false);
  await journalStore.transact(river.workspaceId, (data) => {
    data.expireBefore = data.highWater;
  });
  expect((await journal.read(river.workspaceId, 0)).expired).toBe(true);
  expect((await authority.detail(sage, incident)).postmortem?.revision).toBe(1);
});
it('acquires an active absent parent before applying child deltas, never caches an orphan', async () => {
  const { authority, incident, publish, journal } = setup();
  const document = await authority.initiate(river, incident);
  await authority.createAction(
    river,
    incident,
    {
      postmortemId: document.id,
      requestId: crypto.randomUUID(),
      fields: { ...emptyActionFields(), title: 'Child race' },
    },
    users,
  );
  await publish(river);
  const event = (await journal.read(river.workspaceId, 0)).events.find(
    (event) => event.resourceType === 'action_item',
  )!;
  const cache = new QueryClient();
  const key = postmortemKeys.detail(sage.id, sage.workspaceId, incident.id);
  const observer = new QueryObserver(cache, {
    queryKey: key,
    initialData: { postmortem: null, items: [] } as PostmortemDetail,
    staleTime: Infinity,
    queryFn: () => authority.detail(sage, incident),
  });
  const unsubscribe = observer.subscribe(() => {});
  await applyPostmortemEvent(cache, sage.id, sage.workspaceId, event);
  expect(cache.getQueryData(key)).toMatchObject({
    postmortem: { id: document.id },
    items: [{ title: 'Child race' }],
  });
  unsubscribe();
  cache.clear();
});
it('marks an inactive absent parent stale without allocating orphan children or fetching closed history', async () => {
  const { authority, incident, publish, journal } = setup();
  const document = await authority.initiate(river, incident);
  await authority.createAction(
    river,
    incident,
    {
      postmortemId: document.id,
      requestId: crypto.randomUUID(),
      fields: { ...emptyActionFields(), title: 'Inactive child' },
    },
    users,
  );
  await publish(river);
  const cache = new QueryClient();
  const key = postmortemKeys.detail(sage.id, sage.workspaceId, incident.id);
  cache.setQueryData(key, { postmortem: null, items: [] });
  await applyPostmortemEvent(
    cache,
    sage.id,
    sage.workspaceId,
    (await journal.read(river.workspaceId, 0)).events.find(
      (event) => event.resourceType === 'action_item',
    )!,
  );
  expect(cache.getQueryData(key)).toEqual({ postmortem: null, items: [] });
  expect(cache.getQueryState(key)?.isInvalidated).toBe(true);
  cache.clear();
});
it('keeps a newer parent event ahead of delayed older HTTP and fences aborted cache mutation', async () => {
  const { authority, incident, publish, journal } = setup();
  const document = await authority.initiate(river, incident);
  await authority.save(river, incident, {
    postmortemId: document.id,
    expectedRevision: 1,
    fields: { ...emptyPostmortemFields(), summary: 'Newer echo' },
  });
  await publish(river);
  const events = (await journal.read(river.workspaceId, 0)).events.filter(
    (event) => event.resourceType === 'postmortem',
  );
  const cache = new QueryClient();
  const key = postmortemKeys.detail(sage.id, sage.workspaceId, incident.id);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetch = cache.fetchQuery({
    queryKey: key,
    queryFn: async () => {
      await gate;
      return mergePostmortemDetail(cache.getQueryData<PostmortemDetail>(key), {
        postmortem: document,
        items: [],
      });
    },
  });
  await applyPostmortemEvent(cache, sage.id, sage.workspaceId, events.at(-1)!);
  release();
  await fetch;
  expect(cache.getQueryData(key)).toMatchObject({
    postmortem: { revision: 2, summary: 'Newer echo' },
  });
  const abort = new AbortController();
  abort.abort();
  await expect(
    applyPostmortemEvent(cache, sage.id, sage.workspaceId, events[0]!, abort.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  cache.clear();
});
it('idle Phase 8 ingestion does not rewrite the journal, notifications or source acknowledgement', async () => {
  const { authority, publish, journal, notifications } = setup();
  const append = vi.spyOn(journal, 'append'),
    notify = vi.spyOn(notifications, 'changes'),
    acknowledge = vi.spyOn(authority, 'acknowledge');
  await publish(river);
  expect(append).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
  expect(acknowledge).not.toHaveBeenCalled();
});
