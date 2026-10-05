import { useQueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { connectionChanged } from '@/features/realtime/connection-slice';
import { AppProviders } from './app-providers';
import { useAppDispatch, useAppSelector } from './hooks';

function Probe({ name }: { name: string }) {
  const dispatch = useAppDispatch();
  const status = useAppSelector((state) => state.connection.status);
  const queryClient = useQueryClient();
  return (
    <section aria-label={name}>
      <p>
        {name}: {status}
      </p>
      <button
        onClick={() => {
          queryClient.setQueryData(['probe'], name);
          dispatch(connectionChanged('connected'));
        }}
      >
        Connect {name}
      </button>
      <button
        onClick={() => {
          if (queryClient.getQueryData(['probe']) === undefined)
            dispatch(connectionChanged('reconnecting'));
        }}
      >
        Check empty cache {name}
      </button>
    </section>
  );
}

it('wires both providers while keeping separately mounted runtimes independent', async () => {
  const user = userEvent.setup();
  render(
    <>
      <AppProviders>
        <Probe name="first" />
      </AppProviders>
      <AppProviders>
        <Probe name="second" />
      </AppProviders>
    </>,
  );
  await user.click(screen.getByRole('button', { name: 'Connect first' }));
  expect(screen.getByText('first: connected')).toBeVisible();
  expect(screen.getByText('second: offline')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Check empty cache second' }));
  expect(screen.getByText('second: reconnecting')).toBeVisible();
});
