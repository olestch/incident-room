'use client';
import { Users, ArrowUpRight } from 'lucide-react';
import { Avatar, Badge, Button, InlineAlert } from '@/shared/ui/primitives';
import { EmptyState, RowSkeletons } from '@/shared/ui/secondary-feedback';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { workspaceUsersKey, workspaceUsersSchema } from '@/entities/current-user/model';
import { useSessionRuntime } from '@/app/_providers/session-provider';
export function TeamPage() {
  const { coordinator, adapter, state } = useSessionRuntime();
  const identity = 'identity' in state ? state.identity : null;
  const users = useQuery({
    queryKey: workspaceUsersKey(identity?.userId ?? '', identity?.workspaceId ?? ''),
    enabled: !!identity,
    queryFn: ({ signal }) =>
      coordinator.request(
        (s) => adapter.resource('/workspace-users', workspaceUsersSchema, s),
        'safe-read',
        signal,
      ),
  });
  return (
    <section aria-label="Workspace team" className="secondary-page utility-page">
      <header className="secondary-page-header">
        <p className="secondary-eyebrow">Workspace directory</p>
        <h1>Team</h1>
        <p>Fictional workspace directory. Account status is not realtime presence.</p>
      </header>
      <div className="secondary-surface">
        {users.isPending && <RowSkeletons label="Loading team…" />}
        {users.isError && (
          <InlineAlert>
            Team unavailable. <Button onClick={() => void users.refetch()}>Retry Team</Button>
          </InlineAlert>
        )}
        {users.data &&
          !users.isError &&
          !users.data.some((user) => user.workspaceId === identity?.workspaceId) && (
            <EmptyState icon={Users} title="No workspace profiles">
              <p>The directory has no accounts to show.</p>
            </EmptyState>
          )}
        <ul className="team-directory" aria-label="Workspace members">
          {users.data
            ?.filter((u) => u.workspaceId === identity?.workspaceId)
            .map((user) => (
              <li key={user.id} className="team-row">
                <Avatar name={user.name} />
                <div className="team-identity">
                  <Link
                    className="team-profile-link"
                    href={`/app/profile/${encodeURIComponent(user.id)}`}
                  >
                    {user.name}
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </Link>
                  <p>{user.role === 'admin' ? 'Admin' : 'Member'}</p>
                </div>
                <Badge
                  className={
                    user.status === 'deactivated' ? 'account-deactivated' : 'account-active'
                  }
                >
                  {user.status === 'active' ? 'Active account' : 'Deactivated account'}
                </Badge>
              </li>
            ))}
        </ul>
      </div>
    </section>
  );
}
