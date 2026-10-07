import type { TimelineEntry } from '@/entities/timeline/model';
import type { WorkspaceUser } from '@/entities/current-user/model';
const labels: Record<TimelineEntry['type'], string> = {
  human_message: 'Message',
  monitoring_event: 'Monitoring',
  deployment_event: 'Deployment',
  status_change: 'Status change',
  severity_change: 'Severity change',
  participant_event: 'Participant change',
  system_event: 'System event',
};
export function TimelineEvidence({
  entry,
  users,
}: {
  entry: TimelineEntry;
  users: WorkspaceUser[];
}) {
  const name = (id: string) => users.find((user) => user.id === id)?.name ?? 'Unavailable user';
  const preview = entry.tombstone
    ? `Deleted entry · Source event unavailable. ${entry.tombstone.reason}`
    : entry.type === 'human_message'
      ? `${name(entry.authorId)}: ${entry.body}`
      : 'summary' in entry
        ? entry.summary
        : entry.type === 'status_change' || entry.type === 'severity_change'
          ? `${name(entry.actorId)}: ${entry.from} → ${entry.to}`
          : `${name(entry.participantId)} · ${entry.action.replaceAll('_', ' ')}`;
  return (
    <div className="evidence-content">
      <span className="secondary-meta">
        {labels[entry.type]}
        {entry.important ? ' · Important' : ''}
      </span>
      <p>{preview.length > 240 ? `${preview.slice(0, 237)}…` : preview}</p>
    </div>
  );
}
