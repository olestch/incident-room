import { expect, it } from 'vitest';
import {
  compareEntries,
  mergeEntries,
  messageBodySchema,
  timelineEntrySchema,
  timelineKeys,
  type TimelineEntry,
} from './model';
const entry = (id = 'evt-1', revision = 1): TimelineEntry => ({
  id,
  incidentId: 'incident',
  type: 'human_message',
  authorId: 'author',
  body: 'Safe text',
  occurredAt: '2026-09-01T09:00:00.000Z',
  createdAt: '2026-09-01T09:00:00.000Z',
  serverTieOrder: 1,
  revision,
  important: false,
  tombstone: null,
});
it('validates all seven variants and rejects invalid external fields', () => {
  const base = entry();
  const variants = [
    base,
    { ...base, type: 'monitoring_event', source: 'Monitor', summary: 'Fictional' },
    { ...base, type: 'deployment_event', service: 'Aurora', version: 'v0.1', summary: 'Fictional' },
    { ...base, type: 'status_change', actorId: 'author', from: 'triggered', to: 'investigating' },
    { ...base, type: 'severity_change', actorId: 'author', from: 'P1', to: 'P2' },
    {
      ...base,
      type: 'participant_event',
      actorId: 'author',
      participantId: 'author',
      action: 'joined',
    },
    { ...base, type: 'system_event', summary: 'Fictional' },
  ];
  variants.forEach((variant) => expect(timelineEntrySchema.safeParse(variant).success).toBe(true));
  for (const patch of [
    { revision: 0 },
    { serverTieOrder: -1 },
    { occurredAt: 'bad' },
    { type: 'html' },
    { body: 'x'.repeat(4001) },
  ])
    expect(timelineEntrySchema.safeParse({ ...base, ...patch }).success).toBe(false);
});
it('sorts authoritative tuples independent of arrival, creation time and content', () => {
  const a = { ...entry('a'), serverTieOrder: 2 };
  const b = { ...entry('b'), createdAt: '2026-10-01T00:00:00.000Z' };
  expect([a, entry('c'), b].sort(compareEntries).map((item) => item.id)).toEqual(['b', 'c', 'a']);
});
it('highest revision wins, duplicates are harmless and tombstones cannot be resurrected by stale data', () => {
  const deleted = {
    ...entry('a', 3),
    body: '',
    tombstone: { deletedAt: '2026-09-01T10:00:00.000Z', reason: 'Source removed' },
  };
  const index = mergeEntries(new Map(), [entry('a', 2), deleted, entry('a', 1), deleted]);
  expect(index.size).toBe(1);
  expect(index.get('a')).toEqual(deleted);
});
it('plain-text validation and query keys isolate identity/room/window without page cursors', () => {
  expect(messageBodySchema.safeParse(' \n ').success).toBe(false);
  expect(messageBodySchema.safeParse('x'.repeat(4000)).success).toBe(true);
  expect(timelineKeys.history('a', 'w', 'room')).not.toEqual(
    timelineKeys.history('b', 'w', 'room'),
  );
  expect(timelineKeys.target('a', 'w', 'room', 'event')).not.toEqual(
    timelineKeys.history('a', 'w', 'room'),
  );
});
