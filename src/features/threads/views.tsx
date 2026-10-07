'use client';
import type { WorkspaceUser } from '@/entities/current-user/model';
import { replyPreview, type ThreadMessage } from '@/entities/thread/model';
import type { OutboxRecord } from '@/shared/messaging/local-work';
import { SafeText } from '@/shared/ui/safe-text';
import { MessageSquare, Trash2 } from 'lucide-react';
import { Avatar, Button } from '@/shared/ui/primitives';
import { LocalMessage, StreamTime } from '@/shared/ui/message-presentation';
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
    <div className={`thread-message ${message.replyToMessageId ? 'thread-message-reply' : ''}`}>
      {message.replyToMessageId && (
        <ReplyReference
          id={message.replyToMessageId}
          index={index}
          users={users}
          navigate={navigate}
        />
      )}
      {message.tombstone ? (
        <div className="stream-tombstone">
          <Trash2 size={16} aria-hidden="true" />
          <div>
            <strong>Deleted message</strong>
            <p>{message.tombstone.reason}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="stream-message-heading">
            <Avatar
              name={users.find((u) => u.id === message.authorId)?.name ?? 'Workspace member'}
            />
            <strong>
              {users.find((u) => u.id === message.authorId)?.name ?? 'Workspace member'}
            </strong>
            <StreamTime value={message.occurredAt} />
          </div>
          <p className="stream-body">
            <SafeText text={message.body} />
          </p>
        </>
      )}
      {message.tombstone && <StreamTime value={message.occurredAt} />}
      {writable && (
        <Button variant="quiet" className="stream-discuss" onClick={() => reply(message.id)}>
          <MessageSquare size={14} aria-hidden="true" />
          Reply
        </Button>
      )}
    </div>
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
    <LocalMessage
      record={record}
      retry={retry}
      check={check}
      remove={remove}
      writable={writable}
      reply
    />
  );
}
