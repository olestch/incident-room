import { beforeEach, expect, it } from 'vitest';
import type { WorkspaceUser } from '@/entities/current-user/model';
import {
  compareIncidents,
  matchesIncident,
  parseIncidentFilters,
} from '@/entities/incident/filters';
import { incidentPageSchema, type CreateIncidentInput } from '@/entities/incident/model';
import { MemoryIncidentStore, MockIncidentAuthority, seedIncidents } from './authority';

const river: WorkspaceUser = {
  id: 'demo-river',
  workspaceId: 'demo-orbit',
  role: 'admin',
  status: 'active',
  name: 'River Vale',
  email: 'river.vale@example.test',
};
const sage: WorkspaceUser = {
  ...river,
  id: 'demo-sage',
  role: 'member',
  name: 'Sage Linden',
  email: 'sage.linden@example.test',
};
const users = [river, sage];
const input: CreateIncidentInput = {
  title: '  Fictional incident  ',
  description: '',
  severity: 'P1',
  serviceIds: ['aurora-edge'],
  participantIds: ['demo-river', 'demo-sage'],
};
let authority: MockIncidentAuthority;
beforeEach(() => {
  authority = new MockIncidentAuthority(new MemoryIncidentStore(), () =>
    Date.parse('2026-10-05T12:00:00.000Z'),
  );
});
it('has deterministic bounded data with all statuses and severities and valid references', async () => {
  expect(seedIncidents()).toEqual(seedIncidents());
  const first = await authority.list(river, new URLSearchParams(), users);
  expect(incidentPageSchema.parse(first)).toEqual(first);
  expect(first.items).toHaveLength(12);
  expect(first.total).toBe(32);
  expect(new Set(seedIncidents().incidents.map((i) => i.status)).size).toBe(5);
  expect(new Set(seedIncidents().incidents.map((i) => i.severity)).size).toBe(4);
  expect(
    seedIncidents().incidents.every((i) =>
      i.participantIds.every((id) => users.some((u) => u.id === id)),
    ),
  ).toBe(true);
});
it.each(['updated', 'newest', 'severity'])(
  'sorts %s across stable cursor pages without duplication or gaps',
  async (sort) => {
    const params = new URLSearchParams({ sort });
    const all = [];
    for (;;) {
      const page = await authority.list(river, params, users);
      all.push(...page.items);
      if (!page.nextCursor) break;
      params.set('cursor', page.nextCursor);
    }
    expect(all).toHaveLength(32);
    expect(new Set(all.map((i) => i.number)).size).toBe(32);
    expect(all).toEqual(
      seedIncidents().incidents.sort(compareIncidents(sort as 'updated' | 'newest' | 'severity')),
    );
    params.set('severity', 'P1');
    await expect(authority.list(river, params, users)).rejects.toMatchObject({
      category: 'validation',
    });
  },
);
it.each([
  'status=investigating&severity=P1,P2',
  'assignedToMe=true',
  'participant=demo-sage',
  'from=2026-09-10&to=2026-09-15',
])('filters %s on authoritative data', async (query) => {
  const params = new URLSearchParams(query);
  const filters = parseIncidentFilters(
    params,
    users.map((u) => u.id),
  );
  const page = await authority.list(sage, params, users);
  expect(page.total).toBe(
    seedIncidents().incidents.filter((i) => matchesIncident(i, filters, sage.id)).length,
  );
  expect(page.items.every((i) => matchesIncident(i, filters, sage.id))).toBe(true);
});
it('reads by number and distinguishes missing and forbidden without leaking data', async () => {
  expect((await authority.detail(river, 'INC-2841')).number).toBe('INC-2841');
  await expect(authority.detail(river, 'INC-9999')).rejects.toMatchObject({
    category: 'not-found',
  });
  await expect(
    authority.detail({ ...river, workspaceId: 'other' }, 'INC-2841'),
  ).rejects.toMatchObject({ category: 'authorization' });
  expect(
    (await authority.list({ ...river, workspaceId: 'other' }, new URLSearchParams(), [])).items,
  ).toEqual([]);
});
it('allows member creation, normalizes title, assigns creator once and persists idempotent receipts', async () => {
  const key = crypto.randomUUID();
  const created = await authority.create(sage, input, users, key);
  expect(created).toMatchObject({
    number: 'INC-2873',
    title: 'Fictional incident',
    commanderId: sage.id,
    status: 'triggered',
    resolvedAt: null,
    createdAt: '2026-10-05T12:00:00.000Z',
    updatedAt: '2026-10-05T12:00:00.000Z',
  });
  expect(created.participantIds).toEqual(['demo-sage', 'demo-river']);
  expect(await authority.create(sage, input, users, key)).toEqual(created);
  expect(await authority.detail(sage, created.number)).toEqual(created);
  expect((await authority.list(sage, new URLSearchParams(), users)).total).toBe(33);
  await expect(
    authority.create(sage, { ...input, title: 'Changed' }, users, key),
  ).rejects.toMatchObject({ category: 'conflict' });
});
it('allocates unique authority numbers for concurrent confirmations', async () => {
  const values = await Promise.all(
    Array.from({ length: 8 }, () => authority.create(sage, input, users, crypto.randomUUID())),
  );
  expect(new Set(values.map((i) => i.number)).size).toBe(8);
  expect(values.map((i) => i.number)).toEqual(
    Array.from({ length: 8 }, (_, i) => `INC-${2873 + i}`),
  );
});
it.each([
  { ...input, title: ' ' },
  { ...input, title: 'x'.repeat(161) },
  { ...input, description: 'x'.repeat(4001) },
  { ...input, severity: 'P8' },
  { ...input, serviceIds: ['invalid'] },
  { ...input, participantIds: ['missing'] },
])('rejects invalid fields/references without creating records', async (invalid) => {
  await expect(authority.create(sage, invalid, users, crypto.randomUUID())).rejects.toBeDefined();
  expect((await authority.list(sage, new URLSearchParams(), users)).total).toBe(32);
});
it('rejects inactive/cross-workspace participants, inactive actors and missing creator', async () => {
  await expect(
    authority.create(sage, input, [{ ...river, status: 'deactivated' }, sage], crypto.randomUUID()),
  ).rejects.toMatchObject({ category: 'validation' });
  await expect(
    authority.create(sage, input, [{ ...river, workspaceId: 'other' }, sage], crypto.randomUUID()),
  ).rejects.toMatchObject({ category: 'validation' });
  await expect(
    authority.create({ ...sage, status: 'deactivated' }, input, users, crypto.randomUUID()),
  ).rejects.toMatchObject({ category: 'authorization' });
  await expect(authority.create(sage, input, [river], crypto.randomUUID())).rejects.toMatchObject({
    category: 'validation',
  });
  await expect(
    authority.list({ ...river, status: 'deactivated' }, new URLSearchParams(), users),
  ).rejects.toMatchObject({ category: 'authorization' });
});
