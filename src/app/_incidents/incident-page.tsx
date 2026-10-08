'use client';
import Link from 'next/link';
import { Plus, ListFilter, ArrowLeft } from 'lucide-react';
import { Button, InlineAlert } from '@/shared/ui/primitives';
import { IncidentQueueRow, IncidentQueueSkeleton } from '@/features/incident-management/queue-row';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { z } from 'zod';
import {
  currentUserKey,
  workspaceUsersKey,
  workspaceUsersSchema,
} from '@/entities/current-user/model';
import {
  incidentKeys,
  incidentPageSchema,
  incidentSchema,
  type CreateIncidentInput,
} from '@/entities/incident/model';
import { canCreateIncident } from '@/entities/incident/policy';
import {
  emptyFilters,
  parseIncidentFilters,
  serializeIncidentFilters,
  type IncidentFilters,
} from '@/entities/incident/filters';
import { CreateIncidentDialog, IncidentFiltersView } from '@/features/incident-management/views';
import { useSessionRuntime } from '@/app/_providers/session-provider';
import { AppError } from '@/shared/errors/app-error';
import { TimelineRoom } from './timeline-room';
import { useCommands } from '@/app/_discovery/commands-context';
import { PostmortemEntry } from '@/app/_postmortem/entry';
import { IncidentCommandStrip, IncidentDetails } from '@/features/incident-management/room-context';

export function IncidentPage({ number }: { number?: string }) {
  const { state } = useSessionRuntime();
  if (!('identity' in state)) return null;
  return (
    <IdentityIncidentPage
      key={`${state.identity.userId}:${state.generation}`}
      userId={state.identity.userId}
      workspaceId={state.identity.workspaceId}
      {...(number ? { number } : {})}
    />
  );
}
function IdentityIncidentPage({
  userId,
  workspaceId,
  number,
}: {
  userId: string;
  workspaceId: string;
  number?: string;
}) {
  const { coordinator, adapter, state } = useSessionRuntime();
  const router = useRouter();
  const params = useSearchParams();
  const cache = useQueryClient();
  const [creating, setCreating] = useState(false);
  const commands = useCommands();
  useEffect(
    () => (number ? undefined : commands?.registerCreate(() => setCreating(true))),
    [commands, number],
  );
  const current = useQuery({
    queryKey: currentUserKey(userId, workspaceId),
    queryFn: ({ signal }) =>
      coordinator.request(
        (s) => adapter.currentUser(s, 'identity' in state ? state.identity : undefined),
        'safe-read',
        signal,
      ),
  });
  const users = useQuery({
    queryKey: workspaceUsersKey(userId, workspaceId),
    queryFn: ({ signal }) =>
      coordinator.request(
        (s) =>
          adapter.resource(
            '/workspace-users',
            workspaceUsersSchema.refine((records) =>
              records.every((user) => user.workspaceId === workspaceId),
            ),
            s,
          ),
        'safe-read',
        signal,
      ),
  });
  const filters = parseIncidentFilters(
    new URLSearchParams(params.toString()),
    users.data?.filter((u) => u.status === 'active').map((u) => u.id) ?? [],
  );
  const changeFilters = (value: IncidentFilters) => {
    const query = serializeIncidentFilters(value, new URLSearchParams(params.toString()));
    const effective = parseIncidentFilters(
      query,
      users.data?.filter((u) => u.status === 'active').map((u) => u.id) ?? [],
    );
    const key = incidentKeys.list(userId, workspaceId, effective);
    // A changed effective filter starts at page one, even when the target key was cached.
    void cache.cancelQueries({ queryKey: key, exact: true });
    cache.setQueryData<InfiniteData<z.infer<typeof incidentPageSchema>, string | null>>(
      key,
      (previous) =>
        previous
          ? { pages: previous.pages.slice(0, 1), pageParams: previous.pageParams.slice(0, 1) }
          : undefined,
    );
    const search = query.toString();
    router.push(`/app/incidents${search ? `?${search}` : ''}`, { scroll: false });
  };
  const list = useInfiniteQuery({
    queryKey: incidentKeys.list(userId, workspaceId, filters),
    enabled: !number && !!users.data,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) => {
      const query = serializeIncidentFilters(filters);
      if (pageParam) query.set('cursor', pageParam);
      return coordinator.request(
        (s) =>
          adapter.resource(
            `/incidents?${query}`,
            incidentPageSchema.refine((page) =>
              page.items.every((incident) => incident.workspaceId === workspaceId),
            ),
            s,
          ),
        'safe-read',
        signal,
      );
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  const detail = useQuery({
    queryKey: incidentKeys.detail(userId, workspaceId, number ?? ''),
    enabled: !!number,
    queryFn: ({ signal }) =>
      coordinator
        .request(
          (s) =>
            adapter.resource(
              `/incidents/${encodeURIComponent(number!)}`,
              incidentSchema.refine((incident) => incident.workspaceId === workspaceId),
              s,
            ),
          'safe-read',
          signal,
        )
        .then((incident) => {
          const previous = cache.getQueryData<z.infer<typeof incidentSchema>>(
            incidentKeys.detail(userId, workspaceId, number!),
          );
          return previous && previous.revision > incident.revision ? previous : incident;
        }),
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: ({ input, requestId }: { input: CreateIncidentInput; requestId: string }) =>
      coordinator.request(
        (s) =>
          adapter.resource(
            '/incidents',
            incidentSchema.refine(
              (incident) => incident.workspaceId === workspaceId && incident.commanderId === userId,
            ),
            s,
            { input, requestId },
          ),
        'mutation',
      ),
    onSuccess: async (incident) => {
      const stillCurrent = () => {
        const snapshot = coordinator.snapshot();
        return (
          'identity' in snapshot &&
          snapshot.generation === state.generation &&
          snapshot.identity.userId === userId &&
          snapshot.identity.workspaceId === workspaceId
        );
      };
      if (!stillCurrent()) return;
      cache.setQueryData(incidentKeys.detail(userId, workspaceId, incident.number), incident);
      await cache.invalidateQueries({ queryKey: incidentKeys.lists(userId, workspaceId) });
      if (!stillCurrent()) return;
      setCreating(false);
      router.push(`/app/incidents/${incident.number}`);
    },
  });
  const hasContext = !!detail.data && !!users.data;
  useEffect(() => {
    if (!number) return;
    const content = document.getElementById('main-content');
    const viewport = window.visualViewport;
    if (!content) return;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      const shellAbove = Math.max(
        0,
        content.getBoundingClientRect().top - (viewport?.offsetTop ?? 0),
      );
      content.style.setProperty('--room-viewport-height', `${height}px`);
      content.style.setProperty('--room-viewport-offset', `${viewport?.offsetTop ?? 0}px`);
      content.style.setProperty('--room-available-height', `${Math.max(0, height - shellAbove)}px`);
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    const header = document.querySelector('.shell-topbar');
    if (header) observer?.observe(header);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
      content.style.removeProperty('--room-viewport-height');
      content.style.removeProperty('--room-viewport-offset');
      content.style.removeProperty('--room-available-height');
    };
  }, [number]);
  useEffect(() => {
    if (number && hasContext)
      document.getElementById('incident-heading')?.focus({ preventScroll: true });
  }, [number, hasContext]);
  const errorView = (error: Error, retry: () => void) => (
    <div role="alert" className="my-4">
      <p>
        {error instanceof AppError && error.category === 'not-found'
          ? 'Incident not found.'
          : error instanceof AppError && error.category === 'authorization'
            ? 'Access denied.'
            : 'Unable to load incident data.'}
      </p>
      {!(error instanceof AppError && ['not-found', 'authorization'].includes(error.category)) && (
        <button className="incident-button mt-3" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  );
  const inaccessible = (error: Error | null) =>
    error instanceof AppError &&
    ['authentication', 'authorization', 'not-found'].includes(error.category);
  if (number)
    return (
      <section aria-label="Incident detail" className="incident-room">
        <div className="incident-room-layout">
          <div
            className="room-context-panel"
            role="region"
            tabIndex={0}
            aria-label="Incident context panel"
          >
            <Link
              className="ui-button ui-button-quiet room-back"
              href="/app/incidents"
              aria-label="Back to incidents"
              title="Back to incidents"
            >
              <ArrowLeft size={16} aria-hidden="true" />{' '}
              <span className="room-back-label">Back to incidents</span>
              <span className="room-back-mobile-label">Back to list</span>
            </Link>
            <div className="room-loading">
              {(detail.isPending || (detail.data && users.isPending)) && (
                <p role="status">Loading incident…</p>
              )}
              {detail.isError && errorView(detail.error, () => void detail.refetch())}
              {users.isError && errorView(users.error, () => void users.refetch())}
              {detail.data &&
                users.data &&
                !inaccessible(detail.error) &&
                !inaccessible(users.error) && (
                  <IncidentCommandStrip incident={detail.data} users={users.data} />
                )}
            </div>
            {detail.data &&
              users.data &&
              !inaccessible(detail.error) &&
              !inaccessible(users.error) && (
                <IncidentDetails
                  incident={detail.data}
                  users={users.data}
                  threadOpen={params.get('thread') !== null}
                >
                  {current.data && <PostmortemEntry incident={detail.data} actor={current.data} />}
                </IncidentDetails>
              )}
          </div>
          {detail.data &&
            users.data &&
            current.data &&
            !inaccessible(detail.error) &&
            !inaccessible(users.error) && (
              <TimelineRoom
                key={detail.data.id}
                incident={detail.data}
                actor={current.data}
                users={users.data}
              />
            )}
        </div>
      </section>
    );
  const listErrorView = (error: Error, retry: () => void) => (
    <div className="queue-error">
      <InlineAlert>
        <p>
          {error instanceof AppError && error.category === 'authorization'
            ? 'Access denied.'
            : 'Unable to load incident data.'}
        </p>
        {!(
          error instanceof AppError && ['not-found', 'authorization'].includes(error.category)
        ) && <Button onClick={retry}>Retry</Button>}
      </InlineAlert>
    </div>
  );
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const total = list.data?.pages[0]?.total;
  return (
    <section aria-label="Incident list" className="incident-list">
      <div className="discovery-header">
        <div>
          <h1 className="text-page font-semibold">Incidents</h1>
          <p className="discovery-description">Track service impact and coordinate a response.</p>
        </div>
        {current.data && canCreateIncident(current.data, workspaceId) && (
          <Button
            variant="primary"
            aria-label="Create Incident"
            disabled={!users.data}
            onClick={() => setCreating(true)}
          >
            <Plus size={17} aria-hidden="true" />{' '}
            <span>
              Create<span className="create-incident-suffix"> Incident</span>
            </span>
          </Button>
        )}
      </div>
      <IncidentFiltersView filters={filters} users={users.data ?? []} change={changeFilters} />
      {(users.isPending || (!!users.data && list.isPending && !list.isError)) && (
        <IncidentQueueSkeleton />
      )}
      {users.isError && listErrorView(users.error, () => void users.refetch())}
      {list.isError &&
        listErrorView(
          list.error,
          () => void (list.isFetchNextPageError ? list.fetchNextPage() : list.refetch()),
        )}
      {list.data && !inaccessible(list.error) && !inaccessible(users.error) && (
        <>
          <p role="status" className="queue-count">
            {list.isFetchingNextPage
              ? 'Loading more incidents…'
              : list.isFetching
                ? 'Refreshing incidents…'
                : `${rows.length} of ${total} incidents`}
          </p>
          {rows.length === 0 && (
            <div className="queue-empty">
              <ListFilter size={24} aria-hidden="true" />
              <h2 className="text-section font-semibold">
                {list.data.pages[0]?.workspaceTotal === 0
                  ? 'No incidents yet'
                  : 'No incidents match your filters'}
              </h2>
              <p>
                {list.data.pages[0]?.workspaceTotal === 0
                  ? 'Create an incident to start coordinating a response.'
                  : 'Try removing a filter or widening the created date range.'}
              </p>
              {list.data.pages[0]?.workspaceTotal !== 0 && (
                <Button onClick={() => changeFilters({ ...emptyFilters, sort: filters.sort })}>
                  Clear filters and show incidents
                </Button>
              )}
            </div>
          )}
          <ul className="incident-queue" aria-label="Incidents">
            {rows.map((incident) => (
              <IncidentQueueRow key={incident.id} incident={incident} users={users.data ?? []} />
            ))}
          </ul>
          {list.hasNextPage && (
            <Button
              className="queue-load-more"
              disabled={list.isFetching}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? 'Loading more incidents…' : 'Load more'}
            </Button>
          )}
          {rows.length > 0 && !list.hasNextPage && (
            <p className="queue-end">All {total} matching incidents loaded.</p>
          )}
        </>
      )}
      {creating && users.data && (
        <CreateIncidentDialog
          users={users.data}
          creatorId={userId}
          close={() => setCreating(false)}
          submit={async (input, requestId) => {
            await mutation.mutateAsync({ input, requestId });
          }}
        />
      )}
    </section>
  );
}
