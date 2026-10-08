import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { seedIncidents } from './authority';
import { IncidentCommandStrip, IncidentDetails } from './room-context';
import userEvent from '@testing-library/user-event';

it('context identity exposes actual incident title and shared domain states', () => {
  const incident = seedIncidents().incidents[0]!;
  render(<IncidentCommandStrip incident={incident} users={[]} />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    `${incident.number} · ${incident.title}`,
  );
  expect(screen.getByText(/P1 Critical/)).toBeVisible();
  expect(screen.getByText('Triggered')).toBeVisible();
});

it('mobile context uses the same incident props in a controlled named sheet', async () => {
  const media = window.matchMedia('(min-width: 64rem)');
  vi.spyOn(window, 'matchMedia').mockReturnValue({ ...media, matches: false });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  const incident = seedIncidents().incidents[0]!;
  const { rerender } = render(<IncidentDetails incident={incident} users={[]} />);
  const trigger = screen.getByRole('button', { name: 'Incident context' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(trigger);
  expect(screen.getByRole('dialog', { name: 'Incident context' })).toHaveTextContent(
    incident.title,
  );
  rerender(
    <IncidentDetails
      incident={{ ...incident, description: 'Updated confirmed incident context.' }}
      users={[]}
    />,
  );
  expect(screen.getByRole('dialog')).toHaveTextContent('Updated confirmed incident context.');
  await userEvent.click(screen.getByRole('button', { name: 'Close Incident context' }));
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  rerender(<IncidentDetails incident={incident} users={[]} threadOpen />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toBeDisabled();
  rerender(<IncidentDetails incident={incident} users={[]} />);
  expect(trigger).toBeEnabled();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

it('context disclosure retains commander, services, participants and creation/update metadata', async () => {
  const incident = seedIncidents().incidents[0]!;
  render(<IncidentDetails incident={incident} users={[]} />);
  await userEvent.click(screen.getByText('Incident context', { exact: true }));
  const context = screen.getByRole('complementary', { name: 'Incident context' });
  expect(context).toHaveTextContent(incident.description);
  expect(context).toHaveTextContent('Commander');
  expect(context).toHaveTextContent('Unavailable workspace user');
  expect(context).toHaveTextContent('Affected services');
  expect(context).toHaveTextContent(`Participants · ${incident.participantIds.length}`);
  expect(context.querySelectorAll('time')).toHaveLength(2);
  expect(context).toHaveTextContent('Created');
  expect(context).toHaveTextContent('Updated');
  expect(context).toHaveTextContent('UTC');
});
