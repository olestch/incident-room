import type { Incident } from './model';

export interface IncidentActor {
  id: string;
  workspaceId: string;
  role: 'admin' | 'member';
  status: 'active' | 'deactivated';
}
export const canCreateIncident = (actor: IncidentActor | null, workspaceId: string) =>
  actor?.status === 'active' && actor.workspaceId === workspaceId;
export const canViewIncident = (actor: IncidentActor | null, incident: Incident) =>
  canCreateIncident(actor, incident.workspaceId);
const coordinates = (actor: IncidentActor | null, incident: Incident) =>
  canViewIncident(actor, incident) &&
  (actor?.role === 'admin' || actor?.id === incident.commanderId);
const participates = (actor: IncidentActor | null, incident: Incident) =>
  coordinates(actor, incident) ||
  (actor !== null &&
    canViewIncident(actor, incident) &&
    incident.participantIds.includes(actor.id));
export const canWriteIncident = (actor: IncidentActor | null, incident: Incident) =>
  incident.status !== 'resolved' && participates(actor, incident);
export const canChangeSeverity = (actor: IncidentActor | null, incident: Incident) =>
  incident.status !== 'resolved' && coordinates(actor, incident);
export const canChangeStatus = canChangeSeverity;
export const canManageParticipants = canChangeSeverity;
export const canTransferCommand = canChangeSeverity;
export const canMarkImportant = canChangeSeverity;
export const canInitiatePostmortem = (
  actor: IncidentActor | null,
  incident: Incident,
  initiated = false,
) => !initiated && incident.status === 'resolved' && coordinates(actor, incident);
export const canEditPostmortem = (
  actor: IncidentActor | null,
  incident: Incident,
  initiated: boolean,
) => initiated && incident.status === 'resolved' && participates(actor, incident);
