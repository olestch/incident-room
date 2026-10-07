import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimelineEvidence } from './evidence';
import type { TimelineEntry } from '@/entities/timeline/model';
const entry: TimelineEntry = {
  id: 'event',
  incidentId: 'incident',
  occurredAt: '2026-10-06T00:00:00.000Z',
  createdAt: '2026-10-06T00:00:00.000Z',
  serverTieOrder: 0,
  revision: 1,
  important: false,
  tombstone: null,
  type: 'human_message',
  authorId: 'sage',
  body: '<script>unsafe</script>',
};
it('evidence is a bounded plain-text preview with type and unavailable-source context', () => {
  const view = render(<TimelineEvidence entry={entry} users={[]} />);
  expect(screen.getByText('Message')).toBeVisible();
  expect(screen.getByText('Unavailable user: <script>unsafe</script>')).toBeVisible();
  expect(view.container.querySelector('script')).toBeNull();
  view.rerender(<TimelineEvidence entry={{ ...entry, body: 'x'.repeat(4000) }} users={[]} />);
  expect(view.container.querySelector('p')?.textContent?.length).toBe(238);
  view.rerender(
    <TimelineEvidence
      entry={{
        ...entry,
        tombstone: { deletedAt: entry.createdAt, reason: 'Removed from the source' },
      }}
      users={[]}
    />,
  );
  expect(screen.getByText(/Source event unavailable/)).toHaveTextContent('Removed from the source');
  expect(screen.queryByText(/unsafe/)).not.toBeInTheDocument();
});
