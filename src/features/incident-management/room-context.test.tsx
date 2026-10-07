import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { seedIncidents } from './authority';
import { IncidentCommandStrip } from './room-context';

it('command strip exposes actual incident identity, shared domain states and compact operational metadata', () => {
  const incident = seedIncidents().incidents[0]!;
  render(<IncidentCommandStrip incident={incident} users={[]} />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    `${incident.number} · ${incident.title}`,
  );
  expect(screen.getByText(/Commander:/)).toHaveTextContent('Workspace member');
  expect(screen.getByText(`${incident.participantIds.length} participants`)).toBeVisible();
  expect(screen.getByText(/Updated/)).toHaveTextContent('UTC');
  expect(screen.getByText(/P1 Critical/)).toBeVisible();
  expect(screen.getByText('Triggered')).toBeVisible();
});
