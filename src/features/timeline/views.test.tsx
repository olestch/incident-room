import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installVirtualLayout } from '@/shared/testing/virtual-layout';
import {
  RoomEntryContent as EntryContent,
  LocalEntry,
  SafeText,
  TimelineCompose,
  TimelineList,
  ThreadRootPreview,
} from './views';
import { generateTimeline } from './fixtures';
import { outboxSchema } from './local-work';

beforeEach(() => installVirtualLayout());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const noop = () => {};
const compose = {
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
it('Thread root is a bounded source excerpt and hides tombstoned content', () => {
  const entry = {
    ...generateTimeline('room', 1)[0]!,
    type: 'human_message' as const,
    authorId: 'river',
    body: 'Context '.repeat(100),
  };
  const { rerender } = render(<ThreadRootPreview entry={entry} users={[]} />);
  expect(screen.getByText('Workspace member')).toBeVisible();
  expect(screen.queryByText(entry.body)).toBeNull();
  expect(screen.getByText(/Context Context/).textContent!.length).toBeLessThanOrEqual(241);
  rerender(
    <ThreadRootPreview
      entry={{ ...entry, tombstone: { deletedAt: entry.createdAt, reason: 'withdrawn' } }}
      users={[]}
    />,
  );
  expect(screen.getByText('Deleted entry')).toBeVisible();
  expect(screen.queryByText(/Context Context/)).toBeNull();
});
it('mention selection preserves the plain-text stable identity, excludes inactive users and restores editor focus', async () => {
  const edit = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
    configurable: true,
    value: vi.fn(),
  });
  render(
    <TimelineCompose
      {...compose}
      edit={edit}
      body="Draft"
      users={[
        { id: 'sage', name: 'Sage Linden', status: 'active' },
        { id: 'inactive', name: 'Inactive person', status: 'deactivated' },
      ]}
    />,
  );
  expect(screen.queryByRole('option', { name: 'Inactive person' })).toBeNull();
  await userEvent.setup().selectOptions(screen.getByLabelText('Mention workspace user'), 'sage');
  expect(edit).toHaveBeenCalledWith('Draft @Sage Linden [sage] ');
  expect(screen.getByLabelText('Message')).toHaveFocus();
});
it('renders all entry sources with textual semantics; tombstone never exposes removed body', () => {
  const entries = generateTimeline('room', 7);
  const { rerender } = render(
    <>
      {entries.map((entry) => (
        <EntryContent key={entry.id} entry={entry} users={[]} />
      ))}
    </>,
  );
  expect(screen.getByText(/Monitoring ·/)).toBeVisible();
  expect(screen.getByText(/Deployment ·/)).toBeVisible();
  expect(screen.getByText('System event')).toBeVisible();
  expect(screen.getByText(/changed status/)).toBeVisible();
  expect(screen.getByText(/changed severity/)).toBeVisible();
  expect(screen.getByText(/Participant ·/)).toBeVisible();
  rerender(
    <EntryContent
      entry={{
        ...entries[0]!,
        tombstone: { deletedAt: entries[0]!.createdAt, reason: 'Source removed' },
      }}
      users={[]}
    />,
  );
  expect(screen.getByText('Deleted entry')).toBeVisible();
  expect(screen.queryByText(/Fictional response update/)).not.toBeInTheDocument();
});
it('only detects safe http/https links and treats HTML/Markdown/script URLs as inert text', () => {
  render(
    <SafeText
      text={
        '<script>alert(1)</script> **plain** javascript:alert(1) https://example.test/path http://example.test https://user:secret@example.test'
      }
    />,
  );
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(document.querySelector('script')).toBeNull();
  expect(document.querySelector('strong')).toBeNull();
  expect(screen.getAllByRole('link')[0]).toHaveAttribute('rel', 'noopener noreferrer');
});
it('compose validates whitespace, Enter is newline, Ctrl/Cmd Enter sends except IME and visible Send works', async () => {
  const send = vi.fn();
  const { rerender } = render(<TimelineCompose {...compose} send={send} body="  " />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Send' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Write a message');
  expect(send).not.toHaveBeenCalled();
  rerender(<TimelineCompose {...compose} send={send} body="Fictional" />);
  const input = screen.getByLabelText('Message');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(send).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true });
  expect(send).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
  expect(send).toHaveBeenCalledTimes(1);
});
it('read-only and resolved room has an explanation and no send/editor', () => {
  const { rerender } = render(<TimelineCompose {...compose} writable={false} body="" />);
  expect(screen.getByRole('note')).toHaveTextContent('participants');
  expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
  rerender(<TimelineCompose {...compose} writable={false} resolved body="" />);
  expect(screen.getByRole('note')).toHaveTextContent('Resolved');
});
it('failed optimistic actions use the same mutation identity and unknown permits only checking', async () => {
  const retry = vi.fn();
  const remove = vi.fn();
  const record = outboxSchema.parse({
    clientMutationId: '00000000-0000-4000-8000-000000000001',
    userId: 'user',
    workspaceId: 'workspace',
    incidentId: 'room',
    body: 'Retained local message',
    provisionalAt: '2026-09-01T00:00:00.000Z',
    state: 'failed',
    attempts: 1,
    lastAttemptAt: null,
    issue: 'Failed',
    retryAllowed: true,
  });
  const { rerender } = render(
    <LocalEntry record={record} retry={retry} remove={remove} check={noop} writable />,
  );
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry message' }));
  expect(retry).toHaveBeenCalledWith(record.clientMutationId);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Delete local message' }));
  expect(remove).toHaveBeenCalledWith(record.clientMutationId);
  rerender(
    <LocalEntry
      record={{ ...record, state: 'unknown' }}
      retry={retry}
      remove={remove}
      check={noop}
      writable
    />,
  );
  expect(screen.queryByRole('button', { name: 'Retry message' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete local message' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Check delivery' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Delivery is uncertain. Check before retrying.',
  );
});
it('real TanStack Virtual renders a bounded measured subset of a 10,000-row projection', async () => {
  const rows = generateTimeline('room', 10000).map((entry) => ({ key: entry.id, entry }));
  render(
    <TimelineList
      rows={rows}
      users={[]}
      highlight={null}
      targetActive={false}
      writable
      retry={noop}
      remove={noop}
      check={noop}
      loadGap={noop}
    />,
  );
  await waitFor(() => {
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(80);
    expect(items[0]).toHaveAttribute('aria-setsize', '10000');
  });
});
