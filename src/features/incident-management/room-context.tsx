'use client';
import { useEffect, useState, type ReactNode } from 'react';
import type { WorkspaceUser } from '@/entities/current-user/model';
import { services, type Incident } from '@/entities/incident/model';
import { SeverityBadge, LifecycleBadge } from '@/entities/incident/badges';
import { Avatar, Button } from '@/shared/ui/primitives';
import { Drawer } from '@/shared/ui/drawer';
import { Info } from 'lucide-react';
import { IncidentTime } from './views';

type RoomProps = { incident: Incident; users: WorkspaceUser[] };
export function IncidentCommandStrip({
  incident,
  headingId = 'incident-heading',
}: RoomProps & { headingId?: string }) {
  return (
    <header className="incident-command-strip">
      <div className="room-identity">
        <span className="room-number">{incident.number}</span>
        <SeverityBadge severity={incident.severity} />
        <LifecycleBadge status={incident.status} />
      </div>
      <h1 id={headingId} tabIndex={-1}>
        <span className="sr-only">{incident.number} · </span>
        {incident.title}
      </h1>
    </header>
  );
}

export function IncidentDetails({
  incident,
  users,
  children,
  threadOpen = false,
}: RoomProps & { children?: ReactNode; threadOpen?: boolean }) {
  const [mobile, setMobile] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 64rem)');
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      const active = document.activeElement;
      const movingFocus =
        active instanceof HTMLElement &&
        (active.closest('.room-context-rail') || active.closest('.room-context-mobile'));
      if (movingFocus)
        frame = requestAnimationFrame(() => {
          const destination = media.matches
            ? document.getElementById('incident-heading')
            : document.querySelector<HTMLElement>('.room-context-trigger');
          destination?.focus({ preventScroll: true });
        });
      setMobile(!media.matches);
      setExpanded(media.matches);
      setSheetOpen(false);
    };
    sync();
    media.addEventListener('change', sync);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener('change', sync);
    };
  }, []);
  // A URL-owned Thread clears the local sheet before its modal presentation commits.
  if (threadOpen && sheetOpen) setSheetOpen(false);
  const content = <IncidentContextContent incident={incident} users={users} />;
  if (mobile)
    return (
      <div className="room-context-mobile">
        <Button
          className="room-context-trigger"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          disabled={threadOpen}
          onClick={() => setSheetOpen(true)}
        >
          <Info size={16} aria-hidden="true" /> Incident context
        </Button>
        <Drawer
          side="bottom"
          title="Incident context"
          open={sheetOpen && !threadOpen}
          immediateClose={threadOpen}
          close={() => setSheetOpen(false)}
        >
          <div className="room-context-rail">
            <IncidentCommandStrip
              incident={incident}
              users={users}
              headingId="context-incident-heading"
            />
            {content}
            {children}
          </div>
        </Drawer>
      </div>
    );
  return (
    <aside className="room-context-rail" aria-label="Incident context">
      <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>Incident context</summary>
        {content}
      </details>
      {children}
    </aside>
  );
}

function IncidentContextContent({ incident, users }: RoomProps) {
  const name = (id: string) =>
    users.find((user) => user.id === id)?.name ?? 'Unavailable workspace user';
  return (
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
        <dt>Updated</dt>
        <dd>
          <IncidentTime value={incident.updatedAt} />
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
  );
}
