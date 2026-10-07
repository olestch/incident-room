'use client';
import type { ReactNode } from 'react';
import type { WorkspaceUser } from '@/entities/current-user/model';
import type { TimelineEntry } from '@/entities/timeline/model';
import { SafeText } from '@/shared/ui/safe-text';
export function EntryContent({ entry, users }: { entry: TimelineEntry; users: WorkspaceUser[] }) {
  const name = (id: string) => users.find((user) => user.id === id)?.name ?? 'Workspace member';
  if (entry.tombstone)
    return (
      <>
        <strong>Deleted entry</strong>
        <p>Source no longer available. {entry.tombstone.reason}</p>
      </>
    );
  let content: ReactNode;
  switch (entry.type) {
    case 'human_message':
      content = (
        <>
          <strong>{name(entry.authorId)}</strong>
          <p className="whitespace-pre-wrap">
            <SafeText text={entry.body} />
          </p>
        </>
      );
      break;
    case 'monitoring_event':
      content = (
        <>
          <strong>Monitoring · {entry.source}</strong>
          <p>{entry.summary}</p>
        </>
      );
      break;
    case 'deployment_event':
      content = (
        <>
          <strong>
            Deployment · {entry.service} · {entry.version}
          </strong>
          <p>{entry.summary}</p>
        </>
      );
      break;
    case 'status_change':
      content = (
        <p>
          {name(entry.actorId)} changed status: {entry.from} → {entry.to}
        </p>
      );
      break;
    case 'severity_change':
      content = (
        <p>
          {name(entry.actorId)} changed severity: {entry.from} → {entry.to}
        </p>
      );
      break;
    case 'participant_event':
      content = (
        <p>
          Participant · {name(entry.participantId)} · {entry.action.replaceAll('_', ' ')}
        </p>
      );
      break;
    case 'system_event':
      content = (
        <>
          <strong>System event</strong>
          <p>{entry.summary}</p>
        </>
      );
      break;
  }
  return (
    <>
      {entry.important && <p className="text-sm">Important entry</p>}
      {content}
      <time className="text-xs text-muted" dateTime={entry.occurredAt}>
        {new Date(entry.occurredAt).toLocaleString()}
      </time>
    </>
  );
}
