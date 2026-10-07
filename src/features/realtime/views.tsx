'use client';
import type { WorkspaceUser } from '@/entities/current-user/model';
import type { PresenceMember } from './protocol';
import type { ConnectionStatus } from './connection-slice';
import { Radio, WifiOff } from 'lucide-react';
import { Avatar } from '@/shared/ui/primitives';
export function RealtimeSummary({
  status,
  members,
  users,
  retry,
}: {
  status: ConnectionStatus;
  members: PresenceMember[];
  users: WorkspaceUser[];
  userId: string;
  retry(): void;
}) {
  const names = (ids: string[]) =>
    ids.map((id) => users.find((user) => user.id === id)?.name ?? 'Workspace member');
  const present = [...new Set(members.map((member) => member.userId))];
  const labels = {
    connecting: 'Connecting…',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    offline: 'Offline',
  };
  return (
    <div className="room-realtime">
      <p
        className={`room-connection room-connection-${status}`}
        role="status"
        aria-label="Realtime connection"
      >
        {status === 'offline' ? (
          <WifiOff size={14} aria-hidden="true" />
        ) : (
          <Radio size={14} aria-hidden="true" />
        )}
        {labels[status]}
      </p>
      {status !== 'connected' && (
        <button className="incident-button" onClick={retry}>
          Retry connection
        </button>
      )}
      <details aria-label="Incident presence">
        <summary>
          <span className="presence-avatars">
            {names(present)
              .slice(0, 3)
              .map((name, i) => (
                <Avatar key={`${present[i]}-${i}`} name={name} />
              ))}
          </span>
          {present.length} {present.length === 1 ? 'person' : 'people'} viewing
        </summary>
        <p className="max-h-40 max-w-xs overflow-auto break-words">
          {names(present).join(', ') || 'No active viewers'}
        </p>
      </details>
    </div>
  );
}
export function TimelineTyping({
  members,
  users,
  userId,
}: {
  members: PresenceMember[];
  users: WorkspaceUser[];
  userId: string;
}) {
  const typing = [
    ...new Set(
      members
        .filter(
          (member) => member.userId !== userId && member.typingUntil > 0 && !member.typingScope,
        )
        .map((member) => member.userId),
    ),
  ].map((id) => users.find((user) => user.id === id)?.name ?? 'Workspace member');
  return (
    <p className="room-typing" aria-label="Timeline typing">
      {typing.length > 2
        ? `${typing.length} people are typing…`
        : typing.length
          ? `${typing.join(' and ')} ${typing.length === 1 ? 'is' : 'are'} typing…`
          : ''}
    </p>
  );
}
