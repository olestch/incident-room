'use client';
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
    <section aria-label="Workspace team">
      <h1 className="text-3xl font-semibold">Team</h1>
      <p className="mt-2 text-muted">
        Fictional workspace directory. Account status is not realtime presence.
      </p>
      {users.isPending && <p role="status">Loading team…</p>}
      {users.isError && (
        <div role="alert">
          Team unavailable.{' '}
          <button className="incident-button" onClick={() => void users.refetch()}>
            Retry Team
          </button>
        </div>
      )}
      <ul className="mt-4 space-y-3">
        {users.data
          ?.filter((u) => u.workspaceId === identity?.workspaceId)
          .map((user) => (
            <li key={user.id} className="rounded-lg border border-line p-4">
              <Link
                className="font-semibold underline"
                href={`/app/profile/${encodeURIComponent(user.id)}`}
              >
                {user.name}
              </Link>
              <p>
                {user.role} · {user.status}
              </p>
            </li>
          ))}
      </ul>
    </section>
  );
}
