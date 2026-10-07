'use client';
import {
  Bell,
  UserRoundCheck,
  MessagesSquare,
  AlertTriangle,
  Activity,
  FileText,
  ListChecks,
  AtSign,
  CheckCheck,
} from 'lucide-react';
import { Button, InlineAlert } from '@/shared/ui/primitives';
import { EmptyState, RowSkeletons } from '@/shared/ui/secondary-feedback';
const kinds = {
  assigned: { label: 'Assignment', icon: UserRoundCheck },
  timeline_mention: { label: 'Timeline mention', icon: AtSign },
  thread_mention: { label: 'Thread mention', icon: AtSign },
  severity_changed: { label: 'Severity change', icon: AlertTriangle },
  status_changed: { label: 'Status change', icon: Activity },
  thread_reply: { label: 'Thread reply', icon: MessagesSquare },
  postmortem_initiated: { label: 'Postmortem initiated', icon: FileText },
  action_item_assigned: { label: 'Action Item assignment', icon: ListChecks },
};
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
  loading = false,
  unreadCount,
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
  loading?: boolean;
  unreadCount?: number | undefined;
}) {
  return (
    <section className="secondary-page discovery-page">
      <header className="secondary-page-header">
        <p className="secondary-eyebrow">Activity inbox</p>
        <h1>Notifications</h1>
        <p>Assignments, mentions and changes that need your attention.</p>
      </header>
      <div className="inbox-toolbar">
        <p>
          <UnreadBadge count={unreadCount} /> <span aria-hidden="true">unread</span>
        </p>
        <Button disabled={busy || loading} onClick={markAll}>
          <CheckCheck size={17} aria-hidden="true" />
          Mark all as read
        </Button>
      </div>
      <div className="secondary-surface">
        {error && (
          <InlineAlert>
            <p>Inbox unavailable. Loaded notifications remain available.</p>
            <Button onClick={retry} variant="quiet">
              Retry Inbox
            </Button>
          </InlineAlert>
        )}
        {loading && <RowSkeletons label="Loading Notifications…" />}
        {!items.length && !error && !loading && (
          <EmptyState icon={Bell} title="You are caught up">
            <p>No notifications.</p>
          </EmptyState>
        )}
        <ul aria-label="Notifications" className="notification-list">
          {items.map((item) => {
            const { icon: Icon, label } = kinds[item.type];
            return (
              <li
                key={item.id}
                className={`notification-row ${!item.readAt ? 'notification-unread' : ''}`}
              >
                <span className="discovery-row-icon">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <div className="discovery-row-body">
                  <p className="secondary-meta notification-state">
                    <span>
                      {!item.readAt && <span className="notification-dot" aria-hidden="true" />}
                      {item.readAt ? 'Read' : 'Unread'}
                    </span>
                    <span>{label}</span>
                    <span>{item.target.number}</span>
                  </p>
                  <a
                    href={notificationDestination(item)}
                    onClick={(event) => {
                      if (
                        !event.ctrlKey &&
                        !event.metaKey &&
                        !event.shiftKey &&
                        !event.altKey &&
                        event.button === 0
                      ) {
                        event.preventDefault();
                        activate(item);
                      }
                    }}
                    className="notification-link"
                  >
                    {item.context}
                  </a>
                  <p className="secondary-meta">
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC
                    </time>
                  </p>
                </div>
                <Button
                  variant="quiet"
                  className="notification-mark"
                  disabled={busy}
                  onClick={() => mark(item, !item.readAt)}
                >
                  {item.readAt ? 'Mark unread' : 'Mark read'}
                </Button>
              </li>
            );
          })}
        </ul>
        {more && (
          <Button disabled={busy} onClick={loadMore} className="secondary-more">
            Load more notifications
          </Button>
        )}
      </div>
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
