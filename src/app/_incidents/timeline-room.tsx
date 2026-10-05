'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import type { CurrentUser, WorkspaceUser } from '@/entities/current-user/model';
import type { Incident } from '@/entities/incident/model';
import { incidentKeys } from '@/entities/incident/model';
import { canWriteIncident } from '@/entities/incident/policy';
import {
  locatorSchema,
  outcomeSchema,
  timelineEntrySchema,
  timelineKeys,
  timelineWindowSchema,
  mergeEntries,
  type TimelineEntry,
  type TimelineWindow,
} from '@/entities/timeline/model';
import { DeliveryCoordinator } from '@/features/timeline/delivery';
import { TimelineProjection } from '@/features/timeline/projection';
import { TimelineCompose, TimelineList } from '@/features/timeline/views';
import { TargetNavigation, type TimelineViewport } from '@/features/timeline/target-navigation';
import type { OutboxRecord } from '@/features/timeline/local-work';
import { localWorkChanged } from '@/features/timeline/coordination-slice';
import { AppError } from '@/shared/errors/app-error';
import { useAppDispatch } from '@/app/_providers/hooks';
import { useLocalWork, useSessionRuntime } from '@/app/_providers/session-provider';

export function TimelineRoom({
  incident,
  actor,
  users,
}: {
  incident: Incident;
  actor: CurrentUser;
  users: WorkspaceUser[];
}) {
  const { coordinator, adapter } = useSessionRuntime();
  const work = useLocalWork();
  const cache = useQueryClient();
  const dispatch = useAppDispatch();
  const params = useSearchParams();
  const router = useRouter();
  const target = params.get('event');
  const scope = useMemo(
    () => ({ userId: actor.id, workspaceId: actor.workspaceId, incidentId: incident.id }),
    [actor.id, actor.workspaceId, incident.id],
  );
  const lease = useMemo(() => work.lease(scope), [scope, work]);
  const key = timelineKeys.history(actor.id, actor.workspaceId, incident.id);
  const ackKey = timelineKeys.acknowledgments(actor.id, actor.workspaceId, incident.id);
  const root = `/incidents/${encodeURIComponent(incident.number)}/timeline`;
  const windowSchema = useMemo(
    () =>
      timelineWindowSchema.refine((window) =>
        window.items.every((entry) => entry.incidentId === incident.id),
      ),
    [incident.id],
  );
  const [records, setRecords] = useState<OutboxRecord[]>([]);
  const [body, setBody] = useState('');
  const latestBody = useRef('');
  const dirty = useRef(false);
  const preparing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [windowIds, setWindowIds] = useState<string[]>([]);
  const [navigationStatus, setNavigationStatus] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [targetAttempt, setTargetAttempt] = useState(0);
  const viewport = useRef<TimelineViewport>(null);
  const [navigation] = useState(() => new TargetNavigation());
  const [projection] = useState(() => new TimelineProjection());
  const acknowledge = useCallback(
    (entry: TimelineEntry) => {
      cache.setQueryData<TimelineEntry[]>(
        timelineKeys.acknowledgments(scope.userId, scope.workspaceId, scope.incidentId),
        (previous = []) => [
          ...mergeEntries(new Map(previous.map((record) => [record.id, record])), [entry]).values(),
        ],
      );
      void cache.invalidateQueries({ queryKey: incidentKeys.all(scope.userId, scope.workspaceId) });
    },
    [cache, scope],
  );
  const delivery = useMemo(
    () =>
      new DeliveryCoordinator(work, lease, {
        changed: (value) => {
          setRecords(value);
          dispatch(
            localWorkChanged({
              scope: JSON.stringify(scope),
              ids: value.map((record) => record.clientMutationId),
              states: value.map((record) => record.state),
            }),
          );
        },
        confirmed: acknowledge,
        rejected: () => {
          void cache.invalidateQueries({
            queryKey: incidentKeys.all(scope.userId, scope.workspaceId),
          });
        },
        create: (record, signal) =>
          coordinator.request(
            (requestSignal) =>
              adapter.resource(root, timelineEntrySchema, requestSignal, {
                body: record.body,
                clientMutationId: record.clientMutationId,
              }),
            'mutation',
            signal,
          ),
        lookup: (id, signal) =>
          coordinator.request(
            (requestSignal) =>
              adapter.resource(
                `${root}/outcome?mutation=${encodeURIComponent(id)}`,
                outcomeSchema,
                requestSignal,
              ),
            'safe-read',
            signal,
          ),
      }),
    [work, lease, dispatch, scope, acknowledge, coordinator, adapter, root, cache],
  );
  const history = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      coordinator.request(
        (s) =>
          adapter.resource(
            `${root}${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
            windowSchema,
            s,
          ),
        'safe-read',
        signal,
      ),
    getNextPageParam: (page) => page.olderCursor,
  });
  const acknowledgments = useQuery({
    queryKey: ackKey,
    queryFn: () => Promise.resolve([] as TimelineEntry[]),
    enabled: false,
    initialData: [] as TimelineEntry[],
  });
  const combineWindows = useCallback(
    (results: UseQueryResult<TimelineWindow | null>[]) =>
      results.flatMap((query) => (query.data ? [query.data] : [])),
    [],
  );
  const targetWindows = useQueries({
    queries: windowIds.map((id) => ({
      queryKey: timelineKeys.target(actor.id, actor.workspaceId, incident.id, id),
      queryFn: () => Promise.resolve(null as TimelineWindow | null),
      enabled: false,
    })),
    combine: combineWindows,
  });
  const windows = useMemo(
    () => [...(history.data?.pages ?? []), ...targetWindows],
    [history.data, targetWindows],
  );
  const rows = useMemo(
    () => projection.build(windows, acknowledgments.data, records),
    [projection, windows, acknowledgments.data, records],
  );
  useEffect(() => {
    const ids = new Set(records.map((record) => record.clientMutationId));
    for (const window of windows)
      for (const entry of window.items)
        if (
          entry.type === 'human_message' &&
          entry.originatingClientMutationId &&
          ids.has(entry.originatingClientMutationId)
        )
          void delivery
            .acknowledge(entry)
            .catch(() =>
              setIssue(
                'Confirmation is visible, but local cleanup could not complete. Check browser storage.',
              ),
            );
  }, [windows, records, delivery]);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current || !lease.valid() || preparing.current) return;
    const currentBody = latestBody.current;
    await work.draft(lease, currentBody);
    if (currentBody === latestBody.current) dirty.current = false;
  }, [work, lease]);
  useEffect(() => {
    let active = true;
    const deadline = setTimeout(() => {
      if (active)
        setIssue(
          'Local work restoration is delayed. Check browser storage and reload; no messages will be replayed.',
        );
    }, 12_000);
    void delivery
      .restore()
      .then((draft) => {
        if (active) {
          latestBody.current = draft;
          setBody(draft);
          setReady(true);
        }
      })
      .catch(() => {
        if (active)
          setIssue(
            'Local drafts/outbox could not be restored. Reload after checking browser storage.',
          );
      })
      .finally(() => clearTimeout(deadline));
    const pagehide = () => {
      void flush().catch(() => {});
    };
    window.addEventListener('pagehide', pagehide);
    return () => {
      active = false;
      clearTimeout(deadline);
      delivery.dispose();
      navigation.cancel();
      window.removeEventListener('pagehide', pagehide);
      void flush().catch(() => {});
    };
  }, [delivery, flush, navigation]);
  const loadWindow = useCallback(
    async (id: string, cursor: string, signal?: AbortSignal) => {
      const window = await cache.fetchQuery({
        queryKey: timelineKeys.target(scope.userId, scope.workspaceId, scope.incidentId, id),
        queryFn: ({ signal: querySignal }) =>
          coordinator.request(
            (s) =>
              adapter.resource(`${root}?cursor=${encodeURIComponent(cursor)}`, windowSchema, s),
            'safe-read',
            signal ? AbortSignal.any([signal, querySignal]) : querySignal,
          ),
      });
      signal?.throwIfAborted();
      if (!lease.valid()) throw new DOMException('Session superseded', 'AbortError');
      setWindowIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
      return window;
    },
    [cache, scope, coordinator, adapter, root, windowSchema, lease],
  );
  useEffect(() => {
    if (target === null) {
      navigation.cancel();
      return;
    }
    const port: TimelineViewport = {
      latest: () => viewport.current?.latest(),
      // The viewport accepts an as-yet-uncommitted ID; layout/ref measurement completes readiness.
      reveal: (id, signal) =>
        viewport.current
          ? viewport.current.reveal(id, signal)
          : Promise.reject(new Error('Timeline viewport unavailable')),
    };
    void navigation.navigate(
      target,
      async (signal) => {
        const located = await coordinator.request(
          (s) =>
            adapter.resource(
              `${root}/locate?entry=${encodeURIComponent(target)}`,
              locatorSchema,
              s,
            ),
          'safe-read',
          signal,
        );
        if (located.entryId !== target) throw new Error('Invalid locator');
        const window = await loadWindow(target, located.cursor, signal);
        const entry = window.items.find((entry) => entry.id === target);
        if (!entry) throw new Error('Invalid target window');
        return { deleted: !!entry.tombstone };
      },
      port,
      (status, id) => {
        setNavigationStatus(status);
        setHighlight(id);
      },
    );
    return () => navigation.cancel();
  }, [target, targetAttempt, navigation, coordinator, adapter, root, loadWindow, cache]);
  useEffect(() => {
    if (!highlight) return;
    const timeout = setTimeout(() => setHighlight(null), 8000);
    return () => clearTimeout(timeout);
  }, [highlight]);
  const edit = (value: string) => {
    latestBody.current = value;
    dirty.current = true;
    setBody(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush().catch(() =>
        setIssue('Draft could not be saved. Your text remains in the editor.'),
      );
    }, 250);
  };
  const act = (task: Promise<void>) => {
    void task.catch(() =>
      setIssue('Local work could not be saved. Check browser storage; no message was discarded.'),
    );
  };
  const denied =
    history.error instanceof AppError &&
    ['authentication', 'authorization', 'not-found'].includes(history.error.category);
  const writable = !denied && canWriteIncident(actor, incident);
  return (
    <section aria-labelledby="timeline-heading" className="min-w-0">
      <div className="flex flex-wrap justify-between gap-2 my-3">
        <h2 id="timeline-heading" className="text-xl font-semibold">
          Timeline
        </h2>
        <button
          className="incident-button"
          onClick={() => {
            navigation.cancel();
            const query = new URLSearchParams(params.toString());
            query.delete('event');
            router.replace(
              `${window.location.pathname}${query.size ? `?${query}` : ''}${window.location.hash}`,
              { scroll: false },
            );
            setNavigationStatus('Showing latest Timeline entries.');
            setHighlight(null);
            viewport.current?.latest();
          }}
        >
          Go to latest
        </button>
      </div>
      {navigationStatus && <p role="status">{navigationStatus}</p>}
      {target !== null && !highlight && !navigationStatus.startsWith('Locating') && (
        <button
          className="incident-button"
          onClick={() => setTargetAttempt((attempt) => attempt + 1)}
        >
          Retry target
        </button>
      )}
      {history.isPending && <p role="status">Loading Timeline…</p>}
      {history.isError && (
        <div role="alert">
          <p>
            {denied
              ? history.error instanceof AppError && history.error.category === 'authorization'
                ? 'Timeline access denied.'
                : 'Timeline unavailable.'
              : 'Unable to load Timeline history.'}
          </p>
          <button
            className="incident-button"
            onClick={() =>
              void (history.isFetchNextPageError
                ? history.fetchNextPage({ cancelRefetch: false })
                : history.refetch())
            }
          >
            Retry history
          </button>
        </div>
      )}
      {history.hasNextPage && (
        <button
          className="incident-button my-2"
          disabled={history.isFetching}
          onClick={() => void history.fetchNextPage({ cancelRefetch: false })}
        >
          {history.isFetchingNextPage ? 'Loading older history…' : 'Load older history'}
        </button>
      )}
      {history.data && !history.hasNextPage && (
        <p className="text-sm">Beginning of loaded history</p>
      )}
      {history.data && rows.length === 0 && (
        <p>No Timeline entries yet. The first message will start this incident history.</p>
      )}
      <TimelineList
        ref={viewport}
        rows={denied ? [] : rows}
        users={users}
        highlight={highlight}
        targetActive={target !== null}
        writable={writable}
        retry={(id) => act(delivery.retry(id))}
        check={(id) => act(delivery.check(id))}
        remove={(id) => act(delivery.remove(id))}
        loadGap={(cursor) => {
          void loadWindow(`gap:${cursor}`, cursor).catch(() =>
            setIssue('Unable to load history gap. Try that gap again.'),
          );
        }}
      />
      {!writable && issue && <p role="alert">{issue}</p>}
      <TimelineCompose
        body={body}
        edit={edit}
        users={users}
        ready={ready}
        busy={busy}
        writable={writable}
        resolved={incident.status === 'resolved'}
        issue={issue}
        discard={() => {
          if (timer.current) clearTimeout(timer.current);
          void work
            .draft(lease, '')
            .then(() => {
              latestBody.current = '';
              dirty.current = false;
              setBody('');
              setIssue(null);
            })
            .catch(() => setIssue('Draft could not be discarded.'));
        }}
        send={() => {
          if (preparing.current || busy || !writable) return;
          preparing.current = true;
          setBusy(true);
          setIssue(null);
          if (timer.current) clearTimeout(timer.current);
          void delivery
            .prepare(latestBody.current)
            .then((record) => {
              latestBody.current = '';
              dirty.current = false;
              preparing.current = false;
              setBody('');
              setBusy(false);
              act(delivery.exposeAndSend(record));
            })
            .catch(() => {
              preparing.current = false;
              setBusy(false);
              setIssue(
                'Message could not be saved locally. Your text remains in the editor; nothing was sent.',
              );
            });
        }}
      />
    </section>
  );
}
