import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ErrorFallback } from './error-fallback';

it('allows keyboard recovery and provides a safe home destination', async () => {
  const onRetry = vi.fn();
  const user = userEvent.setup();
  render(<ErrorFallback onRetry={onRetry} />);
  expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('link', { name: 'Return home' })).toHaveAttribute('href', '/');
});
