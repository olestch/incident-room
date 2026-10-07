import { AlertCircle, Clock, MessageSquare, RefreshCw, Trash2 } from 'lucide-react';
import type { OutboxRecord } from '@/shared/messaging/local-work';
import { Button } from './primitives';
import { SafeText } from './safe-text';

export function StreamTime({ value }: { value: string }) {
  return (
    <time className="stream-time" dateTime={value} title={new Date(value).toUTCString()}>
      {new Intl.DateTimeFormat('en-GB', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      }).format(new Date(value))}{' '}
      UTC
    </time>
  );
}
export function LocalMessage({
  record,
  retry,
  check,
  remove,
  writable,
  reply = false,
}: {
  record: OutboxRecord;
  retry(id: string): void;
  check(id: string): void;
  remove(id: string): void;
  writable: boolean;
  reply?: boolean;
}) {
  const noun = reply ? 'reply' : 'message';
  const Icon =
    record.state === 'failed' ? AlertCircle : record.state === 'unknown' ? RefreshCw : Clock;
  return (
    <div className={`stream-local stream-local-${record.state}`}>
      <div className="stream-message-heading">
        <MessageSquare size={18} aria-hidden="true" />
        <strong>
          Your {noun} ·{' '}
          {record.state === 'unknown'
            ? 'Checking delivery'
            : record.state === 'sending'
              ? 'Sending'
              : 'Failed'}
        </strong>
        <StreamTime value={record.provisionalAt} />
      </div>
      <p className="stream-body">
        <SafeText text={record.body} />
      </p>
      {record.replyToMessageId && (
        <p className="stream-reference-note">Reply reference: {record.replyToMessageId}</p>
      )}
      <p className="stream-delivery" role="status">
        <Icon size={14} aria-hidden="true" />
        {record.state === 'unknown'
          ? 'Delivery is uncertain. Check before retrying.'
          : record.state === 'sending'
            ? 'Awaiting confirmation'
            : 'Message was not delivered'}
      </p>
      {record.issue && <p className="stream-delivery">{record.issue}</p>}
      <div className="stream-local-actions">
        {record.state === 'failed' && (
          <>
            <Button
              disabled={!writable || !record.retryAllowed}
              onClick={() => retry(record.clientMutationId)}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Retry {noun}
            </Button>
            <Button variant="quiet" onClick={() => remove(record.clientMutationId)}>
              <Trash2 size={14} aria-hidden="true" />
              Delete local {noun}
            </Button>
          </>
        )}
        {record.state === 'unknown' && (
          <Button onClick={() => check(record.clientMutationId)}>
            <RefreshCw size={14} aria-hidden="true" />
            Check delivery
          </Button>
        )}
      </div>
    </div>
  );
}
