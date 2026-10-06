'use client';
import type { WorkspaceUser } from '@/entities/current-user/model';
import { replyPreview, type ThreadMessage } from '@/entities/thread/model';
import type { OutboxRecord } from '@/shared/messaging/local-work';
import { SafeText } from '@/shared/ui/safe-text';
export function ReplyReference({
  id,
  index,
  users,
  navigate,
}: {
  id: string;
  index: ReadonlyMap<string, ThreadMessage>;
  users: WorkspaceUser[];
  navigate(id: string): void;
}) {
  return (
    <button
      className="reply-reference"
      onClick={() => navigate(id)}
      aria-label={`View reply reference ${id}`}
    >
      {replyPreview(id, index, (id) => users.find((u) => u.id === id)?.name ?? 'Workspace member')}
    </button>
  );
}
export function ThreadMessageContent({
  message,
  index,
  users,
  writable,
  reply,
  navigate,
}: {
  message: ThreadMessage;
  index: ReadonlyMap<string, ThreadMessage>;
  users: WorkspaceUser[];
  writable: boolean;
  reply(id: string): void;
  navigate(id: string): void;
}) {
  return (
    <>
      {message.replyToMessageId && (
        <ReplyReference
          id={message.replyToMessageId}
          index={index}
          users={users}
          navigate={navigate}
        />
      )}
      {message.tombstone ? (
        <>
          <strong>Deleted message</strong>
          <p>{message.tombstone.reason}</p>
        </>
      ) : (
        <>
          <strong>
            {users.find((u) => u.id === message.authorId)?.name ?? 'Workspace member'}
          </strong>
          <p className="whitespace-pre-wrap">
            <SafeText text={message.body} />
          </p>
        </>
      )}
      <time className="text-xs text-muted" dateTime={message.occurredAt}>
        {new Date(message.occurredAt).toLocaleString()}
      </time>
      {writable && (
        <button className="incident-button ml-2" onClick={() => reply(message.id)}>
          Reply
        </button>
      )}
    </>
  );
}
export function PendingReply({
  record,
  check,
  retry,
  remove,
  writable,
}: {
  record: OutboxRecord;
  writable: boolean;
  check(id: string): void;
  retry(id: string): void;
  remove(id: string): void;
}) {
  return (
    <>
      <strong>
        Your reply ·{' '}
        {record.state === 'unknown'
          ? 'Checking delivery'
          : record.state === 'sending'
            ? 'Sending'
            : 'Failed'}
      </strong>
      <p className="whitespace-pre-wrap">
        <SafeText text={record.body} />
      </p>
      {record.replyToMessageId && <p>Reply reference: {record.replyToMessageId}</p>}
      {record.issue && <p>{record.issue}</p>}
      {record.state === 'unknown' && (
        <button className="incident-button" onClick={() => check(record.clientMutationId)}>
          Check delivery
        </button>
      )}
      {record.state === 'failed' && (
        <div>
          <button
            className="incident-button"
            disabled={!writable || !record.retryAllowed}
            onClick={() => retry(record.clientMutationId)}
          >
            Retry reply
          </button>
          <button className="incident-button" onClick={() => remove(record.clientMutationId)}>
            Delete local reply
          </button>
        </div>
      )}
    </>
  );
}
