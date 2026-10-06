'use client';
import type { WorkspaceUser } from '@/entities/current-user/model';
import type { PresenceMember } from './protocol';
import type { ConnectionStatus } from './connection-slice';
export function RealtimeSummary({
  status,
  members,
  users,
  userId,
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
  const typing = names([
    ...new Set(
      members
        .filter(
          (member) => member.userId !== userId && member.typingUntil > 0 && !member.typingScope,
        )
        .map((member) => member.userId),
    ),
  ]);
  const labels = {
    connecting: 'Connecting…',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    offline: 'Offline',
  };
  return (
    <div className="my-3 flex flex-wrap items-start gap-3 text-sm">
      <p role="status" aria-label="Realtime connection">
        {labels[status]}
      </p>
      {status !== 'connected' && (
        <button className="incident-button" onClick={retry}>
          Retry connection
        </button>
      )}
      <details aria-label="Incident presence">
        <summary>
          {present.length} {present.length === 1 ? 'person' : 'people'} viewing
        </summary>
        <p className="max-h-40 max-w-xs overflow-auto break-words">
          {names(present).join(', ') || 'No active viewers'}
        </p>
      </details>
      <p aria-label="Timeline typing">
        {typing.length > 2
          ? `${typing.length} people are typing…`
          : typing.length
            ? `${typing.join(' and ')} ${typing.length === 1 ? 'is' : 'are'} typing…`
            : ''}
      </p>
    </div>
  );
}
