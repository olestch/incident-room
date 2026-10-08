import { expect, it } from 'vitest';
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
