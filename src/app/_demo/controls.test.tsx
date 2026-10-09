import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultDemo } from '@/features/demo/model';
import { DemoControls } from './controls';
const fake = vi.hoisted(() => ({ operation: vi.fn(), clear: vi.fn() }));
vi.mock('@/app/_providers/hooks', () => ({
  useAppDispatch: () => vi.fn(),
  useAppSelector: (selector: (state: unknown) => unknown) => selector({ demo: defaultDemo }),
}));
vi.mock('@/app/_providers/session-provider', () => ({
  useSessionRuntime: () => ({
    coordinator: {
      request: (task: (signal: AbortSignal) => Promise<unknown>) =>
        task(new AbortController().signal),
    },
    adapter: { resource: fake.operation },
  }),
}));
vi.mock('./reset', () => ({ clearDemoStores: fake.clear, exclusiveDemoMaintenance: vi.fn() }));
it('keeps useful ordinary error details in nonblocking status and restores enabled controls after failure', async () => {
  fake.operation.mockRejectedValueOnce(new Error('Fictional storage is unavailable.'));
  render(<DemoControls />);
  await userEvent.click(screen.getByRole('button', { name: 'Generate persistent event' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Demo operation unavailable. Fictional storage is unavailable.',
  );
  expect(screen.getByRole('button', { name: 'Generate persistent event' })).toBeEnabled();
  expect(screen.queryByText(/Generated monitoring activity/)).not.toBeInTheDocument();
});
it('destructive reset requires an explicit decision and cancellation does not remove any data', async () => {
  render(<DemoControls />);
  await userEvent.click(screen.getByRole('button', { name: 'Reset Demo data' }));
  expect(screen.getByRole('dialog', { name: 'Reset Demo data?' })).toHaveAccessibleDescription(
    /Remove all fictional accounts/,
  );
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(fake.clear).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Reset Demo data' })).toHaveFocus();
});
