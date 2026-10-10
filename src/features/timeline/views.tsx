'use client';
import { forwardRef, type ReactNode } from 'react';
import {
  Activity,
  ArrowRight,
  Circle,
  Flag,
  GitBranch,
  MessageSquare,
  Settings2,
  Users,
  Trash2,
} from 'lucide-react';
import { SeverityBadge, LifecycleBadge } from '@/entities/incident/badges';
import { Avatar } from '@/shared/ui/primitives';
import { LocalMessage, StreamTime } from '@/shared/ui/message-presentation';
import type { WorkspaceUser } from '@/entities/current-user/model';
import type { TimelineEntry } from '@/entities/timeline/model';
import type { OutboxRecord } from './local-work';
import type { TimelineRow } from './projection';
import type { TimelineViewport } from './target-navigation';
import { MeasuredStream } from '@/shared/ui/measured-stream';
import { SafeText } from '@/shared/ui/safe-text';
export { SafeText } from '@/shared/ui/safe-text';
export { StreamCompose as TimelineCompose } from '@/shared/ui/stream-compose';
// Preserve the existing source-reference presentation used outside the Incident Room.
export { EntryContent } from './reference-entry-content';
export function ThreadRootPreview({
  entry,
  users,
}: {
  entry: TimelineEntry;
  users: WorkspaceUser[];
}) {
  const name = (id: string) => users.find((user) => user.id === id)?.name ?? 'Workspace member';
  const source = entry.tombstone
    ? 'Deleted entry'
    : entry.type === 'human_message'
      ? name(entry.authorId)
      : entry.type === 'monitoring_event'
        ? `Monitoring · ${entry.source}`
        : entry.type === 'deployment_event'
          ? `Deployment · ${entry.service}`
          : entry.type === 'status_change'
            ? 'Status change'
            : entry.type === 'severity_change'
              ? 'Severity change'
              : entry.type === 'participant_event'
                ? 'Participant event'
                : 'System event';
  const excerpt = entry.tombstone
    ? `Source no longer available. ${entry.tombstone.reason}`
    : entry.type === 'human_message'
      ? entry.body
      : entry.type === 'monitoring_event' || entry.type === 'system_event'
        ? entry.summary
        : entry.type === 'deployment_event'
          ? `${entry.version} · ${entry.summary}`
          : entry.type === 'status_change' || entry.type === 'severity_change'
            ? `${entry.from} → ${entry.to}`
            : `${name(entry.participantId)} · ${entry.action.replaceAll('_', ' ')}`;
  return (
    <div className="thread-root-preview">
      <div className="stream-event-heading">
        <strong>{source}</strong>
        <StreamTime value={entry.occurredAt} />
      </div>
      <p>
        {excerpt.slice(0, 240)}
        {excerpt.length > 240 ? '…' : ''}
      </p>
    </div>
  );
}
export function RoomEntryContent({
  entry,
  users,
}: {
  entry: TimelineEntry;
  users: WorkspaceUser[];
}) {
  const name = (id: string) => users.find((user) => user.id === id)?.name ?? 'Workspace member';
  if (entry.tombstone)
    return (
      <div className="stream-tombstone">
        <Trash2 size={16} aria-hidden="true" />
        <div>
          <strong>Deleted entry</strong>
          <p>Source no longer available. {entry.tombstone.reason}</p>
          <StreamTime value={entry.occurredAt} />
        </div>
      </div>
    );
  let content: ReactNode;
  switch (entry.type) {
    case 'human_message':
      content = (
        <>
          <div className="stream-message-heading">
            <Avatar name={name(entry.authorId)} />
            <strong>{name(entry.authorId)}</strong>
            <StreamTime value={entry.occurredAt} />
          </div>
          <p className="stream-body">
            <SafeText text={entry.body} />
          </p>
        </>
      );
      break;
    case 'monitoring_event':
      content = (
        <>
          <div className="stream-event-heading">
            <strong>Monitoring · {entry.source}</strong>
            <StreamTime value={entry.occurredAt} />
          </div>
          <p className="stream-signal">{entry.summary}</p>
        </>
      );
      break;
    case 'deployment_event':
      content = (
        <>
          <div className="stream-event-heading">
            <strong>
              Deployment · {entry.service} · {entry.version}
            </strong>
            <StreamTime value={entry.occurredAt} />
          </div>
          <p className="stream-event-body">{entry.summary}</p>
        </>
      );
      break;
    case 'status_change':
      content = (
        <>
          <div className="stream-event-heading">
            <span>{name(entry.actorId)} changed status</span>
            <StreamTime value={entry.occurredAt} />
          </div>
          <div className="stream-transition">
            <LifecycleBadge status={entry.from} />
            <ArrowRight size={14} aria-label="to" />
            <LifecycleBadge status={entry.to} />
          </div>
        </>
      );
      break;
    case 'severity_change':
      content = (
        <>
          <div className="stream-event-heading">
            <span>{name(entry.actorId)} changed severity</span>
            <StreamTime value={entry.occurredAt} />
          </div>
          <div className="stream-transition">
            <SeverityBadge severity={entry.from} />
            <ArrowRight size={14} aria-label="to" />
            <SeverityBadge severity={entry.to} />
          </div>
        </>
      );
      break;
    case 'participant_event':
      content = (
        <div className="stream-event-heading">
          <span>
            Participant · {name(entry.participantId)} · {entry.action.replaceAll('_', ' ')}
            <span className="stream-actor"> · Recorded by {name(entry.actorId)}</span>
          </span>
          <StreamTime value={entry.occurredAt} />
        </div>
      );
      break;
    case 'system_event':
      content = (
        <>
          <div className="stream-event-heading">
            <strong>System event</strong>
            <StreamTime value={entry.occurredAt} />
          </div>
          <p className="stream-event-body">{entry.summary}</p>
        </>
      );
      break;
  }
  return (
    <>
      {entry.important && (
        <p className="stream-important">
          <Flag size={13} aria-hidden="true" />
          Important entry
        </p>
      )}
      {content}
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
    <LocalMessage record={record} retry={retry} check={check} remove={remove} writable={writable} />
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
    onUserScroll?(): void;
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
      onUserScroll={props.onUserScroll}
      renderRow={(index) => {
        const row = props.rows[index]!;
        return row.entry ? (
          <ChronologyRow type={row.entry.tombstone ? 'deleted' : row.entry.type}>
            <RoomEntryContent entry={row.entry} users={props.users} />
            {props.renderThread?.(row.entry)}
          </ChronologyRow>
        ) : row.local ? (
          <ChronologyRow type="human_message">
            <LocalEntry
              record={row.local}
              retry={props.retry}
              check={props.check}
              remove={props.remove}
              writable={props.writable}
            />
          </ChronologyRow>
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

const eventIcons = {
  human_message: MessageSquare,
  monitoring_event: Activity,
  deployment_event: GitBranch,
  status_change: Circle,
  severity_change: Flag,
  participant_event: Users,
  system_event: Settings2,
  deleted: Trash2,
};
function ChronologyRow({ type, children }: { type: keyof typeof eventIcons; children: ReactNode }) {
  const Icon = eventIcons[type];
  return (
    <div className={`chronology-event chronology-${type}`}>
      <div className="chronology-marker">
        <Icon size={16} aria-hidden="true" />
      </div>
      <div className="chronology-content">{children}</div>
    </div>
  );
}
