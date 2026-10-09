'use client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { FlaskConical, Menu } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { currentUserKey } from '@/entities/current-user/model';
import type { SessionIdentity } from '@/features/session/session-model';
import { safeReturnDestination } from '@/features/session/return-destination';
import { CommandsProvider } from '@/app/_discovery/commands-context';
import { DiscoveryControls, useShellUnread } from '@/app/_discovery/discovery-controls';
import { DemoControls } from '@/app/_demo/controls';
import { useCommands } from '@/app/_discovery/commands-context';
import { ShellNavigation } from '@/app/_shell/navigation';
import { UserMenu } from '@/app/_shell/user-menu';
import { Button, IconButton, InlineAlert } from '@/shared/ui/primitives';
import { Drawer } from '@/shared/ui/drawer';
import { defaultDemo } from '@/features/demo/model';
import { useAppSelector } from '@/app/_providers/hooks';
import {
  SessionIssue,
  SessionProgress,
  useSessionRuntime,
} from '@/app/_providers/session-provider';

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
  return (
    <CommandsProvider>
      <IdentityShellContent identity={identity}>{children}</IdentityShellContent>
    </CommandsProvider>
  );
}
function IdentityShellContent({
  identity,
  children,
}: {
  identity: SessionIdentity;
  children: ReactNode;
}) {
  const { coordinator, adapter, state } = useSessionRuntime();
  const pathname = usePathname();
  const router = useRouter();
  const [logoutState, setLogoutState] = useState<'idle' | 'pending'>('idle');
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [navigationRoute, setNavigationRoute] = useState(pathname);
  // A deferred review link uses router.push after the local decision, so its
  // original onNavigate callback cannot close the mobile navigation drawer.
  if (navigationRoute !== pathname) {
    setNavigationRoute(pathname);
    setNavigationOpen(false);
  }
  const [demoOpen, setDemoOpen] = useState(false);
  const commands = useCommands();
  const unread = useShellUnread(identity.userId, identity.workspaceId);
  const demo = useAppSelector((snapshot) => snapshot.demo);
  const simulationActive = (Object.keys(defaultDemo) as (keyof typeof defaultDemo)[]).some(
    (key) => demo[key] !== defaultDemo[key],
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 64rem)');
    const closeMobile = () => {
      if (media.matches) setNavigationOpen(false);
    };
    media.addEventListener('change', closeMobile);
    return () => media.removeEventListener('change', closeMobile);
  }, []);
  const current = useQuery({
    queryKey: currentUserKey(identity.userId, identity.workspaceId),
    queryFn: ({ signal }) =>
      coordinator.request((scoped) => adapter.currentUser(scoped, identity), 'safe-read', signal),
    refetchInterval: 60_000,
  });
  const navigate = () => setNavigationOpen(false);
  const navigation = (
    <ShellNavigation
      pathname={pathname}
      unread={unread.data?.count}
      navigate={navigate}
      openDemo={() => {
        setNavigationOpen(false);
        setDemoOpen(true);
      }}
    />
  );
  return (
    <div className="app-shell">
      <header className="shell-topbar">
        <IconButton
          label="Open navigation"
          className="shell-mobile-trigger"
          aria-expanded={navigationOpen}
          onClick={() => setNavigationOpen(true)}
        >
          <Menu size={20} aria-hidden="true" />
        </IconButton>
        <Link
          className="shell-brand"
          href="/app/incidents"
          aria-label="Incident Room"
          onNavigate={navigate}
        >
          <svg className="shell-brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M9 5h11M9 19h11M2 12h12M14 5v14"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
            <circle cx="14" cy="12" r="2.5" fill="currentColor" />
          </svg>
          <span className="shell-brand-name">Incident Room</span>
        </Link>
        <span className="shell-workspace">Orbit Workshop</span>
        <div className="shell-actions">
          <DiscoveryControls
            userId={identity.userId}
            workspaceId={identity.workspaceId}
            unreadCount={unread.data?.count}
          />
          {current.data && (
            <UserMenu
              name={current.data.name}
              role={current.data.role}
              userId={identity.userId}
              pending={logoutState === 'pending'}
              logout={async () => {
                if (!(await (commands?.canLeave() ?? Promise.resolve(true)))) return;
                setLogoutState('pending');
                void coordinator
                  .logout()
                  .then(() => router.replace('/login'))
                  .catch(() => router.replace('/login?reason=logout-failed'));
              }}
            />
          )}
        </div>
      </header>
      <div className="shell-grid">
        <aside className="shell-sidebar">{navigation}</aside>
        <main id="main-content" tabIndex={-1} className="shell-content">
          <div className="shell-notices">
            {state.status === 'refreshing' && (
              <p role="status" className="shell-session-status">
                Refreshing your session…
              </p>
            )}
            {simulationActive && (
              <Button
                variant="quiet"
                className="shell-simulation"
                onClick={() => setDemoOpen(true)}
              >
                <FlaskConical size={16} aria-hidden="true" />
                Simulation active
              </Button>
            )}
            {current.isError && (
              <InlineAlert>
                <p>Unable to load your profile.</p>
                <Button variant="quiet" onClick={() => void current.refetch()}>
                  Retry profile
                </Button>
              </InlineAlert>
            )}
            {commands?.readNotice && (
              <InlineAlert>
                Read state was not saved. {commands.readNotice} Navigation is still available; retry
                from the inbox.{' '}
                <Button variant="quiet" onClick={commands.dismissReadNotice}>
                  Dismiss read notice
                </Button>
              </InlineAlert>
            )}
          </div>
          {children}
        </main>
      </div>
      <Drawer
        open={navigationOpen}
        close={() => setNavigationOpen(false)}
        title="Navigation"
        side="left"
        description="Orbit Workshop · Fictional workspace"
      >
        {navigation}
      </Drawer>
      <Drawer
        open={demoOpen}
        close={() => setDemoOpen(false)}
        title="Demo tools"
        description="Tab-local fictional simulations. Reload restores defaults."
      >
        <DemoControls />
      </Drawer>
    </div>
  );
}
