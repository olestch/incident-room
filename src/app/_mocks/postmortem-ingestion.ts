import type { MockPostmortemAuthority } from '@/features/postmortem/authority';
import type { IncidentActor } from '@/entities/incident/policy';
import type { EventJournal } from '@/features/realtime/journal';
import type { composeNotificationIngestion } from './notification-ingestion';
export function composePostmortemIngestion(
  authority: MockPostmortemAuthority,
  journal: EventJournal,
  notifications: ReturnType<typeof composeNotificationIngestion>,
) {
  return async (actor: IncidentActor) => {
    const changes = await authority.changes(actor);
    // Idle polling must not validate/rewrite unrelated journal and notification buckets.
    if (!changes.length) return;
    for (const change of changes) {
      const base = {
        source: `${change.resourceType}:${change.payload.id}:${change.payload.revision}`,
        actorId: change.actorId,
        workspaceId: actor.workspaceId,
        occurredAt: change.payload.updatedAt,
        target: { type: 'postmortem' as const, number: change.number },
      };
      if (change.resourceType === 'postmortem' && change.initiated)
        await notifications.produce({
          ...base,
          type: 'postmortem_initiated',
          context: `${change.number}: Postmortem initiated`,
          recipients: change.recipients,
        });
      if (change.resourceType === 'action_item' && change.assigned && change.payload.assigneeUserId)
        await notifications.produce({
          ...base,
          type: 'action_item_assigned',
          context: `${change.number}: Action Item assigned to you`,
          recipients: [change.payload.assigneeUserId],
        });
    }
    await notifications.publish(actor);
    await journal.append(
      actor.workspaceId,
      changes.map((change) => ({
        resourceType: change.resourceType,
        kind:
          change.resourceType === 'postmortem'
            ? ('postmortem_updated' as const)
            : ('action_item_updated' as const),
        eventId: `${change.resourceType}:${change.payload.id}:${change.payload.revision}`,
        resourceId: change.payload.id,
        incidentId: change.payload.incidentId,
        workspaceId: actor.workspaceId,
        revision: change.payload.revision,
        occurredAt: change.payload.updatedAt,
        payload: change.payload,
      })),
    );
    await authority.acknowledge(
      actor,
      changes.map(
        (change) => `${change.resourceType}:${change.payload.id}:${change.payload.revision}`,
      ),
    );
  };
}
