import type { IncidentActor } from '@/entities/incident/policy';
import type { MockIncidentAuthority } from '@/features/incident-management/authority';
import type { MockTimelineAuthority } from '@/features/timeline/authority';
import type { MockThreadAuthority } from '@/features/threads/authority';
import type { EventJournal } from '@/features/realtime/journal';
import { realtimeHandlers, workspaceRealtimeHandlers } from '@/features/realtime/handlers';

export function composeRealtimeAuthority(
  journal: EventJournal,
  incidents: MockIncidentAuthority,
  timeline: MockTimelineAuthority,
  authenticate: (client: string) => Promise<IncidentActor>,
  threads: MockThreadAuthority,
) {
  const metadataChanges = (metadata: Awaited<ReturnType<MockIncidentAuthority['changes']>>) =>
    metadata.map(({ kind, incident: payload }) => ({
      eventId: `incident:${payload.id}:${payload.revision}`,
      workspaceId: payload.workspaceId,
      resourceType: 'incident' as const,
      resourceId: payload.id,
      revision: payload.revision,
      occurredAt: payload.updatedAt,
      kind,
      payload,
    }));
  return [
    ...workspaceRealtimeHandlers(journal, authenticate, async (actor) => {
      const metadata = await incidents.changes(actor);
      await journal.append(actor.workspaceId, metadataChanges(metadata));
      await incidents.acknowledgeChanges(
        actor,
        metadata.map((change) => `${change.incident.id}:${change.incident.revision}`),
      );
    }),
    ...realtimeHandlers(
      journal,
      authenticate,
      (actor, number) => incidents.detail(actor, number),
      async (actor, incident) => {
        const [metadata, entries, discussion] = await Promise.all([
          incidents.changes(actor),
          timeline.changes(actor, incident),
          threads.changes(actor, incident),
        ]);
        await journal.append(actor.workspaceId, [
          ...metadataChanges(metadata),
          ...discussion.map((change) => ({
            ...change,
            eventId: `${change.resourceType}:${change.payload.id}:${change.payload.revision}`,
            workspaceId: incident.workspaceId,
            resourceId: change.payload.id,
            incidentId: incident.id,
            revision: change.payload.revision,
            occurredAt:
              change.resourceType === 'thread'
                ? change.payload.lastActivityAt
                : change.payload.createdAt,
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
        // Remove only records durably ingested, leaving any concurrent newer mutations queued.
        await Promise.all([
          threads.acknowledgeChanges(
            actor,
            incident,
            discussion.map(
              (change) => `${change.resourceType}:${change.payload.id}:${change.payload.revision}`,
            ),
          ),
          incidents.acknowledgeChanges(
            actor,
            metadata.map((change) => `${change.incident.id}:${change.incident.revision}`),
          ),
          timeline.acknowledgeChanges(
            actor,
            incident,
            entries.map((change) => `${change.entry.id}:${change.entry.revision}`),
          ),
        ]);
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
