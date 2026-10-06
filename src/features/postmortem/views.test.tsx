import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  emptyPostmortemFields,
  emptyActionFields,
  type Postmortem,
  type ActionItem,
} from '@/entities/postmortem/model';
import { AppError } from '@/shared/errors/app-error';
import { PostmortemEditor, ActionEditor, StructuredSections, ActionItemView } from './views';
const record: Postmortem = {
  ...emptyPostmortemFields(),
  id: '00000000-0000-4000-8000-000000000001',
  workspaceId: 'orbit',
  incidentId: 'incident',
  status: 'draft',
  revision: 1,
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
  createdBy: 'river',
  updatedBy: 'river',
};
const timeline = () => <p>Selected Timeline</p>;
const props = {
  record,
  timeline,
  changed: vi.fn(),
  save: vi.fn(async (fields, revision) => ({ ...record, ...fields, revision: revision + 1 })),
};
it('renders accepted structured headings and explicit save, without invented sections', () => {
  render(<PostmortemEditor {...props} />);
  for (const label of ['Summary', 'Impact', 'Root Cause', 'Resolution'])
    expect(screen.getByLabelText(label)).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  expect(screen.queryByText('What went well')).not.toBeInTheDocument();
});
it('saves explicit fields and expected revision and reports success', async () => {
  render(<PostmortemEditor {...props} />);
  await userEvent.type(screen.getByLabelText('Summary'), 'Recovered');
  await userEvent.click(screen.getByRole('button', { name: 'Save Postmortem' }));
  await screen.findByText('Saved.');
  expect(props.save).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Recovered' }), 1);
  expect(screen.getByText(/Based on revision 2/)).toBeVisible();
});
it('validates text length accessibly and does not send invalid fields', async () => {
  const save = vi.fn();
  render(<PostmortemEditor {...props} save={save} />);
  await userEvent.clear(screen.getByLabelText('Impact'));
  const input = screen.getByLabelText('Impact');
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.change(input, { target: { value: 'x'.repeat(8001) } });
  await userEvent.click(screen.getByRole('button', { name: 'Save Postmortem' }));
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
  expect(save).not.toHaveBeenCalled();
});
it('adopts clean remote revision without a conflict banner', async () => {
  const view = render(<PostmortemEditor {...props} />);
  view.rerender(
    <PostmortemEditor {...props} record={{ ...record, revision: 2, summary: 'Remote' }} />,
  );
  await waitFor(() => expect(screen.getByLabelText('Summary')).toHaveValue('Remote'));
  expect(screen.queryByText(/A newer server revision exists/)).not.toBeInTheDocument();
});
it('keeps dirty text on remote update, reviews latest and reloads with retained local copy', async () => {
  const view = render(<PostmortemEditor {...props} />);
  await userEvent.type(screen.getByLabelText('Summary'), 'My local work');
  view.rerender(
    <PostmortemEditor {...props} record={{ ...record, revision: 2, summary: 'Server work' }} />,
  );
  expect(screen.getByLabelText('Summary')).toHaveValue('My local work');
  await userEvent.click(screen.getByRole('button', { name: 'Review latest' }));
  expect(screen.getByLabelText('Latest server version')).toHaveTextContent('Server work');
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  await userEvent.click(screen.getByRole('button', { name: 'Reload latest' }));
  expect(screen.getByLabelText('Summary')).toHaveValue('My local work');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await userEvent.click(screen.getByRole('button', { name: 'Reload latest' }));
  expect(screen.getByLabelText('Summary')).toHaveValue('Server work');
  await userEvent.click(screen.getByText('Retained local reference (not saved)'));
  expect(screen.getByText('My local work')).toBeVisible();
});
it.each(['conflict', 'network'] as const)(
  'retains local edits after %s save failure and never reports saved',
  async (category) => {
    render(
      <PostmortemEditor
        {...props}
        save={vi.fn(async () => {
          throw new AppError(category, `${category} occurred`);
        })}
      />,
    );
    await userEvent.type(screen.getByLabelText('Summary'), 'Local');
    await userEvent.click(screen.getByRole('button', { name: 'Save Postmortem' }));
    await screen.findByText(`${category} occurred`);
    expect(screen.getByLabelText('Summary')).toHaveValue('Local');
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
    if (category === 'conflict')
      expect(screen.getByRole('button', { name: 'Review latest' })).toBeVisible();
  },
);
it('read-only structured rendering escapes HTML and exposes no editor', () => {
  render(
    <StructuredSections
      fields={{ ...emptyPostmortemFields(), summary: '<script>unsafe</script>' }}
    />,
  );
  expect(screen.getByText('<script>unsafe</script>')).toBeVisible();
  expect(document.querySelector('script')).toBeNull();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
const item: ActionItem = {
  ...record,
  ...emptyActionFields(),
  postmortemId: record.id,
  title: 'Follow up',
};
const users = [
  {
    id: 'sage',
    workspaceId: 'orbit',
    role: 'member' as const,
    status: 'active' as const,
    name: 'Sage',
    email: 'sage@example.test',
  },
  {
    id: 'inactive',
    workspaceId: 'orbit',
    role: 'member' as const,
    status: 'deactivated' as const,
    name: 'Inactive',
    email: 'inactive@example.test',
  },
];
it('creates required title, excludes inactive assignees and submits date-only/status', async () => {
  const save = vi.fn(
    async (fields: typeof emptyActionFields extends () => infer F ? F : never) => ({
      ...item,
      ...fields,
    }),
  );
  render(<ActionEditor users={users} save={save} changed={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Create Action Item' }));
  await screen.findByText('Title is required.');
  expect(save).not.toHaveBeenCalled();
  expect(screen.queryByRole('option', { name: 'Inactive' })).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Action title'), 'New task');
  await userEvent.selectOptions(screen.getByLabelText('Assignee'), 'sage');
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-10-31' } });
  await userEvent.selectOptions(screen.getByLabelText('Action status'), 'in_progress');
  await userEvent.click(screen.getByRole('button', { name: 'Create Action Item' }));
  await screen.findByText('Saved.');
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'New task',
      assigneeUserId: 'sage',
      dueDate: '2026-10-31',
      status: 'in_progress',
    }),
    1,
  );
});
it('updates Action Item with its independent revision and retains stale local fields', async () => {
  const save = vi.fn(async () => {
    throw new AppError('conflict', 'Action conflict');
  });
  const view = render(<ActionEditor item={item} users={users} save={save} changed={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Action title'), ' local');
  view.rerender(
    <ActionEditor
      item={{ ...item, revision: 2, title: 'Remote task' }}
      users={users}
      save={save}
      changed={vi.fn()}
    />,
  );
  expect(screen.getByLabelText('Action title')).toHaveValue('Follow up local');
  await userEvent.click(screen.getByRole('button', { name: 'Save Action Item' }));
  await screen.findByText('Action conflict');
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Follow up local' }), 1);
});
it('clean Action Item adopts newer status; read-only card is textual and keyboard-free of write controls', async () => {
  const save = vi.fn(async () => item),
    changed = vi.fn();
  const view = render(<ActionEditor item={item} users={users} save={save} changed={changed} />);
  view.rerender(
    <ActionEditor
      item={{ ...item, revision: 2, status: 'done' }}
      users={users}
      save={save}
      changed={changed}
    />,
  );
  await waitFor(() => expect(screen.getByLabelText('Action status')).toHaveValue('done'));
  view.rerender(<ActionItemView item={{ ...item, status: 'done' }} users={users} />);
  expect(screen.getByText(/Status: done/)).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
