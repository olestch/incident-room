import { expect, it } from 'vitest';
import { MemoryAtomicStore } from '@/shared/persistence/atomic-store';
import {
  MockNotificationAuthority,
  seedNotifications,
  notificationAuthoritySchema,
  recipientIds,
} from '@/features/notifications/authority';
import {
  demoNotificationExamples,
  withDemoNotificationFixtures,
} from '@/features/notifications/demo-fixtures';
import { seedIncidents } from '@/features/incident-management/authority';
import { MockTimelineAuthority, seedTimeline } from '@/features/timeline/authority';
import { MockThreadAuthority, seedThreads } from '@/features/threads/authority';
const actor = (id = 'demo-sage') => ({
  id,
  workspaceId: 'demo-orbit',
  status: 'active' as const,
  role: 'member' as const,
});
function fixture() {
  const base = new MemoryAtomicStore(seedNotifications);
  const store = withDemoNotificationFixtures(base);
  return { base, store, authority: new MockNotificationAuthority(store) };
}
it('seeds once with stable IDs, ordered timestamps, read/unread examples and recipient isolation', async () => {
  const { authority } = fixture();
  const sage = await authority.page(actor(), null),
    river = await authority.page(actor('demo-river'), null);
  expect(sage.items).toHaveLength(4);
  expect(sage.unread.count).toBe(3);
  expect(river.items).toHaveLength(2);
  expect(river.unread.count).toBe(1);
  expect(sage.items.every((item) => item.recipientUserId === 'demo-sage')).toBe(true);
  expect(river.items.every((item) => item.recipientUserId === 'demo-river')).toBe(true);
  expect(new Set([...sage.items, ...river.items].map((item) => item.id)).size).toBe(6);
  expect(sage.items.map((item) => item.createdAt)).toEqual(
    sage.items
      .map((item) => item.createdAt)
      .sort()
      .reverse(),
  );
  expect(await authority.page(actor(), null)).toEqual(sage);
  expect((await authority.page({ ...actor(), workspaceId: 'other' }, null)).items).toEqual([]);
});
it('all fixtures exclude the actor under current recipient rules and resolve to real Timeline/Thread content', async () => {
  const incident = seedIncidents().incidents[0]!;
  const timeline = new MockTimelineAuthority(new MemoryAtomicStore(seedTimeline));
  const threads = new MockThreadAuthority(
    new MemoryAtomicStore(seedThreads),
    async (a, record, root) => {
      await timeline.locate(a, record, root);
    },
  );
  for (const { actorId, notification } of demoNotificationExamples) {
    expect(
      recipientIds(
        {
          source: notification.id,
          actorId,
          workspaceId: 'demo-orbit',
          occurredAt: notification.createdAt,
          type: notification.type,
          context: notification.context,
          target: notification.target,
          recipients: [notification.recipientUserId],
        },
        ['demo-river', 'demo-sage'],
      ),
    ).toEqual([notification.recipientUserId]);
    if (notification.target.type === 'timeline') {
      await expect(
        timeline.locate(actor(notification.recipientUserId), incident, notification.target.entry),
      ).resolves.toMatchObject({ entryId: notification.target.entry });
    } else if (notification.target.type === 'thread') {
      await expect(
        threads.locate(
          actor(notification.recipientUserId),
          incident,
          notification.target.root,
          notification.target.message,
        ),
      ).resolves.toMatchObject({ entryId: notification.target.message });
    }
  }
});
it('read/unread/bulk decisions remain authoritative across repeated reads and identity changes', async () => {
  const { authority } = fixture();
  const id = (await authority.page(actor(), null)).items.find((item) => !item.readAt)!.id;
  await authority.mark(actor(), id, true);
  expect((await authority.unread(actor())).count).toBe(2);
  expect(
    (await authority.page(actor(), null)).items.find((item) => item.id === id)!.readAt,
  ).not.toBeNull();
  expect((await authority.unread(actor('demo-river'))).count).toBe(1);
  await expect(authority.mark(actor('demo-river'), id, true)).rejects.toThrow(
    'Notification unavailable',
  );
  await authority.mark(actor(), id, false);
  expect((await authority.unread(actor())).count).toBe(3);
  await authority.mark(actor(), null, true);
  expect((await authority.page(actor(), null)).unread.count).toBe(0);
  expect((await authority.page(actor(), null)).items).toHaveLength(4);
});
it('legacy migration preserves legitimate activity, source receipts and saved read state', async () => {
  const { base, authority } = fixture();
  const legacy = notificationAuthoritySchema.parse({
    ...seedNotifications(),
    demoFixtureVersion: undefined,
  });
  const example = structuredClone(demoNotificationExamples[0]!.notification);
  example.id = crypto.randomUUID();
  example.readAt = '2026-09-02T10:00:00.000Z';
  example.revision = 3;
  legacy.items = [example];
  legacy.revisions['demo-sage'] = 15;
  legacy.receipts[JSON.stringify(['timeline:fictional-incident-2841:evt-6', 'demo-sage'])] = true;
  base.values.set('demo-orbit', legacy);
  const page = await authority.page(actor(), null);
  expect(page.items).toHaveLength(4);
  expect(page.items.find((item) => item.id === example.id)).toEqual(example);
  expect(page.unread.revision).toBe(18);
  expect(await authority.page(actor(), null)).toEqual(page);
  expect(base.values.get('demo-orbit')!.demoFixtureVersion).toBe(1);
});
it('reset produces the same baseline and failures do not change confirmed read state', async () => {
  const { base, authority } = fixture();
  const initial = await authority.page(actor(), null);
  await base.transact('demo-orbit', (data) => {
    data.failOnce = true;
  });
  await expect(authority.mark(actor(), initial.items[0]!.id, true)).rejects.toThrow(
    'Read state could not be saved',
  );
  expect(await authority.page(actor(), null)).toEqual(initial);
  await authority.mark(actor(), null, true);
  base.values.clear();
  expect(await authority.page(actor(), null)).toEqual(initial);
});
