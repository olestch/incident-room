import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { threadMessageSchema } from '@/entities/thread/model';
import { outboxSchema } from '@/shared/messaging/local-work';
import { StreamCompose } from '@/shared/ui/stream-compose';
import { MeasuredStream } from '@/shared/ui/measured-stream';
import { installVirtualLayout } from '@/shared/testing/virtual-layout';
import { ThreadMessageContent, ReplyReference, PendingReply } from './views';
const message = threadMessageSchema.parse({
  id: 'message',
  threadId: 'thread',
  workspaceId: 'orbit',
  incidentId: 'room',
  rootTimelineEntryId: 'root',
  authorId: 'river',
  body: '<script>bad()</script> **plain** https://example.test',
  replyToMessageId: 'parent',
  occurredAt: '2026-09-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  serverTieOrder: 1,
  revision: 1,
  tombstone: null,
});
const parent = { ...message, id: 'parent', body: 'Fictional parent', replyToMessageId: null };
const index = new Map([
  [message.id, message],
  [parent.id, parent],
]);
const props = { message, index, users: [], writable: true, reply: vi.fn(), navigate: vi.fn() };
const compose = {
  label: 'Thread',
  body: '',
  edit: vi.fn(),
  send: vi.fn(),
  discard: vi.fn(),
  users: [],
  ready: true,
  busy: false,
  writable: true,
  resolved: false,
  issue: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  installVirtualLayout();
});
it('renders flat contextual reference, escaped body and safe URL only', () => {
  render(<ThreadMessageContent {...props} />);
  expect(screen.getByRole('button', { name: 'View reply reference parent' })).toHaveTextContent(
    'Fictional parent',
  );
  expect(document.querySelector('script')).toBeNull();
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.queryByRole('list')).toBeNull();
});
it('Reply sets identity, reference selection navigates separately', async () => {
  render(<ThreadMessageContent {...props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Reply' }));
  expect(props.reply).toHaveBeenCalledWith('message');
  await user.click(screen.getByRole('button', { name: 'View reply reference parent' }));
  expect(props.navigate).toHaveBeenCalledWith('parent');
});
it('deleted parent uses semantic reference placeholder without exposing deleted body', () => {
  render(
    <ReplyReference
      id="parent"
      index={
        new Map([
          [
            'parent',
            { ...parent, tombstone: { deletedAt: parent.createdAt, reason: 'withdrawn' } },
          ],
        ])
      }
      users={[]}
      navigate={props.navigate}
    />,
  );
  expect(screen.getByRole('button')).toHaveTextContent('Deleted message');
  expect(screen.queryByText(/Fictional parent/)).toBeNull();
});
it('unloaded reference stays navigable; tombstoned target renders no content', () => {
  const { rerender } = render(
    <ReplyReference id="unloaded" index={index} users={[]} navigate={props.navigate} />,
  );
  expect(screen.getByRole('button')).toHaveTextContent('Unloaded or unavailable');
  rerender(
    <ThreadMessageContent
      {...props}
      message={{ ...message, tombstone: { deletedAt: message.createdAt, reason: 'removed' } }}
    />,
  );
  expect(screen.getByText('Deleted message')).toBeVisible();
  expect(screen.queryByRole('link')).toBeNull();
});
it('compose validates whitespace, respects IME/newline, and Cmd/Ctrl sends', async () => {
  const { rerender } = render(<StreamCompose {...compose} body="  " />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Write a message');
  expect(compose.send).not.toHaveBeenCalled();
  rerender(<StreamCompose {...compose} body="Context" />);
  const input = screen.getByLabelText('Message');
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(compose.send).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
  expect(compose.send).toHaveBeenCalledTimes(1);
});
it('resolved/nonparticipant Thread is read-only with no editor or reply action', () => {
  const { rerender } = render(<StreamCompose {...compose} writable={false} resolved />);
  expect(screen.getByRole('note')).toHaveTextContent('Resolved incident: Thread is read-only.');
  expect(screen.queryByRole('textbox')).toBeNull();
  rerender(<ThreadMessageContent {...props} writable={false} />);
  expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
});
it('sending, unknown and failed expose only valid local actions and stable UUID', async () => {
  const record = outboxSchema.parse({
    clientMutationId: '00000000-0000-4000-8000-000000000001',
    userId: 'river',
    workspaceId: 'orbit',
    incidentId: 'room',
    rootTimelineEntryId: 'root',
    replyToMessageId: 'parent',
    body: 'reply',
    provisionalAt: message.createdAt,
    state: 'sending',
    attempts: 1,
    lastAttemptAt: null,
    issue: null,
    retryAllowed: false,
  });
  const retry = vi.fn(),
    check = vi.fn(),
    remove = vi.fn();
  const { rerender } = render(
    <PendingReply record={record} writable retry={retry} check={check} remove={remove} />,
  );
  expect(screen.getByText(/Your reply · Sending/)).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
  rerender(
    <PendingReply
      record={{ ...record, state: 'unknown' }}
      writable
      retry={retry}
      check={check}
      remove={remove}
    />,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Check delivery' }));
  expect(check).toHaveBeenCalledWith(record.clientMutationId);
  expect(screen.queryByRole('button', { name: 'Retry reply' })).toBeNull();
  rerender(
    <PendingReply
      record={{ ...record, state: 'failed', retryAllowed: true }}
      writable
      retry={retry}
      check={check}
      remove={remove}
    />,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry reply' }));
  expect(retry).toHaveBeenCalledWith(record.clientMutationId);
});
it('large measured Thread list keeps bounded DOM and one level of rows', () => {
  const rows = Array.from({ length: 10000 }, (_, i) => ({
    key: `message-${i}`,
    entry: { id: `message-${i}` },
  }));
  render(
    <MeasuredStream
      rows={rows}
      label="Thread"
      highlight={null}
      targetActive={false}
      renderRow={(i) => <p>Fictional reply {i}</p>}
    />,
  );
  expect(
    screen.getByRole('list', { name: 'Thread entries' }).querySelectorAll(':scope > li').length,
  ).toBeLessThan(80);
  expect(screen.getByRole('list', { name: 'Thread entries' }).querySelector('li li')).toBeNull();
});
it('URL target keeps its semantic marker when transient highlight expires, without removing row content', () => {
  const rows = [{ key: 'message', entry: { id: 'message' } }];
  const props = {
    rows,
    label: 'Thread',
    targetActive: true,
    targetId: 'message',
    renderRow: () => <p>Fictional measured target</p>,
  };
  const { rerender } = render(<MeasuredStream {...props} highlight="message" />);
  const marker = screen.getByText('Navigation target');
  expect(marker.closest('li')).toHaveClass('timeline-target');
  rerender(<MeasuredStream {...props} highlight={null} />);
  expect(screen.getByText('Navigation target')).toBe(marker);
  expect(marker.closest('li')).not.toHaveClass('timeline-target');
  expect(screen.getByText('Fictional measured target')).toBeVisible();
  rerender(<MeasuredStream {...props} targetActive={false} highlight={null} />);
  expect(screen.queryByText('Navigation target')).toBeNull();
});
