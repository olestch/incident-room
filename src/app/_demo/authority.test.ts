import { expect, it } from 'vitest';
import { MockTimelineAuthority, seedTimeline } from '@/features/timeline/authority';
import { MemoryAtomicStore } from '@/shared/persistence/atomic-store';
import {
  seedIncidents,
  MockIncidentAuthority,
  MemoryIncidentStore,
} from '@/features/incident-management/authority';

const actor = {
  id: 'demo-river',
  workspaceId: 'demo-orbit',
  role: 'admin',
  status: 'active',
} as const;
const incident = seedIncidents().incidents[0]!;
it('demo status generation rejects stale CAS and backwards transitions', async () => {
  const incidents = new MockIncidentAuthority(new MemoryIncidentStore());
  await incidents.simulate(actor, incident.number, { status: 'identified' }, incident.revision);
  await expect(
    incidents.simulate(actor, incident.number, { status: 'investigating' }, incident.revision),
  ).rejects.toThrow('changed');
  const current = await incidents.detail(actor, incident.number);
  await expect(
    incidents.simulate(actor, incident.number, { status: 'triggered' }, current.revision),
  ).rejects.toThrow('forward');
  expect((await incidents.detail(actor, incident.number)).status).toBe('identified');
});
it('demo generated persistent events use the same source changes, history and deterministic order', async () => {
  const authority = new MockTimelineAuthority(new MemoryAtomicStore(seedTimeline));
  for (const kind of ['monitoring', 'deployment', 'human'] as const)
    await authority.generate(actor, incident, kind, 'demo-sage');
  const changes = await authority.changes(actor, incident);
  expect(changes.map((c) => c.entry.type)).toEqual([
    'monitoring_event',
    'deployment_event',
    'human_message',
  ]);
  expect(changes.map((c) => c.entry.serverTieOrder)).toEqual([4001, 4002, 4003]);
  expect((await authority.window(actor, incident, null)).items.at(-1)).toEqual(changes[2]!.entry);
  await authority.acknowledgeChanges(
    actor,
    incident,
    changes.map((c) => `${c.entry.id}:${c.entry.revision}`),
  );
  expect(await authority.changes(actor, incident)).toEqual([]);
});
it('dataset replacement uses the existing 50k generator with bounded acquisition windows', async () => {
  const authority = new MockTimelineAuthority(new MemoryAtomicStore(seedTimeline));
  for (const count of [100, 1000, 10000, 50000]) {
    await authority.replaceDataset(actor, incident, count);
    const window = await authority.window(actor, incident, null);
    expect(window.total).toBe(count);
    expect(window.items).toHaveLength(60);
    expect(window.items.at(-1)!.id).toBe(`${incident.id}:evt-${count}`);
  }
});
it('generation respects resolved and foreign workspace boundaries', async () => {
  const authority = new MockTimelineAuthority(new MemoryAtomicStore(seedTimeline));
  expect(() =>
    authority.generate(actor, { ...incident, status: 'resolved' }, 'human', 'demo-sage'),
  ).toThrow();
  expect(() =>
    authority.generate({ ...actor, workspaceId: 'foreign' }, incident, 'monitoring', 'demo-sage'),
  ).toThrow();
});
