'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { currentUserKey } from '@/entities/current-user/model';
import type { SessionIdentity } from '@/features/session/session-model';
import { safeReturnDestination } from '@/features/session/return-destination';
import {
  SessionIssue,
  SessionProgress,
  useSessionRuntime,
} from '@/app/_providers/session-provider';

const links = [
  ['Incidents', '/app/incidents'],
  ['My Incidents', '/app/incidents?assigned=me'],
  ['Notifications', '/app/notifications'],
  ['Search', '/app/search'],
  ['Team', '/app/team'],
  ['Settings', '/app/settings'],
] as const;
export function ProtectedShell({ children }: { children: ReactNode }) {
  const { state, issue } = useSessionRuntime();
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    if (!issue && (state.status === 'anonymous' || state.status === 'expired')) {
      const destination = safeReturnDestination(
        `${pathname}${window.location.search}${window.location.hash}`,
      );
      router.replace(
        `/login?returnTo=${encodeURIComponent(destination)}${state.status === 'expired' ? '&reason=expired' : ''}`,
      );
    }
  }, [state.status, pathname, search, router, issue]);
  if (issue) return <SessionIssue />;
  if (!('identity' in state)) return <SessionProgress />;
  return (
    <IdentityShell
      key={`${state.identity.userId}:${state.identity.workspaceId}:${state.generation}`}
      identity={state.identity}
    >
      {children}
    </IdentityShell>
  );
}
function IdentityShell({ identity, children }: { identity: SessionIdentity; children: ReactNode }) {
  const { coordinator, adapter, state } = useSessionRuntime();
  const pathname = usePathname();
  const router = useRouter();
  const [logoutState, setLogoutState] = useState<'idle' | 'pending'>('idle');
  const current = useQuery({
    queryKey: currentUserKey(identity.userId, identity.workspaceId),
    queryFn: ({ signal }) =>
      coordinator.request((scoped) => adapter.currentUser(scoped, identity), 'safe-read', signal),
    refetchInterval: 60_000,
  });
  return (
    <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <Link className="text-xl font-semibold" href="/app/incidents">
          Incident Room
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          {current.data && (
            <p aria-label="Current user">
              {current.data.name} <span className="text-sm text-muted">({current.data.role})</span>
            </p>
          )}
          <button
            disabled={logoutState === 'pending'}
            className="min-h-11 rounded-lg border border-line px-4 py-2"
            onClick={async () => {
              setLogoutState('pending');
              try {
                await coordinator.logout();
                router.replace('/login');
              } catch {
                router.replace('/login?reason=logout-failed');
              }
            }}
          >
            {logoutState === 'pending' ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>
      <nav aria-label="Application" className="flex flex-wrap gap-x-5 gap-y-3 py-5 text-sm">
        {links.map(([label, href]) => (
          <Link
            key={label}
            href={href}
            aria-current={pathname === href ? 'page' : undefined}
            className="underline"
          >
            {label}
          </Link>
        ))}
      </nav>
      <p role="status" className="text-sm text-muted">
        {state.status === 'refreshing'
          ? 'Refreshing your session…'
          : 'Fictional workspace · Authentication demo'}
      </p>
      {current.isError && (
        <div role="alert" className="mt-4">
          <p>Unable to load your profile.</p>
          <button onClick={() => void current.refetch()} className="underline">
            Retry profile
          </button>
        </div>
      )}
      <main
        id="main-content"
        tabIndex={-1}
        className="mt-6 rounded-xl border border-line bg-surface p-6 sm:p-8"
      >
        {children}
      </main>
    </div>
  );
}
