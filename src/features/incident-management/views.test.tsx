import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkspaceUser } from '@/entities/current-user/model';
import { AppError } from '@/shared/errors/app-error';
import { emptyFilters } from '@/entities/incident/filters';
import { CreateIncidentDialog, IncidentContext, IncidentFiltersView } from './views';
import { seedIncidents } from './authority';
import { IncidentQueueRow } from './queue-row';

const users: WorkspaceUser[] = [
  {
    id: 'demo-river',
    workspaceId: 'demo-orbit',
    name: 'River Vale',
    email: 'river.vale@example.test',
    role: 'admin',
    status: 'active',
  },
  {
    id: 'demo-sage',
    workspaceId: 'demo-orbit',
    name: 'Sage Linden',
    email: 'sage.linden@example.test',
    role: 'member',
    status: 'active',
  },
];
beforeEach(() => {
  // jsdom has no top-layer dialog implementation. Browser tests assert actual modality/focus.
  if (!HTMLDialogElement.prototype.showModal)
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() {},
    });
  if (!HTMLDialogElement.prototype.close)
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() {} });
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute('open', '');
  });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.removeAttribute('open');
  });
});
it('keeps severity and lifecycle metadata with one native link and no nested controls per row', () => {
  const incident = seedIncidents().incidents[24]!;
  const { container } = render(
    <ul>
      <IncidentQueueRow incident={incident} users={users} />
    </ul>,
  );
  const row = screen.getByRole('listitem');
  expect(row).toHaveAttribute('data-severity', 'P1');
  expect(row).toHaveAttribute('data-status', 'resolved');
  expect(row).toHaveTextContent('P1 Critical');
  expect(row).toHaveTextContent('Resolved');
  expect(screen.getByRole('link')).toHaveAttribute('href', '/app/incidents/INC-2865');
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(container.querySelector('a button, a input, a a')).toBeNull();
});
it('renders normalized summary and detail with readable states, names and UTC timestamps', () => {
  render(<IncidentContext incident={seedIncidents().incidents[4]!} users={users} detail />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('INC-2845');
  expect(screen.getByText('Commander: River Vale')).toBeVisible();
  expect(screen.getByText(/Operational writes are closed/)).toBeVisible();
  expect(screen.getByText(/Services:/)).toHaveTextContent('Ripple Delivery');
  expect(screen.getByText(/Created/)).toHaveTextContent('UTC');
});
it('URL-owned filters emit changes, clear filters and never offer inactive people', async () => {
  const change = vi.fn();
  const user = userEvent.setup();
  render(
    <IncidentFiltersView
      filters={{ ...emptyFilters, severity: ['P1'], assignedToMe: true }}
      users={[
        ...users,
        { ...users[0]!, id: 'inactive', name: 'Inactive person', status: 'deactivated' },
      ]}
      change={change}
    />,
  );
  expect(screen.getByLabelText('Assigned to me')).toBeChecked();
  expect(screen.queryByRole('option', { name: 'Inactive person' })).not.toBeInTheDocument();
  await user.click(screen.getByLabelText('Investigating'));
  expect(change).toHaveBeenLastCalledWith(
    expect.objectContaining({ status: ['investigating'], assignedToMe: true }),
  );
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(change).toHaveBeenLastCalledWith(emptyFilters);
});
it('validates required fields, associates errors and submits only normalized values', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <CreateIncidentDialog users={users} creatorId="demo-sage" close={vi.fn()} submit={submit} />,
  );
  expect(screen.getByRole('dialog', { name: 'Create Incident' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Create Incident' }));
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Title (required)')).toHaveAttribute(
    'aria-describedby',
    'create-title-error',
  );
  expect(screen.getByLabelText('Title (required)')).toHaveFocus();
  await user.type(screen.getByLabelText('Title (required)'), '  Fictional service disruption  ');
  await user.selectOptions(screen.getByLabelText('Severity (required)'), 'P2');
  await user.click(screen.getByLabelText('River Vale'));
  await user.click(screen.getByLabelText('Aurora Edge'));
  await user.click(screen.getByRole('button', { name: 'Create Incident' }));
  await waitFor(() => expect(submit).toHaveBeenCalledOnce());
  expect(submit.mock.calls[0]?.[0]).toEqual({
    title: 'Fictional service disruption',
    description: '',
    severity: 'P2',
    serviceIds: ['aurora-edge'],
    participantIds: ['demo-river'],
  });
  expect(submit.mock.calls[0]?.[1]).toMatch(/^[\da-f-]{36}$/);
});
it('removes one chip without changing other filters or the sort order', async () => {
  const change = vi.fn();
  const filters = {
    ...emptyFilters,
    status: ['investigating' as const, 'monitoring' as const],
    severity: ['P1' as const],
    participant: 'demo-sage',
    from: '2026-09-01',
    assignedToMe: true,
    sort: 'newest' as const,
  };
  render(<IncidentFiltersView filters={filters} users={users} change={change} />);
  await userEvent.click(screen.getByRole('button', { name: 'Remove Status: Investigating' }));
  expect(change).toHaveBeenLastCalledWith({ ...filters, status: ['monitoring'] });
  await userEvent.click(
    screen.getByRole('button', { name: 'Remove Created from: 2026-09-01 UTC' }),
  );
  expect(change).toHaveBeenLastCalledWith({ ...filters, from: '' });
  await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(change).toHaveBeenLastCalledWith({ ...emptyFilters, sort: 'newest' });
});
it('preserves values on known failure and retries without duplicate automatic submissions', async () => {
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new AppError('validation', 'Participant eligibility changed.'))
    .mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <CreateIncidentDialog users={users} creatorId="demo-sage" close={vi.fn()} submit={submit} />,
  );
  await user.type(screen.getByLabelText('Title (required)'), 'Keep this fictional input');
  await user.selectOptions(screen.getByLabelText('Severity (required)'), 'P3');
  await user.click(screen.getByRole('button', { name: 'Create Incident' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Participant eligibility changed.');
  expect(screen.getByLabelText('Title (required)')).toHaveValue('Keep this fictional input');
  expect(submit).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'Create Incident' }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit.mock.calls[0]?.[1]).toBe(submit.mock.calls[1]?.[1]);
});
it('locks an ambiguous submission and manually retries the same receipt key/payload', async () => {
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new AppError('network', 'Connection unavailable.'))
    .mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <CreateIncidentDialog users={users} creatorId="demo-sage" close={vi.fn()} submit={submit} />,
  );
  await user.type(screen.getByLabelText('Title (required)'), 'Ambiguous fictional request');
  await user.selectOptions(screen.getByLabelText('Severity (required)'), 'P1');
  await user.click(screen.getByRole('button', { name: 'Create Incident' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Fields are locked');
  expect(screen.getByLabelText('Title (required)')).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Retry submission' }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit.mock.calls[0]).toEqual(submit.mock.calls[1]);
});
it('guards unresolved submission and dirty close, restoring focus after unmount', async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  const submit = vi.fn(() => new Promise<void>(() => {}));
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const view = render(
    <CreateIncidentDialog users={users} creatorId="demo-sage" close={close} submit={submit} />,
  );
  await user.type(screen.getByLabelText('Title (required)'), 'A draft');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('dialog', { name: 'Discard incident draft?' })).toHaveTextContent(
    'has not been created',
  );
  await user.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(close).not.toHaveBeenCalled();
  await user.selectOptions(screen.getByLabelText('Severity (required)'), 'P1');
  await user.dblClick(screen.getByRole('button', { name: 'Create Incident' }));
  expect(submit).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  view.unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});

it('ignores blank draft changes, warns on meaningful unload, and does not discard before a decision', async () => {
  const user = userEvent.setup(),
    close = vi.fn();
  render(
    <CreateIncidentDialog users={users} creatorId="demo-river" close={close} submit={vi.fn()} />,
  );
  await user.type(screen.getByLabelText('Title (required)'), '   ');
  const blankUnload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(blankUnload);
  expect(blankUnload.defaultPrevented).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledOnce();
  await user.type(screen.getByLabelText('Title (required)'), 'Meaningful draft');
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Title (required)')).toHaveValue('   Meaningful draft');
  await user.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(close).toHaveBeenCalledTimes(2);
});
