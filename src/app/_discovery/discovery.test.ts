import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { setupServer } from 'msw/node';
import { composeRealtimeAuthority } from '@/app/_mocks/realtime-authority';
import {
  MockIncidentAuthority,
  MemoryIncidentStore,
  seedIncidents,
} from '@/features/incident-management/authority';
import { MockTimelineAuthority, seedTimeline } from '@/features/timeline/authority';
import { MockThreadAuthority, seedThreads } from '@/features/threads/authority';
import { MemoryAtomicStore } from '@/shared/persistence/atomic-store';
import { composeSearchAuthority } from '@/app/_mocks/search-authority';
import { composeNotificationIngestion, mentionIds } from '@/app/_mocks/notification-ingestion';
import {
  MockNotificationAuthority,
  seedNotifications,
  type Activity,
} from '@/features/notifications/authority';
import { EventJournal, seedJournal } from '@/features/realtime/journal';
import { recipientSync, persistentEventSchema } from '@/features/realtime/protocol';
import {
  normalizeSearch,
  searchRequestSchema,
  searchDestination,
  searchSnippet,
  highlightSegments,
  searchKey,
} from '@/entities/search/model';
import {
  notificationSchema,
  notificationDestination,
  notificationKeys,
} from '@/entities/notification/model';
import { commandRegistry, filterCommands, paletteShortcut } from '@/features/command-palette/model';
import { cacheNotification, cacheUnread, applyNotification } from './notification-cache';
const river = {
  id: 'demo-river',
  workspaceId: 'demo-orbit',
  role: 'admin' as const,
  status: 'active' as const,
};
const sage = { ...river, id: 'demo-sage', role: 'member' as const };
const users = [
  { ...river, name: 'River Vale', email: 'river.vale@example.test' },
  { ...sage, name: 'Sage Linden', email: 'sage.linden@example.test' },
];
function setup() {
  const incidents = new MockIncidentAuthority(new MemoryIncidentStore());
  const timelineStore = new MemoryAtomicStore(seedTimeline);
  const timeline = new MockTimelineAuthority(timelineStore);
  const threadStore = new MemoryAtomicStore(seedThreads);
  const threads = new MockThreadAuthority(threadStore, async (actor, incident, root) => {
    await timeline.locate(actor, incident, root);
  });
  const notificationStore = new MemoryAtomicStore(seedNotifications);
  const notifications = new MockNotificationAuthority(notificationStore);
  const journal = new EventJournal(new MemoryAtomicStore(seedJournal));
  return {
    incidents,
    timeline,
    threads,
    timelineStore,
    threadStore,
    notifications,
    journal,
    search: composeSearchAuthority(incidents, timeline, threads, async () => users),
    ingestion: composeNotificationIngestion(
      notifications,
      journal,
      async () => users,
      threads,
      timeline,
    ),
  };
}
const incident = seedIncidents().incidents[0]!;
describe('authority-backed Search', () => {
  it('normalizes whitespace and enforces two characters and bounds', () => {
    expect(normalizeSearch('  gate  way  ')).toBe('gate way');
    expect(searchRequestSchema.safeParse({ query: ' a ' }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ query: 'abc', limit: 11 }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ query: 'x'.repeat(201) }).success).toBe(false);
  });
  it('ranks exact Incident number above text and has repeatable ties', async () => {
    const { search } = setup();
    const first = await search.search(river, { query: 'INC-2841', type: 'incident' });
    expect(first.items[0]?.id).toBe(incident.id);
    expect(await search.search(river, { query: 'INC-2841', type: 'incident' })).toEqual(first);
  });
  it('bounds each group and paginates without duplicate IDs', async () => {
    const { search } = setup();
    const first = await search.search(river, {
      query: 'Fictional response',
      type: 'timeline_message',
      limit: 3,
    });
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const next = await search.search(river, {
      query: 'Fictional response',
      type: 'timeline_message',
      limit: 3,
      cursor: first.nextCursor,
    });
    expect(next.items).toHaveLength(3);
    expect(new Set([...first.items, ...next.items].map((item) => item.id)).size).toBe(6);
  });
  it('rejects cursor reuse by query, identity, filters or limit', async () => {
    const { search } = setup();
    const first = await search.search(river, {
      query: 'Aurora',
      type: 'timeline_message',
      limit: 2,
    });
    for (const raw of [
      { query: 'Cedar', type: 'timeline_message', limit: 2 },
      { query: 'Aurora', type: 'incident', limit: 2 },
      { query: 'Aurora', type: 'timeline_message', limit: 3 },
    ])
      await expect(
        search.search(river, { ...raw, cursor: first.nextCursor }),
      ).rejects.toMatchObject({ category: 'validation' });
    await expect(
      search.search(sage, {
        query: 'Aurora',
        type: 'timeline_message',
        limit: 2,
        cursor: first.nextCursor,
      }),
    ).rejects.toMatchObject({ category: 'validation' });
  });
  it('enforces workspace and deactivated actor permissions', async () => {
    const { search } = setup();
    expect(
      (await search.search({ ...river, workspaceId: 'foreign' }, { query: 'Aurora' })).items,
    ).toHaveLength(0);
    await expect(
      search.search({ ...river, status: 'deactivated' }, { query: 'Aurora' }),
    ).rejects.toMatchObject({ category: 'authorization' });
  });
  it('new confirmed Timeline content is searchable and canonical, without reload', async () => {
    const { timeline, search } = setup();
    const entry = await timeline.create(river, incident, {
      body: 'Independent zircon evidence',
      clientMutationId: crypto.randomUUID(),
    });
    const page = await search.search(river, { query: 'zircon' });
    expect(page.items).toHaveLength(1);
    expect(searchDestination(page.items[0]!)).toBe(
      `/app/incidents/INC-2841?${new URLSearchParams({ event: entry.id })}`,
    );
    expect(page.items[0]!.snippet).toContain('zircon');
  });
  it('new Thread content is searchable at exact root/message', async () => {
    const { threads, search } = setup();
    const root = `${incident.id}:evt-3999`;
    const entry = await threads.create(river, incident, root, {
      body: 'Independent cobalt evidence',
      clientMutationId: crypto.randomUUID(),
      replyToMessageId: null,
    });
    const page = await search.search(river, { query: 'cobalt' });
    expect(page.items).toHaveLength(1);
    expect(searchDestination(page.items[0]!)).toBe(
      `/app/incidents/INC-2841?${new URLSearchParams({ thread: root, message: entry.id })}`,
    );
  });
  it('unopened fixture discussion is searchable without persisting a client dataset', async () => {
    const { search, threadStore } = setup();
    const page = await search.search(river, {
      query: 'Fictional contextual reply 800.',
      type: 'thread_message',
    });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.id).toBe(`${incident.id}:reply-42-800`);
    expect(page.items[0]!.score).toBeGreaterThan(page.items[1]!.score);
    const data = threadStore.values.get(JSON.stringify([incident.workspaceId, incident.id]))!;
    expect(data.messages).toEqual({});
    expect(data.fixtureCounts[`${incident.id}:evt-42`]).toBe(2000);
  });
  it('excludes both Timeline and Thread tombstones immediately', async () => {
    const { timeline, threads, search } = setup();
    const entry = await timeline.create(river, incident, {
      body: 'Removed azurite',
      clientMutationId: crypto.randomUUID(),
    });
    const reply = await threads.create(river, incident, `${incident.id}:evt-3999`, {
      body: 'Removed azurite',
      clientMutationId: crypto.randomUUID(),
      replyToMessageId: null,
    });
    await timeline.simulate(river, incident, {
      ...entry,
      revision: 2,
      tombstone: { deletedAt: entry.createdAt, reason: 'Removed' },
    });
    await threads.simulate(river, incident, {
      ...reply,
      revision: 2,
      tombstone: { deletedAt: reply.createdAt, reason: 'Removed' },
    });
    expect((await search.search(river, { query: 'azurite' })).items).toHaveLength(0);
  });
  it('finds only workspace users and never searches their credentials', async () => {
    const { search } = setup();
    const page = await search.search(river, { query: 'Sage' });
    expect(page.items[0]?.type).toBe('user');
    expect(searchDestination(page.items[0]!)).toBe('/app/profile/demo-sage');
    expect((await search.search(river, { query: 'Fictional-pass-42' })).items).toHaveLength(0);
  });
  it('snippets are bounded and highlights retain escaped plain text', () => {
    const text = '<script>unsafe</script> ' + 'safe '.repeat(100);
    const snippet = searchSnippet(text, 'unsafe');
    expect(snippet.length).toBeLessThanOrEqual(240);
    const segments = highlightSegments(snippet, 'unsafe SAFE');
    expect(segments.map((segment) => segment.text).join('')).toBe(snippet);
    expect(segments.some((segment) => segment.match)).toBe(true);
  });
  it('separates Query identity, filters, pagination and palette response shape', () => {
    expect(searchKey('a', 'w', 'abc', null)).not.toEqual(searchKey('b', 'w', 'abc', null));
    expect(searchKey('a', 'w', 'abc', 'incident')).not.toEqual(
      searchKey('a', 'w', 'abc', 'incident', 5),
    );
  });
});
const activity = (source = 'source'): Activity => ({
  source,
  workspaceId: 'demo-orbit',
  actorId: river.id,
  occurredAt: '2026-09-01T10:00:00.000Z',
  type: 'timeline_mention',
  context: 'INC-2841: mentioned you',
  target: { type: 'timeline', number: 'INC-2841', entry: `${incident.id}:evt-1` },
  recipients: [river.id, sage.id, sage.id, 'foreign'],
});
describe('persistent Notifications and the existing journal', () => {
  it('metadata ingestion uses the original actor, not the recipient polling viewer, for assignment/severity/status', async () => {
    const { incidents, timeline, threads, notifications, journal, ingestion } = setup();
    const created = await incidents.create(
      river,
      {
        title: 'Fictional metadata evidence',
        description: '',
        severity: 'P3',
        serviceIds: [],
        participantIds: [sage.id],
      },
      users,
      crypto.randomUUID(),
    );
    const server = setupServer(
      ...composeRealtimeAuthority(
        journal,
        incidents,
        timeline,
        async () => sage,
        threads,
        ingestion,
      ),
    );
    server.listen({ onUnhandledRequest: 'error' });
    try {
      expect((await fetch('http://localhost/mock-api/realtime/open')).status).toBe(200);
      await incidents.simulate(river, created.number, { severity: 'P1' });
      await fetch('http://localhost/mock-api/realtime/open');
      await incidents.simulate(river, created.number, { status: 'investigating' });
      await fetch('http://localhost/mock-api/realtime/open');
      const page = await notifications.page(sage, null);
      expect(new Set(page.items.map((item) => item.type))).toEqual(
        new Set(['assigned', 'severity_changed', 'status_changed']),
      );
      expect(page.unread.count).toBe(3);
      expect((await notifications.page(river, null)).items).toHaveLength(0);
      expect(
        (await journal.read(river.workspaceId, 0)).events.filter(
          (event) => event.resourceType === 'notification',
        ),
      ).toHaveLength(3);
      await fetch('http://localhost/mock-api/realtime/open');
      expect((await notifications.unread(sage)).count).toBe(3);
    } finally {
      server.close();
    }
  });
  it('recipient rules exclude self, duplicates and inactive/inaccessible users', async () => {
    const { notifications } = setup();
    await notifications.produce(
      activity(),
      users.map((user) => user.id),
    );
    expect((await notifications.page(sage, null)).items).toHaveLength(1);
    expect((await notifications.page(river, null)).items).toHaveLength(0);
  });
  it('production replay is idempotent even after source acknowledgement', async () => {
    const { notifications, ingestion } = setup();
    await notifications.produce(activity(), [sage.id]);
    await ingestion.publish(river);
    await notifications.produce(activity(), [sage.id]);
    expect((await notifications.unread(sage)).count).toBe(1);
  });
  it('read/unread/bulk are revisioned and idempotent', async () => {
    const { notifications } = setup();
    await notifications.produce(activity(), [sage.id]);
    const first = (await notifications.page(sage, null)).items[0]!;
    await notifications.mark(sage, first.id, true);
    const read = (await notifications.page(sage, null)).items[0]!;
    expect(read.revision).toBe(2);
    expect((await notifications.unread(sage)).count).toBe(0);
    await notifications.mark(sage, first.id, true);
    expect((await notifications.page(sage, null)).items[0]!.revision).toBe(2);
    await notifications.mark(sage, first.id, false);
    expect((await notifications.unread(sage)).count).toBe(1);
    await notifications.mark(sage, null, true);
    expect((await notifications.unread(sage)).count).toBe(0);
    await notifications.mark(sage, null, true);
    expect((await notifications.page(sage, null)).items[0]!.revision).toBe(4);
  });
  it('never allows another recipient to mutate a record or reuse their cursor', async () => {
    const { notifications } = setup();
    for (let i = 0; i < 21; i++) await notifications.produce(activity(`source-${i}`), [sage.id]);
    const page = await notifications.page(sage, null);
    expect(page.items).toHaveLength(20);
    expect((await notifications.page(sage, page.nextCursor)).items).toHaveLength(1);
    await expect(notifications.mark(river, page.items[0]!.id, true)).rejects.toMatchObject({
      category: 'not-found',
    });
    await expect(notifications.page(river, page.nextCursor)).rejects.toMatchObject({
      category: 'validation',
    });
  });
  it('publishes recipient-only resources; other recipients receive safe checkpoints', async () => {
    const { notifications, ingestion, journal } = setup();
    await notifications.produce(activity(), [sage.id]);
    await ingestion.publish(river);
    const replay = await journal.read('demo-orbit', 0);
    expect(recipientSync(replay, sage.id).events[0]?.resourceType).toBe('notification');
    const redacted = recipientSync(replay, river.id);
    expect(redacted.events[0]?.resourceType).toBe('checkpoint');
    expect(redacted.through).toBe(replay.through);
    expect(JSON.stringify(redacted)).not.toContain('mentioned');
    expect(persistentEventSchema.safeParse(redacted.events[0]).success).toBe(true);
  });
  it('recovers missed delivery from journal and preserves stable event identity', async () => {
    const { notifications, ingestion, journal } = setup();
    const boundary = (await journal.read('demo-orbit', 0)).highWater;
    await notifications.produce(activity(), [sage.id]);
    await ingestion.publish(river);
    const replay = recipientSync(await journal.read('demo-orbit', boundary), sage.id);
    expect(replay.events).toHaveLength(1);
    expect(replay.events[0]?.resourceType).toBe('notification');
    await ingestion.publish(river);
    expect((await journal.read('demo-orbit', boundary)).events).toHaveLength(1);
  });
  it('duplicate events and stale revisions cannot double unread or undo read state', async () => {
    const { notifications } = setup();
    const cache = new QueryClient();
    await notifications.produce(activity(), [sage.id]);
    const page = await notifications.page(sage, null);
    const item = page.items[0]!;
    applyNotification(cache, sage.id, sage.workspaceId, item, page.unread);
    applyNotification(cache, sage.id, sage.workspaceId, item, page.unread);
    expect(cache.getQueryData(notificationKeys.unread(sage.id, sage.workspaceId))).toMatchObject({
      count: 1,
    });
    await notifications.mark(sage, item.id, true);
    const read = await notifications.page(sage, null);
    applyNotification(cache, sage.id, sage.workspaceId, read.items[0]!, read.unread);
    expect(cacheNotification(cache, sage.id, sage.workspaceId, item).readAt).not.toBeNull();
    expect(cacheUnread(cache, sage.id, sage.workspaceId, page.unread).count).toBe(0);
    cache.clear();
  });
  it('Query isolation rejects foreign recipient and removes identity-owned cache', async () => {
    const { notifications } = setup();
    const cache = new QueryClient();
    await notifications.produce(activity(), [sage.id]);
    const item = (await notifications.page(sage, null)).items[0]!;
    expect(() => cacheNotification(cache, river.id, river.workspaceId, item)).toThrow('scope');
    cacheNotification(cache, sage.id, sage.workspaceId, item);
    cache.removeQueries({ queryKey: ['identity', sage.id, sage.workspaceId] });
    expect(cache.getQueryCache().getAll()).toHaveLength(0);
    cache.clear();
  });
  it('validates destination and envelope recipient correspondence', async () => {
    const { notifications } = setup();
    await notifications.produce(activity(), [sage.id]);
    const item = (await notifications.page(sage, null)).items[0]!;
    expect(
      notificationSchema.safeParse({
        ...item,
        target: { type: 'incident', number: 'https://evil.test' },
      }).success,
    ).toBe(false);
    expect(notificationDestination(item)).toContain('?event=');
    expect(
      persistentEventSchema.safeParse({
        resourceType: 'notification',
        kind: 'notification_updated',
        eventId: 'a',
        workspaceId: 'foreign',
        sequence: 1,
        resourceId: item.id,
        revision: 1,
        occurredAt: item.createdAt,
        payload: { notification: item, unread: await notifications.unread(sage) },
      }).success,
    ).toBe(false);
  });
  it('existing mention protocol generates one exact Timeline destination', async () => {
    const { timeline, ingestion, notifications } = setup();
    const entry = await timeline.create(river, incident, {
      body: 'Check @Sage Linden [demo-sage]',
      clientMutationId: crypto.randomUUID(),
    });
    await ingestion.timeline(incident, entry);
    expect(mentionIds('Check @Sage Linden [demo-sage]')).toEqual(['demo-sage']);
    const page = await notifications.page(sage, null);
    expect(page.items[0]?.type).toBe('timeline_mention');
    expect(notificationDestination(page.items[0]!)).toBe(
      `/app/incidents/INC-2841?${new URLSearchParams({ event: entry.id })}`,
    );
  });
  it('Thread participation and explicit mention converge to one notification with exact message', async () => {
    const { threads, ingestion, notifications } = setup();
    const root = `${incident.id}:evt-4000`;
    const entry = await threads.create(river, incident, root, {
      body: 'Check @Sage Linden [demo-sage]',
      clientMutationId: crypto.randomUUID(),
      replyToMessageId: null,
    });
    await ingestion.thread(incident, entry);
    const page = await notifications.page(sage, null);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.type).toBe('thread_mention');
    expect(notificationDestination(page.items[0]!)).toBe(
      `/app/incidents/INC-2841?${new URLSearchParams({ thread: root, message: entry.id })}`,
    );
  });
});
describe('safe command registry', () => {
  it('omits unavailable creation and all Incident commands outside context', () => {
    expect(
      commandRegistry('/app/search', new URLSearchParams(), false).some(
        (command) => command.action === 'create',
      ),
    ).toBe(false);
    expect(
      commandRegistry('/app/search', new URLSearchParams(), true).some(
        (command) => command.category === 'Current Incident',
      ),
    ).toBe(false);
  });
  it('Thread close preserves independent Timeline and unrelated URL state', () => {
    const commands = commandRegistry(
      '/app/incidents/INC-2841',
      new URLSearchParams('thread=root&message=reply&event=old&keep=yes'),
      true,
    );
    expect(commands.find((command) => command.id === 'close-thread')?.destination).toBe(
      '/app/incidents/INC-2841?event=old&keep=yes',
    );
    expect(commands.some((command) => /resolve|delete|transfer/i.test(command.label))).toBe(false);
  });
  it('filters local static commands independently of remote results', () => {
    const commands = commandRegistry('/app/search', new URLSearchParams(), true);
    expect(filterCommands(commands, 'my incidents').map((command) => command.id)).toEqual(['mine']);
    expect(filterCommands(commands, 'NOTIFICATIONS')[0]?.id).toBe('notifications');
  });
  it('accepts Ctrl and Cmd while refusing IME, editable, modal and modified conflicts', () => {
    const event = {
      key: 'k',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      isComposing: false,
      defaultPrevented: false,
    };
    expect(paletteShortcut(event, false, false)).toBe(true);
    expect(paletteShortcut({ ...event, ctrlKey: false, metaKey: true }, false, false)).toBe(true);
    for (const patch of [
      { isComposing: true },
      { altKey: true },
      { shiftKey: true },
      { defaultPrevented: true },
      { ctrlKey: false },
    ])
      expect(paletteShortcut({ ...event, ...patch }, false, false)).toBe(false);
    expect(paletteShortcut(event, true, false)).toBe(false);
    expect(paletteShortcut(event, false, true)).toBe(false);
  });
});
