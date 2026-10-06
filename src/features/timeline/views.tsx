'use client';
import { forwardRef, type ReactNode } from 'react';
import type { WorkspaceUser } from '@/entities/current-user/model';
import type { TimelineEntry } from '@/entities/timeline/model';
import type { OutboxRecord } from './local-work';
import type { TimelineRow } from './projection';
import type { TimelineViewport } from './target-navigation';
import { MeasuredStream } from '@/shared/ui/measured-stream';
import { SafeText } from '@/shared/ui/safe-text';
export { SafeText } from '@/shared/ui/safe-text';
export { StreamCompose as TimelineCompose } from '@/shared/ui/stream-compose';
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
export function LocalEntry({
  record,
  retry,
  check,
  remove,
  writable,
}: {
  record: OutboxRecord;
  retry(id: string): void;
  check(id: string): void;
  remove(id: string): void;
  writable: boolean;
}) {
  return (
    <>
      <strong>
        Your message ·{' '}
        {record.state === 'unknown'
          ? 'Checking delivery'
          : record.state === 'sending'
            ? 'Sending'
            : 'Failed'}
      </strong>
      <p className="whitespace-pre-wrap">
        <SafeText text={record.body} />
      </p>
      {record.issue && <p>{record.issue}</p>}
      {record.state === 'failed' && (
        <div className="flex gap-2">
          <button
            className="incident-button"
            disabled={!writable || !record.retryAllowed}
            onClick={() => retry(record.clientMutationId)}
          >
            Retry message
          </button>
          <button className="incident-button" onClick={() => remove(record.clientMutationId)}>
            Delete local message
          </button>
        </div>
      )}
      {record.state === 'unknown' && (
        <button className="incident-button" onClick={() => check(record.clientMutationId)}>
          Check delivery
        </button>
      )}
    </>
  );
}

export const TimelineList = forwardRef<
  TimelineViewport,
  {
    rows: TimelineRow[];
    users: WorkspaceUser[];
    highlight: string | null;
    targetActive: boolean;
    targetId?: string | null | undefined;
    retry(id: string): void;
    check(id: string): void;
    remove(id: string): void;
    loadGap(cursor: string): void;
    writable: boolean;
    renderThread?(entry: TimelineEntry): ReactNode;
    newEntryIds?: string[];
    goLatest?(): void;
  }
>(function TimelineList(props, ref) {
  return (
    <MeasuredStream
      ref={ref}
      rows={props.rows}
      label="Timeline"
      highlight={props.highlight}
      targetActive={props.targetActive}
      targetId={props.targetId}
      newEntryIds={props.newEntryIds}
      goLatest={props.goLatest}
      renderRow={(index) => {
        const row = props.rows[index]!;
        return row.entry ? (
          <>
            <EntryContent entry={row.entry} users={props.users} />
            {props.renderThread?.(row.entry)}
          </>
        ) : row.local ? (
          <LocalEntry
            record={row.local}
            retry={props.retry}
            check={props.check}
            remove={props.remove}
            writable={props.writable}
          />
        ) : 'gap' in row ? (
          <div>
            <p>Unloaded Timeline history between windows</p>
            <button className="incident-button" onClick={() => props.loadGap(row.gap.cursor)}>
              Load this history gap
            </button>
          </div>
        ) : null;
      }}
    />
  );
});
