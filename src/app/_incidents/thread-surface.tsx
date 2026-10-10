'use client';
import { useCommands } from '@/app/_discovery/commands-context';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import type { CurrentUser, WorkspaceUser } from '@/entities/current-user/model';
import { incidentKeys, type Incident } from '@/entities/incident/model';
import { canWriteIncident } from '@/entities/incident/policy';
import { locatorSchema, timelineWindowSchema, type TimelineEntry } from '@/entities/timeline/model';
import {
  threadKeys,
  threadMessageSchema,
  threadOutcomeSchema,
  threadWindowSchema,
  mergeMessages,
  type ThreadMessage,
  type ThreadWindow,
} from '@/entities/thread/model';
import { threadHref } from '@/entities/thread/navigation';
import { ThreadDelivery } from '@/features/threads/delivery';
import { useMessageDelivery } from '@/shared/messaging/use-message-delivery';
import { ThreadProjection } from '@/features/threads/projection';
import { PendingReply, ReplyReference, ThreadMessageContent } from '@/features/threads/views';
import type { PresenceMember } from '@/features/realtime/protocol';
import type { ConnectionStatus } from '@/features/realtime/connection-slice';
import { TargetNavigation, type TimelineViewport } from '@/shared/messaging/target-navigation';
import type { OutboxRecord } from '@/shared/messaging/local-work';
import { MeasuredStream } from '@/shared/ui/measured-stream';
import { StreamCompose } from '@/shared/ui/stream-compose';
import { AppError } from '@/shared/errors/app-error';
import { useLocalWork, useSessionRuntime } from '@/app/_providers/session-provider';
import { ThreadRootPreview } from '@/features/timeline/views';
import { MessageSquare, X, Radio, WifiOff, Command, RotateCcw } from 'lucide-react';
import type { ActiveThreadPort } from './use-room-realtime';
import { hasAcquiredThreadMessage } from './thread-cache';

export function ThreadSurface({
  root,
  incident,
  actor,
  users,
  members,
  threadPortRef,
  typing,
  close,
  viewRoot,
  status,
  retryConnection,
}: {
  root: string;
  incident: Incident;
  actor: CurrentUser;
  users: WorkspaceUser[];
  members: PresenceMember[];
  threadPortRef: RefObject<ActiveThreadPort | null>;
  typing(value: boolean, root?: string): void;
  close(): void;
  viewRoot(): void;
  status: ConnectionStatus;
  retryConnection(): void;
}) {
  const { coordinator, adapter } = useSessionRuntime();
  const work = useLocalWork();
  const cache = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const target = params.get('message');
  const scope = useMemo(
    () => ({
      userId: actor.id,
      workspaceId: actor.workspaceId,
      incidentId: incident.id,
      rootTimelineEntryId: root,
    }),
    [actor.id, actor.workspaceId, incident.id, root],
  );
  const lease = useMemo(() => work.lease(scope), [work, scope]);
  const api = `/incidents/${incident.number}/threads/${encodeURIComponent(root)}`;
  const key = threadKeys.history(actor.id, actor.workspaceId, incident.id, root);
  const ackKey = threadKeys.acknowledgments(actor.id, actor.workspaceId, incident.id, root);
  const [records, setRecords] = useState<OutboxRecord[]>([]);
  const [arrivals, setArrivals] = useState<string[]>([]);
  const created = useCallback((message: ThreadMessage) => {
    setArrivals((previous) =>
      previous.includes(message.id) ? previous : [...previous, message.id],
    );
  }, []);
  const [body, setBody] = useState('');
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const latest = useRef({ body: '', replyToMessageId: null as string | null });
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
  const surface = useRef<HTMLElement>(null);
  const [navigation] = useState(() => new TargetNavigation('Thread'));
  const [projection] = useState(() => new ThreadProjection());
  const read = useCallback(
    <T,>(path: string, schema: z.ZodType<T>, signal: AbortSignal) =>
      coordinator.request((s) => adapter.resource(path, schema, s), 'safe-read', signal),
    [coordinator, adapter],
  );
  const rootQuery = useQuery({
    queryKey: [...threadKeys.all(actor.id, actor.workspaceId, incident.id, root), 'root'],
    queryFn: async ({ signal }) => {
      const located = await read(
        `/incidents/${incident.number}/timeline/locate?entry=${encodeURIComponent(root)}`,
        locatorSchema,
        signal,
      );
      if (located.entryId !== root) throw new Error('Invalid root locator');
      const window = await read(
        `/incidents/${incident.number}/timeline?cursor=${encodeURIComponent(located.cursor)}`,
        timelineWindowSchema,
        signal,
      );
      const entry = window.items.find((e) => e.id === root && e.incidentId === incident.id);
      if (!entry) throw new AppError('not-found', 'Thread root unavailable.', 404);
      const previous = cache.getQueryData<TimelineEntry>([
        ...threadKeys.all(actor.id, actor.workspaceId, incident.id, root),
        'root',
      ]);
      return previous &&
        (previous.revision > entry.revision ||
          (previous.revision === entry.revision && previous.tombstone))
        ? previous
        : entry;
    },
  });
  const messageSchema = useMemo(
    () =>
      threadMessageSchema.refine(
        (m) =>
          m.workspaceId === actor.workspaceId &&
          m.incidentId === incident.id &&
          m.rootTimelineEntryId === root,
      ),
    [actor.workspaceId, incident.id, root],
  );
  const windowSchema = useMemo(
    () =>
      threadWindowSchema.refine((w) => w.items.every((m) => messageSchema.safeParse(m).success)),
    [messageSchema],
  );
  const acknowledge = useCallback(
    (message: ThreadMessage) => {
      const existed = hasAcquiredThreadMessage(
        cache,
        threadKeys.all(scope.userId, scope.workspaceId, scope.incidentId, root),
        message.id,
      );
      cache.setQueryData<ThreadMessage[]>(
        threadKeys.acknowledgments(scope.userId, scope.workspaceId, scope.incidentId, root),
        (previous = []) => [
          ...mergeMessages(new Map(previous.map((m) => [m.id, m])), [message]).values(),
        ],
      );
      void cache.invalidateQueries({
        queryKey: threadKeys.summary(scope.userId, scope.workspaceId, scope.incidentId, root),
      });
      if (!existed) created(message);
    },
    [cache, scope, root, created],
  );
  const createDelivery = useCallback(
    () =>
      new ThreadDelivery(work, lease, {
        changed: setRecords,
        confirmed: acknowledge,
        rejected: () => {
          void cache.invalidateQueries({
            queryKey: incidentKeys.all(scope.userId, scope.workspaceId),
          });
        },
        create: (record, signal) =>
          coordinator.request(
            (s) =>
              adapter.resource(`${api}/messages`, messageSchema, s, {
                body: record.body,
                clientMutationId: record.clientMutationId,
                replyToMessageId: record.replyToMessageId ?? null,
              }),
            'mutation',
            signal,
          ),
        lookup: (id, signal) =>
          read(
            `${api}/outcome?mutation=${encodeURIComponent(id)}`,
            threadOutcomeSchema.refine(
              (outcome) =>
                outcome.status === 'missing' || messageSchema.safeParse(outcome.entry).success,
            ),
            signal,
          ),
      }),
    [work, lease, acknowledge, cache, scope, coordinator, adapter, api, messageSchema, read],
  );
  const delivery = useMessageDelivery(createDelivery);
  const history = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      read(
        `${api}/messages${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
        windowSchema,
        signal,
      ),
    getNextPageParam: (page) => page.olderCursor,
    enabled: rootQuery.isSuccess,
  });
  const acks = useQuery({
    queryKey: ackKey,
    queryFn: () => Promise.resolve([] as ThreadMessage[]),
    enabled: false,
    initialData: [] as ThreadMessage[],
  });
  const combine = useCallback(
    (results: UseQueryResult<ThreadWindow | null>[]) =>
      results.flatMap((q) => (q.data ? [q.data] : [])),
    [],
  );
  const targets = useQueries({
    queries: windowIds.map((id) => ({
      queryKey: threadKeys.target(actor.id, actor.workspaceId, incident.id, root, id),
      queryFn: () => Promise.resolve(null as ThreadWindow | null),
      enabled: false,
    })),
    combine,
  });
  const windows = useMemo(
    () => [...(history.data?.pages ?? []), ...targets],
    [history.data, targets],
  );
  const rows = useMemo(
    () => projection.build(windows, acks.data, records),
    [projection, windows, acks.data, records],
  );
  const index = useMemo(
    () => new Map(rows.flatMap((row) => (row.entry ? [[row.entry.id, row.entry] as const] : []))),
    [rows],
  );
  const loadedIndex = useRef(index);
  useEffect(() => {
    loadedIndex.current = index;
  }, [index]);
  useEffect(() => {
    if (!rootQuery.isSuccess) return;
    const active: ActiveThreadPort = {
      root,
      loadedIds: () => [...loadedIndex.current.keys()],
      acknowledge: (m) => delivery.acknowledge(m),
      created,
    };
    threadPortRef.current = active;
    return () => {
      if (threadPortRef.current === active) threadPortRef.current = null;
    };
  }, [threadPortRef, root, delivery, rootQuery.isSuccess, created]);
  useEffect(() => {
    for (const message of index.values())
      void delivery
        .acknowledge(message)
        .catch(() => setIssue('Confirmation is visible; local cleanup failed. Check storage.'));
  }, [index, delivery]);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current || !lease.valid() || preparing.current) return;
    const current = latest.current;
    await work.draft(lease, current.body, current.replyToMessageId);
    if (current === latest.current) dirty.current = false;
  }, [work, lease]);
  useEffect(() => {
    let active = true;
    const deadline = setTimeout(() => {
      if (active)
        setIssue(
          'Local Thread restoration is delayed. Reload after checking storage; replies are never replayed automatically.',
        );
    }, 12000);
    void (async () => {
      const draft = await work.read(lease);
      await delivery.restore();
      if (active) {
        latest.current = { body: draft.draft, replyToMessageId: draft.replyToMessageId };
        setBody(draft.draft);
        setReplyTarget(draft.replyToMessageId);
        setReady(true);
      }
    })()
      .catch(() => {
        if (active)
          setIssue('Thread drafts/outbox could not be restored. Check browser storage and reload.');
      })
      .finally(() => clearTimeout(deadline));
    const pagehide = () => {
      void flush().catch(() => {});
    };
    window.addEventListener('pagehide', pagehide);
    surface.current
      ?.querySelector<HTMLButtonElement>('[data-thread-close]')
      ?.focus({ preventScroll: true });
    return () => {
      active = false;
      clearTimeout(deadline);
      navigation.cancel();
      typing(false, root);
      window.removeEventListener('pagehide', pagehide);
      void flush().catch(() => {});
    };
  }, [work, lease, delivery, navigation, flush, typing, root]);
  const loadWindow = useCallback(
    async (id: string, cursor: string, signal?: AbortSignal) => {
      const window = await cache.fetchQuery({
        queryKey: threadKeys.target(scope.userId, scope.workspaceId, scope.incidentId, root, id),
        queryFn: ({ signal: querySignal }) =>
          read(
            `${api}/messages?cursor=${encodeURIComponent(cursor)}`,
            windowSchema,
            signal ? AbortSignal.any([signal, querySignal]) : querySignal,
          ),
      });
      signal?.throwIfAborted();
      if (!lease.valid()) throw new DOMException('Thread superseded', 'AbortError');
      setWindowIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
      return window;
    },
    [cache, scope, root, read, api, windowSchema, lease],
  );
  useEffect(() => {
    if (target === null || !rootQuery.isSuccess) {
      navigation.cancel();
      return;
    }
    void navigation.navigate(
      target,
      async (signal) => {
        const located = await read(
          `${api}/locate?message=${encodeURIComponent(target)}`,
          locatorSchema,
          signal,
        );
        if (located.entryId !== target) throw new Error('Invalid Thread locator');
        const window = await loadWindow(target, located.cursor, signal);
        const message = window.items.find((m) => m.id === target);
        if (!message) throw new Error('Invalid Thread target window');
        return { deleted: !!message.tombstone };
      },
      {
        latest: () => viewport.current?.latest(),
        reveal: (id, signal) =>
          viewport.current
            ? viewport.current.reveal(id, signal)
            : Promise.reject(new Error('Thread viewport unavailable')),
      },
      (status, id) => {
        setNavigationStatus(status);
        setHighlight(id);
      },
    );
    return () => {
      navigation.cancel();
    };
  }, [target, targetAttempt, rootQuery.isSuccess, navigation, read, api, loadWindow]);
  useEffect(() => {
    if (!highlight) return;
    const timeout = setTimeout(() => setHighlight(null), 8000);
    return () => clearTimeout(timeout);
  }, [highlight]);
  const edit = (value: string, target = latest.current.replyToMessageId) => {
    latest.current = { body: value, replyToMessageId: target };
    dirty.current = true;
    setBody(value);
    setReplyTarget(target);
    typing(value.trim().length > 0, root);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush().catch(() =>
        setIssue('Draft and reply target could not be saved. They remain in the editor.'),
      );
    }, 250);
  };
  const act = (task: Promise<unknown>) => {
    void task.catch(() => setIssue('Local Thread work could not be saved; nothing was discarded.'));
  };
  const denied = [rootQuery.error, history.error].some(
    (error) =>
      error instanceof AppError &&
      ['authentication', 'authorization', 'not-found'].includes(error.category),
  );
  const writable =
    rootQuery.isSuccess && history.isSuccess && !denied && canWriteIncident(actor, incident);
  const navigate = (id: string) =>
    router.push(threadHref(new URL(window.location.href), root, id), { scroll: false });
  const goLatest = () => {
    navigation.cancel();
    router.replace(threadHref(new URL(window.location.href), root), { scroll: false });
    setHighlight(null);
    setNavigationStatus('Showing latest Thread replies.');
    viewport.current?.latest();
  };
  const closeSafely = useCallback(() => {
    typing(false, root);
    void flush()
      .then(close)
      .catch(() =>
        setIssue(
          'Draft could not be saved before closing. Your text and reply target remain here.',
        ),
      );
  }, [typing, root, flush, close]);
  const appCommands = useCommands();
  useEffect(() => appCommands?.registerThread(closeSafely), [appCommands, closeSafely]);
  const typers = [
    ...new Set(
      members
        .filter((m) => m.userId !== actor.id && m.typingUntil > 0 && m.typingScope === root)
        .map((m) => m.userId),
    ),
  ];
  return (
    <aside
      ref={surface}
      className="thread-surface"
      aria-labelledby="thread-heading"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeSafely();
        }
        if (event.key === 'Tab' && window.matchMedia('(max-width: 63.99rem)').matches) {
          const nodes = [
            ...(surface.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
            ) ?? []),
          ].filter((node) => node.getClientRects().length > 0);
          if (!nodes?.length) return;
          const first = nodes[0]!,
            last = nodes[nodes.length - 1]!;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <header className="room-stream-heading">
        <h2 id="thread-heading">
          <MessageSquare size={18} aria-hidden="true" />
          Thread
        </h2>
        {appCommands && (
          <button
            className="incident-button thread-commands lg:hidden"
            aria-label="Thread commands"
            title="Thread commands"
            onClick={() => appCommands.openPalette()}
          >
            <Command size={16} aria-hidden="true" />
          </button>
        )}
        <button
          data-thread-close
          className="incident-button thread-close"
          onClick={closeSafely}
          aria-label="Back to Timeline / Close Thread"
          title="Close Thread"
        >
          <X size={18} aria-hidden="true" />
          <span>Close</span>
        </button>
      </header>
      <div className="thread-root">
        <p className="thread-root-label">Discussion of Timeline entry · {root}</p>
        {rootQuery.data && (
          <ThreadRootPreview entry={rootQuery.data as TimelineEntry} users={users} />
        )}
        <button
          className="incident-button"
          onClick={() => {
            typing(false, root);
            void flush()
              .then(viewRoot)
              .catch(() =>
                setIssue(
                  'Draft could not be saved before navigation. Your text and reply target remain here.',
                ),
              );
          }}
        >
          View root in Timeline
        </button>
      </div>
      <p
        className={`room-connection room-connection-${status}`}
        aria-label="Thread connection"
        role="status"
      >
        {status === 'offline' ? (
          <WifiOff size={14} aria-hidden="true" />
        ) : (
          <Radio size={14} aria-hidden="true" />
        )}
        {status === 'connected'
          ? 'Connected'
          : status === 'offline'
            ? 'Offline'
            : status === 'reconnecting'
              ? 'Reconnecting…'
              : 'Connecting…'}
      </p>
      {status !== 'connected' && (
        <button className="incident-button" onClick={retryConnection}>
          Retry Thread connection
        </button>
      )}
      {rootQuery.isPending && <p role="status">Loading Thread root…</p>}
      {rootQuery.isError && (
        <div role="alert">
          <p>
            {rootQuery.error instanceof AppError && rootQuery.error.category === 'authorization'
              ? 'Thread root access denied.'
              : rootQuery.error instanceof AppError && rootQuery.error.category === 'not-found'
                ? 'Thread root unavailable.'
                : 'Unable to load Thread root. Timeline remains available.'}
          </p>
          <button className="incident-button" onClick={() => void rootQuery.refetch()}>
            Retry Thread root
          </button>
        </div>
      )}
      {rootQuery.isSuccess && history.isPending && <p role="status">Loading Thread history…</p>}
      {history.isError && (
        <div role="alert">
          <p>
            {denied
              ? 'Thread unavailable or access denied.'
              : 'Unable to load Thread history. Existing messages remain visible.'}
          </p>
          <button
            className="incident-button"
            onClick={() =>
              void (history.isFetchNextPageError
                ? history.fetchNextPage({ cancelRefetch: false })
                : history.refetch())
            }
          >
            Retry Thread history
          </button>
        </div>
      )}
      {history.isSuccess && !rows.length && (
        <p>No replies yet. The first reply creates this Thread.</p>
      )}
      <div className="room-history-actions thread-history-toolbar">
        <button
          className="incident-button room-latest"
          aria-label="Latest replies"
          onClick={goLatest}
        >
          Latest
        </button>
        {history.hasNextPage && (
          <button
            className="incident-button room-latest"
            aria-label="Load older replies"
            disabled={history.isFetching}
            onClick={() => void history.fetchNextPage({ cancelRefetch: false })}
          >
            Load older
          </button>
        )}
        {target !== null && !highlight && !navigationStatus.startsWith('Locating') && (
          <button
            className="incident-button room-latest room-target-retry"
            aria-label="Retry message target"
            title="Retry message target"
            onClick={() => setTargetAttempt((value) => value + 1)}
          >
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {navigationStatus && (
        <div className="room-navigation-feedback">
          <p role="status">{navigationStatus}</p>
        </div>
      )}
      <MeasuredStream
        ref={viewport}
        rows={denied ? [] : rows}
        label="Thread"
        highlight={highlight}
        targetActive={target !== null}
        targetId={target}
        newEntryIds={arrivals}
        goLatest={goLatest}
        onUserScroll={() => {
          if (!navigation.cancel()) return;
          setHighlight(null);
          setNavigationStatus('Thread target navigation cancelled.');
        }}
        renderRow={(position) => {
          const row = rows[position]!;
          return row.entry ? (
            <ThreadMessageContent
              message={row.entry}
              index={index}
              users={users}
              writable={writable && ready && !busy}
              reply={(id) => {
                edit(latest.current.body, id);
                surface.current
                  ?.querySelector<HTMLTextAreaElement>('textarea')
                  ?.focus({ preventScroll: true });
              }}
              navigate={navigate}
            />
          ) : row.local ? (
            <PendingReply
              record={row.local}
              writable={writable}
              check={(id) => act(delivery.check(id))}
              retry={(id) => act(delivery.retry(id))}
              remove={(id) => act(delivery.remove(id))}
            />
          ) : 'gap' in row ? (
            <div>
              <p>Unloaded Thread history between windows</p>
              <button
                className="incident-button"
                onClick={() => act(loadWindow(`gap:${row.gap.cursor}`, row.gap.cursor))}
              >
                Load reply history gap
              </button>
            </div>
          ) : null;
        }}
      />
      <p className="room-typing" aria-label="Thread typing">
        {typers.length > 2
          ? `${typers.length} people are typing in this Thread…`
          : typers.length
            ? `${typers.map((id) => users.find((u) => u.id === id)?.name ?? 'Workspace member').join(' and ')} ${typers.length === 1 ? 'is' : 'are'} typing in this Thread…`
            : ''}
      </p>
      {replyTarget && (
        <div className="thread-reply-context" aria-label="Reply context">
          <span>Replying to </span>
          <ReplyReference id={replyTarget} index={index} users={users} navigate={navigate} />
          <button
            className="incident-button"
            disabled={busy || !ready}
            onClick={() => edit(latest.current.body, null)}
          >
            Cancel reply
          </button>
        </div>
      )}
      {!writable && issue && <p role="alert">{issue}</p>}
      <StreamCompose
        label="Thread"
        body={body}
        edit={(value) => edit(value)}
        users={users}
        ready={ready}
        busy={busy}
        writable={writable}
        resolved={incident.status === 'resolved'}
        issue={issue}
        discard={() =>
          act(
            work.draft(lease, '', null).then(() => {
              latest.current = { body: '', replyToMessageId: null };
              dirty.current = false;
              setBody('');
              setReplyTarget(null);
              setIssue(null);
            }),
          )
        }
        send={() => {
          if (preparing.current || busy || !writable) return;
          preparing.current = true;
          setBusy(true);
          setIssue(null);
          typing(false, root);
          if (timer.current) clearTimeout(timer.current);
          void delivery
            .prepare(latest.current.body, latest.current.replyToMessageId)
            .then((record) => {
              latest.current = { body: '', replyToMessageId: null };
              dirty.current = false;
              preparing.current = false;
              setBody('');
              setReplyTarget(null);
              setBusy(false);
              act(delivery.exposeAndSend(record));
            })
            .catch(() => {
              preparing.current = false;
              setBusy(false);
              setIssue(
                'Reply could not be saved locally. Text and reply target remain here; nothing was sent.',
              );
            });
        }}
      />
    </aside>
  );
}
