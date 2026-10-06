import { StrictMode, useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { HttpSessionAdapter } from '@/features/session/http-session-adapter';
import { SessionCoordinator } from '@/features/session/session-coordinator';
import type { SessionEnvelope, SessionState } from '@/features/session/session-model';
import { AppProviders } from './app-providers';
import { SessionProvider, useSessionRuntime } from './session-provider';

const mock = vi.hoisted(() => ({ start: vi.fn<() => Promise<void>>() }));
// Mock the worker port, not concurrent dynamic imports of the app startup module.
vi.mock('msw/browser', () => ({
  setupWorker: () => ({ start: mock.start, events: { on() {} } }),
}));
vi.mock('@/app/_demo/reset', async (original) => ({
  ...(await original<typeof import('@/app/_demo/reset')>()),
  acquireDemoLease: async () => {},
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const restored: SessionEnvelope = {
  identity: {
    userId: 'demo-river',
    workspaceId: 'demo-orbit',
    role: 'admin',
    expiresAt: Number.MAX_SAFE_INTEGER,
  },
  user: {
    id: 'demo-river',
    workspaceId: 'demo-orbit',
    role: 'admin',
    status: 'active',
    name: 'River Vale',
    email: 'river.vale@example.test',
  },
};

function Probe({ states }: { states: SessionState[] }) {
  const { state } = useSessionRuntime();
  useEffect(() => {
    states.push(state);
  }, [state, states]);
  return <p role="status">{state.status}</p>;
}

beforeEach(() => {
  mock.start.mockReset();
});

it('Strict Mode replay stays restoring until MSW and the authenticated result are ready', async () => {
  const ready = deferred<void>();
  const response = deferred<SessionEnvelope | null>();
  mock.start.mockReturnValue(ready.promise);
  const restore = vi
    .spyOn(HttpSessionAdapter.prototype, 'restore')
    .mockReturnValue(response.promise);
  const dispose = vi.spyOn(SessionCoordinator.prototype, 'dispose');
  const states: SessionState[] = [];
  render(
    <StrictMode>
      <AppProviders>
        <SessionProvider>
          <Probe states={states} />
        </SessionProvider>
      </AppProviders>
    </StrictMode>,
  );
  await act(async () => vi.dynamicImportSettled());
  await waitFor(() => expect(mock.start).toHaveBeenCalled());
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(restore).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('restoring');
  expect(states.every((state) => state.status === 'restoring')).toBe(true);
  await act(async () => ready.resolve());
  await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('status')).toHaveTextContent('restoring');
  await act(async () => response.resolve(restored));
  expect(screen.getByRole('status')).toHaveTextContent('authenticated');
  expect(
    states.filter((state) => state.status !== 'restoring').map((state) => state.status),
  ).toEqual(['authenticated']);
});
