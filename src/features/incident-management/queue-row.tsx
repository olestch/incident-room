import Link from 'next/link';
import { Boxes, UserRound, Users } from 'lucide-react';
import type { WorkspaceUser } from '@/entities/current-user/model';
import { services, type Incident } from '@/entities/incident/model';
import { LifecycleBadge, SeverityBadge } from './badges';

export function IncidentQueueRow({
  incident,
  users,
}: {
  incident: Incident;
  users: WorkspaceUser[];
}) {
  const name = (id: string) =>
    users.find((user) => user.id === id)?.name ?? 'Unavailable workspace user';
  const updated = new Date(incident.updatedAt);
  const fullTime = `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(updated)} UTC`;
  return (
    <li className="queue-row">
      <div className="queue-severity">
        <SeverityBadge severity={incident.severity} />
      </div>
      <h2 className="queue-title">
        <Link href={`/app/incidents/${incident.number}`} className="queue-link">
          <span className="queue-number">{incident.number}</span>
          <span className="sr-only"> · </span>
          <span>{incident.title}</span>
        </Link>
      </h2>
      <div className="queue-lifecycle">
        <LifecycleBadge status={incident.status} />
      </div>
      <div className="queue-metadata">
        <span className="queue-services">
          <Boxes size={15} aria-hidden="true" />
          <span>
            <span className="sr-only">Services: </span>
            {incident.serviceIds
              .map((id) => services.find((service) => service.id === id)?.label)
              .join(', ') || 'No services selected'}
          </span>
        </span>
        <span>
          <UserRound size={15} aria-hidden="true" />
          <span>
            <span className="sr-only">Commander: </span>
            {name(incident.commanderId)}
          </span>
        </span>
        <span>
          <Users size={15} aria-hidden="true" />
          <span aria-hidden="true">
            {incident.participantIds.length}{' '}
            {incident.participantIds.length === 1 ? 'participant' : 'participants'}
          </span>
          <span className="sr-only">
            Participants ({incident.participantIds.length}):{' '}
            {incident.participantIds.map(name).join(', ')}
          </span>
        </span>
      </div>
      <p className="queue-recency">
        Updated{' '}
        <time dateTime={incident.updatedAt} title={fullTime} aria-label={fullTime}>
          {new Intl.DateTimeFormat('en-GB', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'UTC',
          }).format(updated)}{' '}
          UTC
        </time>
      </p>
    </li>
  );
}

export function IncidentQueueSkeleton() {
  return (
    <div role="status" className="queue-loading">
      <span className="sr-only">Loading incidents…</span>
      <div aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="queue-skeleton" key={index}>
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}
