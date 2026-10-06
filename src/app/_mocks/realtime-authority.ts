import type { IncidentActor } from '@/entities/incident/policy';
import type { Incident } from '@/entities/incident/model';
import type { MockIncidentAuthority } from '@/features/incident-management/authority';
import type { MockTimelineAuthority } from '@/features/timeline/authority';
import type { MockThreadAuthority } from '@/features/threads/authority';
import type { EventJournal } from '@/features/realtime/journal';
import { realtimeHandlers, workspaceRealtimeHandlers } from '@/features/realtime/handlers';
import type { composeNotificationIngestion } from './notification-ingestion';
type NotificationIngestion = ReturnType<typeof composeNotificationIngestion>;

/** Source changes are acknowledged only after derived notifications and journal commit. */
export async function ingestRoomChanges(
  journal: EventJournal,
  _incidents: MockIncidentAuthority,
  timeline: MockTimelineAuthority,
  threads: MockThreadAuthority,
  actor: IncidentActor,
  incident: Incident,
  notifications?: NotificationIngestion,
) {
  const [entries, discussion] = await Promise.all([
    timeline.changes(actor, incident),
    threads.changes(actor, incident),
  ]);
  if (notifications) {
    for (const change of entries)
      if (change.kind === 'timeline_created') await notifications.timeline(incident, change.entry);
    for (const change of discussion)
      if (change.resourceType === 'thread_message' && change.kind === 'thread_message_created')
        await notifications.thread(incident, change.payload);
    await notifications.publish(actor);
  }
  await journal.append(actor.workspaceId, [
    ...discussion.map((change) => ({
      ...change,
      eventId: `${change.resourceType}:${change.payload.id}:${change.payload.revision}`,
      workspaceId: incident.workspaceId,
      resourceId: change.payload.id,
      incidentId: incident.id,
      revision: change.payload.revision,
      occurredAt:
        change.resourceType === 'thread' ? change.payload.lastActivityAt : change.payload.createdAt,
    })),
    ...entries.map(({ kind, entry: payload }) => ({
      eventId: `timeline:${payload.id}:${payload.revision}`,
      workspaceId: incident.workspaceId,
      resourceType: 'timeline' as const,
      resourceId: payload.id,
      incidentId: payload.incidentId,
      revision: payload.revision,
      occurredAt: payload.createdAt,
      kind,
      payload,
    })),
  ]);
  await Promise.all([
    timeline.acknowledgeChanges(
      actor,
      incident,
      entries.map((change) => `${change.entry.id}:${change.entry.revision}`),
    ),
    threads.acknowledgeChanges(
      actor,
      incident,
      discussion.map(
        (change) => `${change.resourceType}:${change.payload.id}:${change.payload.revision}`,
      ),
    ),
  ]);
}
export function composeRealtimeAuthority(
  journal: EventJournal,
  incidents: MockIncidentAuthority,
  timeline: MockTimelineAuthority,
  authenticate: (client: string) => Promise<IncidentActor>,
  threads: MockThreadAuthority,
  notifications?: NotificationIngestion,
  ingestPostmortems?: (actor: IncidentActor) => Promise<void>,
) {
  const ingestMetadata = async (actor: IncidentActor) => {
    const metadata = await incidents.changes(actor);
    if (notifications) {
      for (const change of metadata) {
        const record = change.incident;
        const actorId =
          change.actorId ?? (change.kind === 'incident_created' ? record.commanderId : null);
        if (!actorId) continue; // Never attribute an old legacy change to its polling viewer.
        const base = {
          source: `incident:${record.id}:${record.revision}`,
          workspaceId: record.workspaceId,
          actorId,
          occurredAt: record.updatedAt,
          target: { type: 'incident' as const, number: record.number },
        };
        if (change.kind === 'incident_created' || change.addedParticipantIds?.length)
          await notifications.produce({
            ...base,
            type: 'assigned',
            context: `${record.number}: added you as a participant`,
            recipients: change.addedParticipantIds ?? record.participantIds,
          });
        if (change.kind === 'severity_changed')
          await notifications.produce({
            ...base,
            type: 'severity_changed',
            context: `${record.number}: severity changed to ${record.severity}`,
            recipients: record.participantIds,
          });
        if (change.kind === 'status_changed')
          await notifications.produce({
            ...base,
            type: 'status_changed',
            context: `${record.number}: status changed to ${record.status}`,
            recipients: record.participantIds,
          });
      }
      await notifications.publish(actor);
    }
    await journal.append(
      actor.workspaceId,
      metadata.map(({ kind, incident: payload }) => ({
        eventId: `incident:${payload.id}:${payload.revision}`,
        workspaceId: payload.workspaceId,
        resourceType: 'incident' as const,
        resourceId: payload.id,
        revision: payload.revision,
        occurredAt: payload.updatedAt,
        kind,
        payload,
      })),
    );
    await incidents.acknowledgeChanges(
      actor,
      metadata.map((change) => `${change.incident.id}:${change.incident.revision}`),
    );
  };
  return [
    ...workspaceRealtimeHandlers(journal, authenticate, async (actor) => {
      await ingestMetadata(actor);
      await ingestPostmortems?.(actor);
    }),
    ...realtimeHandlers(
      journal,
      authenticate,
      (actor, number) => incidents.detail(actor, number),
      async (actor, incident) => {
        await ingestMetadata(actor);
        await ingestPostmortems?.(actor);
        await ingestRoomChanges(
          journal,
          incidents,
          timeline,
          threads,
          actor,
          incident,
          notifications,
        );
      },
      async (actor, incident, ids, threadRoot, messageIds) => ({
        incident: await incidents.detail(actor, incident.number),
        windows: [
          await timeline.window(actor, incident, null),
          ...(ids.length ? [await timeline.snapshot(actor, incident, ids)] : []),
        ],
        threads: threadRoot
          ? [await threads.snapshot(actor, incident, threadRoot, messageIds)]
          : [],
      }),
    ),
  ];
}
