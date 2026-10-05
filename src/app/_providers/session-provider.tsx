'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { currentUserKey } from '@/entities/current-user/model';
import { sessionChanged } from '@/features/session/session-slice';
import { SessionCoordinator } from '@/features/session/session-coordinator';
import { HttpSessionAdapter } from '@/features/session/http-session-adapter';
import { fictionalClientId, forgetFictionalClient } from '@/features/session/mock/browser';
import { connectionChanged } from '@/features/realtime/connection-slice';
import { AppError } from '@/shared/errors/app-error';
import { useAppDispatch, useAppSelector } from './hooks';

const Context = createContext<{
  coordinator: SessionCoordinator;
  adapter: HttpSessionAdapter;
  issue: string | null;
  retry(): void;
} | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const [issue, setIssue] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [runtime] = useState(() => {
    const adapter = new HttpSessionAdapter(fictionalClientId, '', undefined, forgetFictionalClient);
    const coordinator = new SessionCoordinator(adapter, {
      changed: (state) => dispatch(sessionChanged(state)),
      activated: ({ user }) =>
        queryClient.setQueryData(currentUserKey(user.id, user.workspaceId), user),
      cleared: () => {
        // Cancel then remove synchronously; generation checks guard even signal-ignoring work.
        void queryClient.cancelQueries({ queryKey: ['identity'] });
        queryClient.removeQueries({ queryKey: ['identity'] });
        dispatch(connectionChanged('offline'));
      },
    });
    return { coordinator, adapter };
  });
  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      if (active)
        setIssue(
          'Session initialization is taking too long. Check browser storage and connection, then retry.',
        );
    }, 12_000);
    void import('@/app/_mocks/browser')
      .then((module) => module.startMock())
      .then(async () => {
        if (active) {
          await runtime.coordinator.restore();
          if (active) setIssue(null);
        }
      })
      .catch((error) => {
        if (active && !(error instanceof AppError && error.category === 'authentication'))
          setIssue(
            'Session restoration is unavailable. Check browser storage and connection, then retry.',
          );
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      clearTimeout(timeout);
      void runtime.coordinator.dispose().catch(() => {});
    };
  }, [runtime, attempt]);
  return (
    <Context
      value={{
        ...runtime,
        issue,
        retry: () => {
          setIssue(null);
          setAttempt((value) => value + 1);
        },
      }}
    >
      {children}
    </Context>
  );
}
export function useSessionRuntime() {
  const runtime = useContext(Context);
  if (!runtime) throw new Error('Session runtime is not mounted');
  const state = useAppSelector((state) => state.session);
  return { ...runtime, state };
}
export function SessionProgress({
  children = 'Restoring your session…',
}: {
  children?: ReactNode;
}) {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-lg px-6 py-16">
      <p role="status">{children}</p>
    </main>
  );
}
export function SessionIssue() {
  const { issue, retry } = useSessionRuntime();
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-lg px-6 py-16">
      <p role="alert">{issue}</p>
      <button onClick={retry} className="mt-4 underline">
        Retry session restoration
      </button>
    </main>
  );
}
