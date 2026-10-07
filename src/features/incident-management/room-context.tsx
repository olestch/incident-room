'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Users, Layers, Crown, Clock } from 'lucide-react';
import type { WorkspaceUser } from '@/entities/current-user/model';
import { services, type Incident } from '@/entities/incident/model';
import { SeverityBadge, LifecycleBadge } from '@/entities/incident/badges';
import { Avatar } from '@/shared/ui/primitives';
import { IncidentTime } from './views';

type RoomProps = { incident: Incident; users: WorkspaceUser[] };
export function IncidentCommandStrip({ incident, users }: RoomProps) {
  const commander =
    users.find((user) => user.id === incident.commanderId)?.name ?? 'Workspace member';
  return (
    <header className="incident-command-strip">
      <div className="room-identity">
        <span className="room-number">{incident.number}</span>
        <SeverityBadge severity={incident.severity} />
        <LifecycleBadge status={incident.status} />
      </div>
      <h1 id="incident-heading" tabIndex={-1}>
        <span className="sr-only">{incident.number} · </span>
        {incident.title}
      </h1>
      <div className="room-command-metadata">
        <span>
          <Layers size={15} aria-hidden="true" />
          {incident.serviceIds
            .map((id) => services.find((s) => s.id === id)?.label ?? id)
            .join(', ') || 'No services selected'}
        </span>
        <span>
          <Crown size={15} aria-hidden="true" />
          Commander: {commander}
        </span>
        <span>
          <Users size={15} aria-hidden="true" />
          {incident.participantIds.length} participants
        </span>
        <span>
          <Clock size={15} aria-hidden="true" />
          Updated <IncidentTime value={incident.updatedAt} />
        </span>
      </div>
    </header>
  );
}

export function IncidentDetails({
  incident,
  users,
  threadOpen,
  children,
}: RoomProps & { threadOpen: boolean; children?: ReactNode }) {
  const name = (id: string) =>
    users.find((user) => user.id === id)?.name ?? 'Unavailable workspace user';
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 64rem)');
    const sync = () => setExpanded(media.matches && !threadOpen);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [threadOpen]);
  return (
    <aside className="room-context-rail" aria-label="Incident context">
      <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>Incident context</summary>
        <div className="room-context-content">
          <p className="room-description">{incident.description || 'No description provided.'}</p>
          <dl>
            <dt>Commander</dt>
            <dd className="room-person">
              <Avatar name={name(incident.commanderId)} />
              {name(incident.commanderId)}
            </dd>
            <dt>Affected services</dt>
            <dd className="room-services">
              {incident.serviceIds.map((id) => (
                <span key={id}>{services.find((s) => s.id === id)?.label ?? id}</span>
              ))}
            </dd>
            <dt>Participants · {incident.participantIds.length}</dt>
            <dd>
              <ul className="room-people">
                {incident.participantIds.map((id) => (
                  <li key={id}>
                    <Avatar name={name(id)} />
                    {name(id)}
                  </li>
                ))}
              </ul>
            </dd>
            <dt>Created</dt>
            <dd>
              <IncidentTime value={incident.createdAt} />
            </dd>
            {incident.resolvedAt && (
              <>
                <dt>Resolved</dt>
                <dd>
                  <IncidentTime value={incident.resolvedAt} /> · Operational writes are closed.
                </dd>
              </>
            )}
          </dl>
        </div>
      </details>
      {children}
    </aside>
  );
}
