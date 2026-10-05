import { timelineEntrySchema, type TimelineEntry } from '@/entities/timeline/model';

/** Independently authored fictional seed. Generate only when a room is requested. */
export function generateTimeline(incidentId: string, count: number): TimelineEntry[] {
  if (!Number.isInteger(count) || count < 0 || count > 50_000)
    throw new Error('Invalid fixture size');
  return Array.from({ length: count }, (_, index) => {
    const common = {
      id: `${incidentId}:evt-${index + 1}`,
      incidentId,
      occurredAt: new Date(Date.UTC(2026, 8, 1, 9) + Math.floor(index / 3) * 60_000).toISOString(),
      createdAt: new Date(Date.UTC(2026, 8, 1, 9) + index * 20_000).toISOString(),
      serverTieOrder: index + 1,
      revision: 1,
      important: index % 19 === 0,
      tombstone: null,
    };
    const summary = `Fictional response update ${index + 1}. ${'The team is assessing the Aurora edge and Cedar queue. '.repeat(1 + (index % 5))}`;
    const variants = [
      {
        type: 'human_message',
        authorId: index % 2 ? 'demo-sage' : 'demo-river',
        body: summary + (index % 11 === 0 ? '\nDetails: https://status.example.test/check' : ''),
      },
      { type: 'monitoring_event', source: 'Lumen monitor', summary },
      { type: 'deployment_event', service: 'Aurora edge', version: `v0.${index}.0`, summary },
      { type: 'status_change', actorId: 'demo-river', from: 'triggered', to: 'investigating' },
      { type: 'severity_change', actorId: 'demo-river', from: 'P2', to: 'P1' },
      {
        type: 'participant_event',
        actorId: 'demo-river',
        participantId: 'demo-sage',
        action: 'joined',
      },
      { type: 'system_event', summary },
    ];
    const entry = timelineEntrySchema.parse({ ...common, ...variants[index % 7] });
    if (index === 19) {
      entry.revision = 2;
      entry.tombstone = { deletedAt: common.createdAt, reason: 'Fictional source withdrawn' };
      if (entry.type === 'human_message') entry.body = '';
      if ('summary' in entry) entry.summary = '';
    }
    return entry;
  });
}
