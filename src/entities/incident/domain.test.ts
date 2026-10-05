import { describe, expect, it } from 'vitest';
import { canTransition, incidentSchema, severityRank, statuses, type Incident } from './model';
import {
  compareIncidents,
  emptyFilters,
  isAssignedTo,
  matchesIncident,
  parseIncidentFilters,
  serializeIncidentFilters,
} from './filters';
import * as policy from './policy';
import type { IncidentActor } from './policy';

const incident: Incident = {
  id: 'one',
  workspaceId: 'orbit',
  number: 'INC-2841',
  title: 'Fictional outage',
  description: '',
  status: 'investigating',
  severity: 'P2',
  commanderId: 'commander',
  participantIds: ['commander', 'participant'],
  serviceIds: [],
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-03T12:00:00.000Z',
  resolvedAt: null,
};
const actor = (id: string, role: IncidentActor['role'] = 'member'): IncidentActor => ({
  id,
  workspaceId: 'orbit',
  role,
  status: 'active',
});
it('validates the incident shape, commander invariant and resolution timestamp', () => {
  expect(incidentSchema.parse(incident)).toEqual(incident);
  expect(incidentSchema.safeParse({ ...incident, status: 'unknown' }).success).toBe(false);
  expect(incidentSchema.safeParse({ ...incident, participantIds: [] }).success).toBe(false);
  expect(incidentSchema.safeParse({ ...incident, status: 'resolved' }).success).toBe(false);
  expect(incidentSchema.safeParse({ ...incident, serviceIds: ['private-service'] }).success).toBe(
    false,
  );
});
it('models explicit severity order and forward-only terminal status', () => {
  expect(
    ['P4', 'P1', 'P3', 'P2'].sort(
      (a, b) =>
        severityRank[a as keyof typeof severityRank] - severityRank[b as keyof typeof severityRank],
    ),
  ).toEqual(['P1', 'P2', 'P3', 'P4']);
  for (const from of statuses)
    for (const to of statuses)
      expect(canTransition(from, to)).toBe(statuses.indexOf(to) > statuses.indexOf(from));
});
it('uses authoritative dates and deterministic number tie breakers for each sort', () => {
  const oldCritical = {
    ...incident,
    number: 'INC-2842',
    severity: 'P1' as const,
    updatedAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-09-04T00:00:00.000Z',
  };
  expect([oldCritical, incident].sort(compareIncidents('updated'))[0]).toBe(incident);
  expect([incident, oldCritical].sort(compareIncidents('newest'))[0]).toBe(oldCritical);
  expect([incident, oldCritical].sort(compareIncidents('severity'))[0]).toBe(oldCritical);
  expect([{ ...incident, number: 'INC-2843' }, incident].sort(compareIncidents('updated'))[0]).toBe(
    incident,
  );
});
it('preserves valid individual URL values, canonicalizes lists and ignores bad participants/dates', () => {
  const filters = parseIncidentFilters(
    new URLSearchParams(
      'status=investigating,bad&status=resolved&severity=P1,bad,P2,P1&participant=inactive&from=2026-02-30&to=bad&sort=bad',
    ),
    ['participant'],
  );
  expect(filters).toEqual({
    ...emptyFilters,
    status: ['investigating', 'resolved'],
    severity: ['P1', 'P2'],
  });
  const params = serializeIncidentFilters(
    filters,
    new URLSearchParams('tracking=keep&assigned=me&cursor=stale&participant=bad'),
  );
  expect(params.get('tracking')).toBe('keep');
  expect(params.has('participant')).toBe(false);
  expect(params.has('cursor')).toBe(false);
  expect(params.has('assigned')).toBe(false);
  expect(parseIncidentFilters(params, ['participant'])).toEqual(filters);
  expect(parseIncidentFilters(new URLSearchParams('from=2026-09-03&to=2026-09-02'), []).to).toBe(
    '',
  );
  expect(serializeIncidentFilters(emptyFilters).toString()).toBe('');
});
it('uses stable assignment IDs and inclusive UTC created-date range, not updated time', () => {
  expect(isAssignedTo(incident, 'commander')).toBe(true);
  expect(isAssignedTo(incident, 'participant')).toBe(true);
  expect(isAssignedTo(incident, 'someone')).toBe(false);
  expect(
    matchesIncident(incident, { ...emptyFilters, from: '2026-09-02', to: '2026-09-02' }, 'someone'),
  ).toBe(true);
  expect(matchesIncident(incident, { ...emptyFilters, from: '2026-09-03' }, 'someone')).toBe(false);
  expect(matchesIncident(incident, { ...emptyFilters, assignedToMe: true }, 'someone')).toBe(false);
  expect(
    matchesIncident(incident, { ...emptyFilters, participant: 'participant' }, 'someone'),
  ).toBe(true);
  expect(parseIncidentFilters(new URLSearchParams('assigned=me'), []).assignedToMe).toBe(true);
});
describe('central semantic policy matrix', () => {
  it.each([
    ['member', actor('other'), false, false],
    ['participant', actor('participant'), true, false],
    ['commander', actor('commander'), true, true],
    ['admin', actor('other', 'admin'), true, true],
  ])('%s has only its semantic capabilities', (_name, person, write, coordinate) => {
    expect(policy.canViewIncident(person, incident)).toBe(true);
    expect(policy.canCreateIncident(person, 'orbit')).toBe(true);
    expect(policy.canWriteIncident(person, incident)).toBe(write);
    for (const capability of [
      policy.canChangeSeverity,
      policy.canChangeStatus,
      policy.canManageParticipants,
      policy.canTransferCommand,
      policy.canMarkImportant,
    ])
      expect(capability(person, incident)).toBe(coordinate);
    expect(policy.canInitiatePostmortem(person, incident)).toBe(false);
    expect(policy.canEditPostmortem(person, incident, true)).toBe(false);
    const resolved = { ...incident, status: 'resolved' as const, resolvedAt: incident.updatedAt };
    expect(policy.canWriteIncident(person, resolved)).toBe(false);
    for (const capability of [
      policy.canChangeSeverity,
      policy.canChangeStatus,
      policy.canManageParticipants,
      policy.canTransferCommand,
      policy.canMarkImportant,
    ])
      expect(capability(person, resolved)).toBe(false);
    expect(policy.canInitiatePostmortem(person, resolved)).toBe(coordinate);
    expect(policy.canInitiatePostmortem(person, resolved, true)).toBe(false);
    expect(policy.canEditPostmortem(person, resolved, true)).toBe(write);
    expect(policy.canEditPostmortem(person, resolved, false)).toBe(false);
  });
  it.each([
    null,
    { ...actor('commander', 'admin'), status: 'deactivated' as const },
    { ...actor('commander', 'admin'), workspaceId: 'elsewhere' },
  ])('denies anonymous, inactive and cross-workspace actors', (person) => {
    for (const capability of [
      policy.canViewIncident,
      policy.canWriteIncident,
      policy.canChangeSeverity,
      policy.canChangeStatus,
      policy.canManageParticipants,
      policy.canTransferCommand,
      policy.canMarkImportant,
    ])
      expect(capability(person, incident)).toBe(false);
    expect(policy.canCreateIncident(person, 'orbit')).toBe(false);
    expect(
      policy.canInitiatePostmortem(person, {
        ...incident,
        status: 'resolved',
        resolvedAt: incident.updatedAt,
      }),
    ).toBe(false);
  });
});
