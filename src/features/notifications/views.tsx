'use client';
import { notificationDestination, type Notification } from '@/entities/notification/model';
export function NotificationInbox({
  items,
  busy,
  activate,
  mark,
  markAll,
  more,
  loadMore,
  error,
  retry,
}: {
  items: readonly Notification[];
  busy: boolean;
  activate: (notification: Notification) => void;
  mark: (notification: Notification, read: boolean) => void;
  markAll: () => void;
  more: boolean;
  loadMore: () => void;
  error: boolean;
  retry: () => void;
}) {
  return (
    <section>
      <h1 className="text-3xl font-semibold">Notifications</h1>
      <button className="my-4 rounded-lg border border-line p-3" disabled={busy} onClick={markAll}>
        Mark all as read
      </button>
      {error && (
        <div role="alert">
          <p>Inbox unavailable. Loaded notifications remain available.</p>
          <button onClick={retry} className="underline">
            Retry Inbox
          </button>
        </div>
      )}
      {!items.length && !error && <p>No notifications.</p>}
      <ul aria-label="Notifications" className="space-y-4">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-line p-4">
            <p className="font-semibold">
              {item.readAt ? 'Read' : 'Unread'} · {item.type.replaceAll('_', ' ')}
            </p>
            <a
              href={notificationDestination(item)}
              onClick={(event) => {
                if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
                  event.preventDefault();
                  activate(item);
                }
              }}
              className="underline"
            >
              {item.context}
            </a>
            <p>
              <time dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC
              </time>
            </p>
            <button
              className="mt-2 underline"
              disabled={busy}
              onClick={() => mark(item, !item.readAt)}
            >
              {item.readAt ? 'Mark unread' : 'Mark read'}
            </button>
          </li>
        ))}
      </ul>
      {more && (
        <button
          disabled={busy}
          onClick={loadMore}
          className="mt-4 rounded-lg border border-line p-3"
        >
          Load more notifications
        </button>
      )}
    </section>
  );
}
export function UnreadBadge({ count }: { count: number | undefined }) {
  return (
    <span
      aria-label={
        count === undefined ? 'Unread notifications unavailable' : `${count} unread notifications`
      }
    >
      {count === undefined ? '—' : count > 99 ? '99+' : count}
    </span>
  );
}
