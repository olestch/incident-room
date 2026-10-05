import { severityRank, severities, statuses, type Incident } from './model';

export interface IncidentFilters {
  status: Incident['status'][];
  severity: Incident['severity'][];
  assignedToMe: boolean;
  participant: string;
  from: string;
  to: string;
  sort: 'updated' | 'newest' | 'severity';
}
export const emptyFilters: IncidentFilters = {
  status: [],
  severity: [],
  assignedToMe: false,
  participant: '',
  from: '',
  to: '',
  sort: 'updated',
};
function date(value: string | null) {
  return value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
    ? value
    : '';
}
export function parseIncidentFilters(
  params: URLSearchParams,
  activeIds: readonly string[],
): IncidentFilters {
  const values = (key: string) => params.getAll(key).flatMap((value) => value.split(','));
  const from = date(params.get('from'));
  let to = date(params.get('to'));
  if (from && to && to < from) to = '';
  return {
    status: statuses.filter((value) => values('status').includes(value)),
    severity: severities.filter((value) => values('severity').includes(value)),
    assignedToMe: params.get('assignedToMe') === 'true' || params.get('assigned') === 'me',
    participant: activeIds.includes(params.get('participant') ?? '')
      ? params.get('participant')!
      : '',
    from,
    to,
    sort:
      params.get('sort') === 'newest'
        ? 'newest'
        : params.get('sort') === 'severity'
          ? 'severity'
          : 'updated',
  };
}
export function serializeIncidentFilters(
  filters: IncidentFilters,
  original = new URLSearchParams(),
) {
  const params = new URLSearchParams(original);
  for (const key of [
    'status',
    'severity',
    'assignedToMe',
    'assigned',
    'participant',
    'from',
    'to',
    'sort',
    'cursor',
  ])
    params.delete(key);
  if (filters.status.length) params.set('status', filters.status.join(','));
  if (filters.severity.length) params.set('severity', filters.severity.join(','));
  if (filters.assignedToMe) params.set('assignedToMe', 'true');
  for (const key of ['participant', 'from', 'to'] as const)
    if (filters[key]) params.set(key, filters[key]);
  if (filters.sort !== 'updated') params.set('sort', filters.sort);
  return params;
}
export const isAssignedTo = (incident: Incident, id: string) =>
  incident.commanderId === id || incident.participantIds.includes(id);
export function matchesIncident(incident: Incident, filters: IncidentFilters, userId: string) {
  return (
    (!filters.status.length || filters.status.includes(incident.status)) &&
    (!filters.severity.length || filters.severity.includes(incident.severity)) &&
    (!filters.assignedToMe || isAssignedTo(incident, userId)) &&
    (!filters.participant || incident.participantIds.includes(filters.participant)) &&
    (!filters.from || incident.createdAt >= `${filters.from}T00:00:00.000Z`) &&
    (!filters.to || incident.createdAt < new Date(Date.parse(filters.to) + 86400000).toISOString())
  );
}
export function compareIncidents(sort: IncidentFilters['sort']) {
  return (a: Incident, b: Incident) =>
    (sort === 'severity' ? severityRank[a.severity] - severityRank[b.severity] : 0) ||
    (sort === 'newest'
      ? b.createdAt.localeCompare(a.createdAt)
      : b.updatedAt.localeCompare(a.updatedAt)) ||
    a.number.localeCompare(b.number);
}
