import { beforeEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { SearchResults } from '@/features/search/views';
import { NotificationInbox, UnreadBadge } from '@/features/notifications/views';
import { CommandPalette } from '@/features/command-palette/views';
import { commandRegistry } from '@/features/command-palette/model';
import { notificationSchema } from '@/entities/notification/model';
import type { SearchResult } from '@/entities/search/model';
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
const result: SearchResult = {
  type: 'timeline_message',
  id: 'entry',
  entryId: 'entry',
  incidentNumber: 'INC-2841',
  title: 'Fictional impact',
  authorId: 'demo-sage',
  snippet: '<script>alert</script> gateway',
  score: 100,
  time: '2026-09-01T10:00:00.000Z',
};
const notification = notificationSchema.parse({
  id: crypto.randomUUID(),
  workspaceId: 'demo-orbit',
  recipientUserId: 'demo-sage',
  type: 'timeline_mention',
  createdAt: result.time,
  readAt: null,
  revision: 1,
  context: 'INC-2841: mentioned you',
  target: { type: 'timeline', number: 'INC-2841', entry: 'entry' },
});
it('renders plain Search snippets and exact Timeline/Thread destinations safely', () => {
  const { container } = render(
    <SearchResults
      query="alert"
      items={[
        result,
        { ...result, type: 'thread_message', id: 'reply', messageId: 'reply', rootId: 'root' },
      ]}
    />,
  );
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getAllByText('alert', { selector: 'mark' })).toHaveLength(2);
  const links = screen.getAllByRole('link');
  expect(links[0]).toHaveAttribute('href', '/app/incidents/INC-2841?event=entry');
  expect(links[1]).toHaveAttribute('href', '/app/incidents/INC-2841?thread=root&message=reply');
});
it('unread badge caps visual value without losing accessible exact count', () => {
  render(<UnreadBadge count={124} />);
  expect(screen.getByLabelText('124 unread notifications')).toHaveTextContent('99+');
});
it('Search includes readable author names, Incident updated time and user profile/initials', () => {
  render(
    <SearchResults
      query="Sage"
      items={[
        { ...result, authorName: 'Sage Linden' },
        {
          type: 'user',
          id: 'demo-sage',
          userId: 'demo-sage',
          name: 'Sage Linden',
          role: 'member',
          status: 'active',
          snippet: 'Sage Linden',
          score: 100,
          time: result.time,
        },
        {
          type: 'incident',
          id: 'incident',
          incidentNumber: 'INC-2841',
          title: 'Fictional incident',
          snippet: 'Context',
          severity: 'P1',
          status: 'triggered',
          serviceIds: [],
          score: 100,
          time: result.time,
        },
      ]}
    />,
  );
  expect(screen.getByText(/Author: Sage Linden/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Sage Linden' })).toHaveAttribute(
    'href',
    '/app/profile/demo-sage',
  );
  expect(screen.getByText('SL')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByText(/Updated/)).toBeVisible();
});
it('inbox read/unread and activation use separate accessible actions', async () => {
  const activate = vi.fn(),
    mark = vi.fn(),
    markAll = vi.fn();
  render(
    <NotificationInbox
      items={[notification]}
      busy={false}
      activate={activate}
      mark={mark}
      markAll={markAll}
      more={false}
      loadMore={() => {}}
      error={false}
      retry={() => {}}
    />,
  );
  expect(screen.getByText(/Unread · timeline mention/)).toBeVisible();
  await userEvent.click(screen.getByRole('link'));
  expect(activate).toHaveBeenCalledWith(notification);
  await userEvent.click(screen.getByRole('button', { name: /^Mark read$/ }));
  expect(mark).toHaveBeenCalledWith(notification, true);
  await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
  expect(markAll).toHaveBeenCalledTimes(1);
});
it('inbox supports empty, pagination and retry without misleading empty-on-error', async () => {
  const more = vi.fn(),
    retry = vi.fn();
  const { rerender } = render(
    <NotificationInbox
      items={[]}
      busy={false}
      activate={() => {}}
      mark={() => {}}
      markAll={() => {}}
      more={false}
      loadMore={more}
      error={false}
      retry={retry}
    />,
  );
  expect(screen.getByText('No notifications.')).toBeVisible();
  rerender(
    <NotificationInbox
      items={[notification]}
      busy={false}
      activate={() => {}}
      mark={() => {}}
      markAll={() => {}}
      more={true}
      loadMore={more}
      error={true}
      retry={retry}
    />,
  );
  expect(screen.queryByText('No notifications.')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Load more notifications' }));
  await userEvent.click(screen.getByRole('button', { name: 'Retry Inbox' }));
  expect(more).toHaveBeenCalledTimes(1);
  expect(retry).toHaveBeenCalledTimes(1);
});
it('read row exposes Mark unread instead of relying on color', () => {
  render(
    <NotificationInbox
      items={[{ ...notification, readAt: notification.createdAt }]}
      busy={false}
      activate={() => {}}
      mark={() => {}}
      markAll={() => {}}
      more={false}
      loadMore={() => {}}
      error={false}
      retry={() => {}}
    />,
  );
  expect(screen.getByText(/Read · timeline mention/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Mark unread' })).toBeEnabled();
});
function PaletteHarness({ execute, close }: { execute: (id: string) => void; close: () => void }) {
  const [input, setInput] = useState('');
  return (
    <CommandPalette
      commands={commandRegistry(
        '/app/incidents/INC-2841',
        new URLSearchParams('thread=root'),
        true,
      )}
      remote={[]}
      input={input}
      change={setInput}
      close={close}
      execute={(command) => execute(command.id)}
      loading={false}
      error={false}
    />
  );
}
it('palette focuses input, announces selection and activates Arrow/Enter choice', async () => {
  const execute = vi.fn();
  render(<PaletteHarness execute={execute} close={() => {}} />);
  const input = screen.getByRole('combobox');
  expect(input).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(execute).toHaveBeenCalledWith('mine');
  expect(screen.getAllByRole('option', { selected: true })).toHaveLength(1);
});
it('palette filters context commands and blocks IME Enter', async () => {
  const execute = vi.fn();
  render(<PaletteHarness execute={execute} close={() => {}} />);
  const input = screen.getByRole('combobox');
  await userEvent.type(input, 'Close current Thread');
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(execute).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}');
  expect(execute).toHaveBeenCalledWith('close-thread');
});
it('palette closes on cancel and restores invoking focus after unmount', async () => {
  const close = vi.fn();
  const opener = document.createElement('button');
  opener.textContent = 'Open';
  document.body.append(opener);
  opener.focus();
  const { unmount } = render(<PaletteHarness execute={() => {}} close={close} />);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
  expect(close).toHaveBeenCalledTimes(1);
  unmount();
  await waitFor(() => expect(opener).toHaveFocus());
  opener.remove();
});
