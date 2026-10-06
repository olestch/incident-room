'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { workspaceUsersKey, workspaceUsersSchema } from '@/entities/current-user/model';
import { useSessionRuntime } from '@/app/_providers/session-provider';
export function ProfilePage({ userId }: { userId: string }) {
  const { state } = useSessionRuntime();
  if (!('identity' in state)) return null;
  return (
    <IdentityProfile
      key={`${state.generation}:${state.identity.userId}`}
      userId={userId}
      viewer={state.identity.userId}
      workspace={state.identity.workspaceId}
    />
  );
}
function IdentityProfile({
  userId,
  viewer,
  workspace,
}: {
  userId: string;
  viewer: string;
  workspace: string;
}) {
  const { coordinator, adapter } = useSessionRuntime();
  const query = useQuery({
    queryKey: workspaceUsersKey(viewer, workspace),
    queryFn: ({ signal }) =>
      coordinator.request(
        (s) => adapter.resource('/workspace-users', workspaceUsersSchema, s),
        'safe-read',
        signal,
      ),
  });
  if (query.isLoading) return <p role="status">Loading workspace profile…</p>;
  if (query.isError)
    return (
      <div role="alert">
        Profile unavailable.{' '}
        <button className="underline" onClick={() => void query.refetch()}>
          Retry Profile
        </button>
      </div>
    );
  const user = query.data?.find((user) => user.id === userId && user.workspaceId === workspace);
  if (!user) return <p role="alert">Profile unavailable in your workspace.</p>;
  return (
    <section aria-label="Workspace profile">
      <h1 className="text-3xl font-semibold">{user.name}</h1>
      <span
        aria-hidden="true"
        className="my-3 inline-flex size-12 items-center justify-center rounded-full border border-line"
      >
        {user.name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join('')}
      </span>
      <p>
        {user.role} · {user.status}
      </p>
      {user.status === 'active' && (
        <Link
          className="mt-4 block underline"
          href={`/app/incidents?${new URLSearchParams({ participant: user.id })}`}
        >
          View accessible incidents involving {user.name}
        </Link>
      )}
    </section>
  );
}
