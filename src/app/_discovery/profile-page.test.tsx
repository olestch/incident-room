import { beforeEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfilePage } from './profile-page';
const fake = vi.hoisted(() => ({ fail: false }));
vi.mock('@/app/_providers/session-provider', () => ({
  useSessionRuntime: () => ({
    state: { generation: 1, identity: { userId: 'river', workspaceId: 'orbit' } },
    coordinator: {
      request: <T,>(task: (signal: AbortSignal) => Promise<T>) =>
        task(new AbortController().signal),
    },
    adapter: {
      resource: async () => {
        if (fake.fail) throw new Error('Unavailable');
        return [
          {
            id: 'sage',
            workspaceId: 'orbit',
            name: 'Sage Linden',
            email: 'sage@example.test',
            role: 'member',
            status: 'active',
          },
          {
            id: 'foreign',
            workspaceId: 'other',
            name: 'Foreign User',
            email: 'foreign@example.test',
            role: 'member',
            status: 'active',
          },
        ];
      },
    },
  }),
}));
beforeEach(() => {
  fake.fail = false;
});
function view(id: string) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={cache}>
      <ProfilePage userId={id} />
    </QueryClientProvider>,
  );
  return () => {
    result.unmount();
    cache.clear();
  };
}
it('opens the read-only workspace profile and canonical existing Incident filter', async () => {
  const dispose = view('sage');
  await screen.findByRole('heading', { name: 'Sage Linden' });
  expect(
    screen.getByRole('link', { name: 'View accessible incidents involving Sage Linden' }),
  ).toHaveAttribute('href', '/app/incidents?participant=sage');
  expect(screen.queryByText('sage@example.test')).not.toBeInTheDocument();
  dispose();
});
it('never renders foreign workspace profile data or unknown destinations', async () => {
  const dispose = view('foreign');
  await screen.findByText('Profile unavailable in your workspace.');
  expect(screen.queryByText('Foreign User')).not.toBeInTheDocument();
  dispose();
});
it('profile failure remains retryable instead of fabricating missing content', async () => {
  fake.fail = true;
  const dispose = view('sage');
  await screen.findByRole('button', { name: 'Retry Profile' });
  fake.fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry Profile' }));
  await screen.findByRole('heading', { name: 'Sage Linden' });
  dispose();
});
