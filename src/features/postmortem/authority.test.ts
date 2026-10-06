import { beforeEach, expect, it, vi } from 'vitest';
import { incidentSchema } from '@/entities/incident/model';
import { type IncidentActor } from '@/entities/incident/policy';
import { type WorkspaceUser } from '@/entities/current-user/model';
import {
  actionFieldsSchema,
  emptyPostmortemFields,
  emptyActionFields,
  postmortemDetailSchema,
  mergePostmortemDetail,
  type ActionItem,
} from '@/entities/postmortem/model';
import { MemoryAtomicStore } from '@/shared/persistence/atomic-store';
import { MockPostmortemAuthority, seedPostmortems } from './authority';

const admin: IncidentActor = { id: 'river', workspaceId: 'orbit', role: 'admin', status: 'active' };
const commander: IncidentActor = { ...admin, id: 'sage', role: 'member' };
const participant: IncidentActor = { ...commander, id: 'participant' };
const reader: IncidentActor = { ...commander, id: 'reader' };
const incident = incidentSchema.parse({
  id: 'incident-42',
  number: 'INC-2842',
  workspaceId: 'orbit',
  title: 'Fictional incident',
  description: '',
  status: 'resolved',
  severity: 'P2',
  commanderId: commander.id,
  participantIds: [commander.id, participant.id],
  serviceIds: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T01:00:00.000Z',
  resolvedAt: '2026-09-01T01:00:00.000Z',
});
const users: WorkspaceUser[] = [admin, commander, participant, reader].map((user) => ({
  ...user,
  name: user.id,
  email: `${user.id}@example.test`,
}));
let store: MemoryAtomicStore<ReturnType<typeof seedPostmortems>>;
let authority: MockPostmortemAuthority;
const references = vi.fn(async (_actor: IncidentActor, _incident: unknown, ids: string[]) =>
  [...ids].sort(),
);
beforeEach(() => {
  store = new MemoryAtomicStore(seedPostmortems);
  authority = new MockPostmortemAuthority(store, references, () =>
    Date.parse('2026-10-06T00:00:00.000Z'),
  );
});
it('returns absent shared draft to an active workspace reader', async () => {
  expect(await authority.detail(reader, incident)).toEqual({ postmortem: null, items: [] });
});
it.each([admin, commander])('allows commander/admin initiation exactly once', async (actor) => {
  const document = await authority.initiate(actor, incident);
  expect(document.revision).toBe(1);
  expect(document.status).toBe('draft');
  expect(await authority.initiate(actor, incident)).toEqual(document);
  expect(await authority.changes(actor)).toHaveLength(1);
});
it.each([
  participant,
  reader,
  { ...admin, status: 'deactivated' as const },
  { ...admin, workspaceId: 'other' },
])('rejects unauthorized initiation even when already initiated', async (actor) => {
  await authority.initiate(admin, incident);
  await expect(authority.initiate(actor, incident)).rejects.toMatchObject({
    category: 'authorization',
  });
});
it('forbids active incident initiation, view and update', async () => {
  const active = { ...incident, status: 'monitoring' as const };
  await expect(authority.initiate(admin, active)).rejects.toMatchObject({
    category: 'authorization',
  });
  await expect(authority.detail(admin, active)).rejects.toMatchObject({
    category: 'authorization',
  });
});
it('allows participants to save with CAS and authority-ordered references', async () => {
  const document = await authority.initiate(commander, incident);
  const next = await authority.save(participant, incident, {
    postmortemId: document.id,
    expectedRevision: 1,
    fields: { ...emptyPostmortemFields(), summary: 'Recovered', timelineEntryIds: ['z', 'a'] },
  });
  expect(next.revision).toBe(2);
  expect(next.updatedBy).toBe(participant.id);
  expect(next.timelineEntryIds).toEqual(['a', 'z']);
});
it('serializes concurrent CAS, rejecting the loser without overwriting winning content', async () => {
  const document = await authority.initiate(admin, incident);
  const command = (summary: string) => ({
    postmortemId: document.id,
    expectedRevision: 1,
    fields: { ...emptyPostmortemFields(), summary },
  });
  const results = await Promise.allSettled([
    authority.save(admin, incident, command('A')),
    authority.save(participant, incident, command('B')),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { category: 'conflict', status: 409 },
  });
  expect((await authority.detail(reader, incident)).postmortem).toMatchObject({
    summary: 'A',
    revision: 2,
  });
});
it('rejects foreign document and nonparticipant saves independently of UI', async () => {
  const document = await authority.initiate(admin, incident);
  const command = {
    postmortemId: document.id,
    expectedRevision: 1,
    fields: emptyPostmortemFields(),
  };
  await expect(authority.save(reader, incident, command)).rejects.toMatchObject({
    category: 'authorization',
  });
  await expect(
    authority.save(admin, incident, { ...command, postmortemId: crypto.randomUUID() }),
  ).rejects.toMatchObject({ category: 'not-found' });
});
it('validates plain-text limits and duplicate reference IDs', async () => {
  const document = await authority.initiate(admin, incident);
  for (const fields of [
    { ...emptyPostmortemFields(), summary: 'x'.repeat(8001) },
    { ...emptyPostmortemFields(), timelineEntryIds: ['a', 'a'] },
  ])
    await expect(
      authority.save(admin, incident, { postmortemId: document.id, expectedRevision: 1, fields }),
    ).rejects.toThrow();
  expect((await authority.detail(admin, incident)).postmortem?.revision).toBe(1);
});
it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-1-1'])(
  'rejects impossible or noncanonical due date %s',
  (dueDate) => {
    expect(
      actionFieldsSchema.safeParse({ ...emptyActionFields(), title: 'Task', dueDate }).success,
    ).toBe(false);
  },
);
it('accepts leap-day and nullable date/assignee; title trims and is required', () => {
  expect(
    actionFieldsSchema.parse({ ...emptyActionFields(), title: ' Task ', dueDate: '2028-02-29' })
      .title,
  ).toBe('Task');
  expect(actionFieldsSchema.safeParse({ ...emptyActionFields(), title: '  ' }).success).toBe(false);
});
async function create(fields = { ...emptyActionFields(), title: 'Follow up' }) {
  const document = await authority.initiate(admin, incident);
  return authority.createAction(
    admin,
    incident,
    { postmortemId: document.id, requestId: crypto.randomUUID(), fields },
    users,
  );
}
it('creates an assigned Action Item and deduplicates same-request retry without duplicate notifications', async () => {
  const document = await authority.initiate(admin, incident);
  const input = {
    postmortemId: document.id,
    requestId: crypto.randomUUID(),
    fields: {
      ...emptyActionFields(),
      title: 'Task',
      assigneeUserId: commander.id,
      dueDate: '2026-10-31',
    },
  };
  const item = await authority.createAction(admin, incident, input, users);
  expect(item.revision).toBe(1);
  expect(await authority.createAction(admin, incident, input, users)).toEqual(item);
  await expect(
    authority.createAction(
      admin,
      incident,
      { ...input, fields: { ...input.fields, title: 'Different' } },
      users,
    ),
  ).rejects.toMatchObject({ category: 'conflict' });
  expect((await authority.detail(admin, incident)).items).toHaveLength(1);
  expect(
    (await authority.changes(admin)).filter((change) => change.resourceType === 'action_item'),
  ).toHaveLength(1);
});
it.each(['absent', 'deactivated', 'foreign'])('rejects invalid assignee %s', async (id) => {
  const document = await authority.initiate(admin, incident);
  const invalid = [
    ...users,
    { ...users[0]!, id: 'deactivated', status: 'deactivated' as const },
    { ...users[0]!, id: 'foreign', workspaceId: 'elsewhere' },
  ];
  await expect(
    authority.createAction(
      participant,
      incident,
      {
        postmortemId: document.id,
        requestId: crypto.randomUUID(),
        fields: { ...emptyActionFields(), title: 'Task', assigneeUserId: id },
      },
      invalid,
    ),
  ).rejects.toMatchObject({ category: 'validation' });
});
it('updates independent Action Item revision/status, rejects stale revision and does not change document revision', async () => {
  const item = await create();
  const fields = { ...emptyActionFields(), title: 'Follow up', status: 'in_progress' as const };
  const next = await authority.saveAction(
    participant,
    incident,
    { id: item.id, expectedRevision: 1, fields },
    users,
  );
  expect(next.revision).toBe(2);
  await expect(
    authority.saveAction(
      admin,
      incident,
      { id: item.id, expectedRevision: 1, fields: { ...fields, status: 'done' } },
      users,
    ),
  ).rejects.toMatchObject({ category: 'conflict' });
  expect(await authority.detail(reader, incident)).toMatchObject({
    postmortem: { revision: 1 },
    items: [{ status: 'in_progress', revision: 2 }],
  });
});
it('forbids reader Action Item creation/update and cross-incident mutation', async () => {
  const item = await create();
  const fields = { ...emptyActionFields(), title: 'Task' };
  await expect(
    authority.saveAction(reader, incident, { id: item.id, expectedRevision: 1, fields }, users),
  ).rejects.toMatchObject({ category: 'authorization' });
  await expect(
    authority.createAction(
      reader,
      incident,
      { postmortemId: item.postmortemId, requestId: crypto.randomUUID(), fields },
      users,
    ),
  ).rejects.toMatchObject({ category: 'authorization' });
  await expect(
    authority.saveAction(
      admin,
      { ...incident, id: 'other' },
      { id: item.id, expectedRevision: 1, fields },
      users,
    ),
  ).rejects.toMatchObject({ category: 'not-found' });
});
it('keeps source changes recoverable and acknowledges only exact committed revisions', async () => {
  await create();
  const changes = await authority.changes(admin);
  await authority.acknowledge(admin, [`${changes[0]!.resourceType}:${changes[0]!.payload.id}:99`]);
  expect(await authority.changes(admin)).toHaveLength(2);
  await authority.acknowledge(
    admin,
    changes.map(
      (change) => `${change.resourceType}:${change.payload.id}:${change.payload.revision}`,
    ),
  );
  expect(await authority.changes(admin)).toEqual([]);
});
it('rejects malformed scopes and merges stale HTTP/duplicate events without resurrection', async () => {
  const item = await create();
  const previous = await authority.detail(reader, incident);
  const next = { ...item, revision: 2, title: 'Updated' };
  const merged = mergePostmortemDetail(previous, { postmortem: null, items: [next] });
  expect(mergePostmortemDetail(merged, previous)).toEqual(merged);
  expect(
    postmortemDetailSchema.safeParse({
      ...previous,
      items: [{ ...item, postmortemId: crypto.randomUUID() } as ActionItem],
    }).success,
  ).toBe(false);
});
