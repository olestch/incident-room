'use client';
import { applyNotification } from '@/app/_discovery/notification-cache';
import { applyPostmortemEvent } from '@/app/_postmortem/cache';
import { notificationKeys } from '@/entities/notification/model';
import { postmortemKeys } from '@/entities/postmortem/model';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  threadKeys,
  mergeThread,
  mergeMessages,
  type Thread,
  type ThreadMessage,
} from '@/entities/thread/model';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { CurrentUser } from '@/entities/current-user/model';
import { incidentKeys, type Incident } from '@/entities/incident/model';
import {
  timelineKeys,
  mergeEntries,
  type TimelineEntry,
  type TimelineWindow,
} from '@/entities/timeline/model';
import { RealtimeCoordinator } from '@/features/realtime/coordinator';
import { MockRealtimeTransport } from '@/features/realtime/mock-transport';
import { ephemeralRequest } from '@/features/realtime/ephemeral-broker';
import {
  openSchema,
  streamSchema,
  syncSchema,
  snapshotSchema,
  type PresenceMember,
} from '@/features/realtime/protocol';
import { connectionChanged, type ConnectionStatus } from '@/features/realtime/connection-slice';
import type { DeliveryCoordinator } from '@/features/timeline/delivery';
import { useSessionRuntime } from '@/app/_providers/session-provider';
import { useAppDispatch } from '@/app/_providers/hooks';
import { hasAcquiredThreadMessage, mergeThreadSnapshotWindow } from './thread-cache';

export interface ActiveThreadPort {
  root: string;
  loadedIds(): string[];
  acknowledge(message: ThreadMessage): Promise<void>;
  created(message: ThreadMessage): void;
}
export function useRoomRealtime(
  incident: Incident,
  actor: CurrentUser,
  delivery: DeliveryCoordinator,
  threadPort?: RefObject<ActiveThreadPort | null>,
) {
  const { coordinator: session, adapter } = useSessionRuntime();
  const cache = useQueryClient();
  const dispatch = useAppDispatch();
  const runtime = useRef<RealtimeCoordinator | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [arrivals, setArrivals] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    const generation = session.snapshot().generation;
    const valid = () => {
      const state = session.snapshot();
      return (
        active &&
        state.generation === generation &&
        'identity' in state &&
        state.identity.userId === actor.id &&
        state.identity.workspaceId === actor.workspaceId
      );
    };
    let connectedOnce = false;
    const counted = new Set<string>();
    const clientId = crypto.randomUUID();
    // Public test correlation only; no credentials or domain content.
    sessionStorage.setItem('ir_realtime_client', clientId);
    const root = `/incidents/${encodeURIComponent(incident.number)}/realtime`;
    const ackKey = timelineKeys.acknowledgments(actor.id, actor.workspaceId, incident.id);
    const prefix = ['identity', actor.id, actor.workspaceId, 'timeline', incident.id];
    const windows = () =>
      cache
        .getQueriesData<TimelineWindow | InfiniteData<TimelineWindow> | TimelineEntry[]>({
          queryKey: prefix,
        })
        .flatMap(([, data]) => {
          if (!data || Array.isArray(data)) return [];
          return 'pages' in data ? data.pages : [data];
        });
    const known = (id: string) =>
      windows().some((window) => window.items.some((entry) => entry.id === id)) ||
      (cache.getQueryData<TimelineEntry[]>(ackKey) ?? []).some((entry) => entry.id === id);
    const merge = (entry: TimelineEntry) => {
      const rootKey = [
        ...threadKeys.all(actor.id, actor.workspaceId, incident.id, entry.id),
        'root',
      ];
      if (cache.getQueryState(rootKey))
        cache.setQueryData<TimelineEntry>(rootKey, (previous) =>
          !previous ||
          previous.revision < entry.revision ||
          (previous.revision === entry.revision && entry.tombstone)
            ? entry
            : previous,
        );
      return cache.setQueryData<TimelineEntry[]>(ackKey, (previous = []) => [
        ...mergeEntries(new Map(previous.map((value) => [value.id, value])), [entry]).values(),
      ]);
    };
    const read = <T>(path: string, schema: import('zod').z.ZodType<T>, signal: AbortSignal) =>
      session.request((s) => adapter.resource(`${root}${path}`, schema, s), 'safe-read', signal);
    const transport = new MockRealtimeTransport({
      open: (signal) => read('/open', openSchema, signal),
      stream: (after, signal) =>
        read(`/stream?after=${after}&client=${clientId}`, streamSchema, signal),
      presence: (action, typing, signal, typingScope) =>
        ephemeralRequest(
          {
            action,
            typing,
            typingScope,
            clientId,
            userId: actor.id,
            room: JSON.stringify([actor.workspaceId, incident.id]),
          },
          signal,
        ),
    });
    const service = new RealtimeCoordinator(actor.workspaceId, incident.id, transport, {
      changed: (value) => {
        if (valid()) {
          if (value === 'connected') connectedOnce = true;
          setStatus(value);
          dispatch(connectionChanged(value));
        }
      },
      ephemeral: (value) => {
        if (valid())
          setMembers(
            (value?.members ?? [])
              .filter((member) => member.expiresAt > Date.now())
              .map((member) => ({
                ...member,
                typingUntil: member.typingUntil > Date.now() ? member.typingUntil : 0,
              })),
          );
      },
      boundary: async (signal) => (await read('/open', openSchema, signal)).highWater,
      sync: (after, boundary, signal) =>
        read(`/sync?after=${after}&boundary=${boundary}`, syncSchema, signal),
      apply: async (event, signal) => {
        signal.throwIfAborted();
        if (!valid()) throw new DOMException('Room disposed', 'AbortError');
        if (await applyPostmortemEvent(cache, actor.id, actor.workspaceId, event, signal)) return;
        if (event.resourceType === 'notification') {
          if (event.payload.notification.recipientUserId === actor.id)
            applyNotification(
              cache,
              actor.id,
              actor.workspaceId,
              event.payload.notification,
              event.payload.unread,
            );
          return;
        }
        if (event.resourceType === 'checkpoint') return;
        if (event.resourceType === 'incident') {
          const key = incidentKeys.detail(actor.id, actor.workspaceId, event.payload.number);
          cache.setQueryData<Incident>(key, (previous) =>
            !previous || previous.revision < event.revision ? event.payload : previous,
          );
          // Lists own filters/order/cursors: refetch the authoritative collection rather than splice a sorted page.
          void cache.invalidateQueries({
            queryKey: incidentKeys.lists(actor.id, actor.workspaceId),
          });
          return;
        }
        if (event.incidentId !== incident.id) return;
        if (event.resourceType === 'thread') {
          const summaryKey = threadKeys.summary(
            actor.id,
            actor.workspaceId,
            incident.id,
            event.payload.rootTimelineEntryId,
          );
          cache.setQueryData<Thread | null>(summaryKey, (previous) =>
            mergeThread(previous, event.payload),
          );
          return;
        }
        if (event.resourceType === 'thread_message') {
          const message = event.payload;
          const port = threadPort?.current;
          if (port?.root === message.rootTimelineEntryId) {
            const existed = hasAcquiredThreadMessage(
              cache,
              threadKeys.all(actor.id, actor.workspaceId, incident.id, port.root),
              message.id,
            );
            const threadAckKey = threadKeys.acknowledgments(
              actor.id,
              actor.workspaceId,
              incident.id,
              message.rootTimelineEntryId,
            );
            cache.setQueryData<ThreadMessage[]>(threadAckKey, (previous = []) => [
              ...mergeMessages(new Map(previous.map((m) => [m.id, m])), [message]).values(),
            ]);
            await port.acknowledge(message);
            if (valid() && connectedOnce && !existed && event.kind === 'thread_message_created')
              port.created(message);
          } else {
            // Closed histories remain bounded Query resources. Mark stale, never eagerly load them.
            void cache.invalidateQueries({
              queryKey: threadKeys.all(
                actor.id,
                actor.workspaceId,
                incident.id,
                message.rootTimelineEntryId,
              ),
              refetchType: 'none',
            });
          }
          return;
        }
        if (event.resourceType !== 'timeline') return;
        const existed = known(event.resourceId);
        merge(event.payload);
        await delivery.acknowledge(event.payload);
        signal.throwIfAborted();
        if (
          valid() &&
          connectedOnce &&
          !existed &&
          event.kind === 'timeline_created' &&
          !counted.has(event.resourceId)
        ) {
          counted.add(event.resourceId);
          setArrivals((previous) => [...previous, event.resourceId]);
        }
      },
      snapshot: async (signal) => {
        await cache.invalidateQueries({
          queryKey: postmortemKeys.all(actor.id, actor.workspaceId),
        });
        await cache.invalidateQueries({
          queryKey: notificationKeys.all(actor.id, actor.workspaceId),
        });
        const activeThread = threadPort?.current;
        const ids = [
          ...new Set(
            windows()
              .flatMap((window) => window.items.map((entry) => entry.id))
              .concat(
                (cache.getQueryData<TimelineEntry[]>(ackKey) ?? []).map((entry) => entry.id),
                activeThread ? [activeThread.root] : [],
              ),
          ),
        ];
        const messageIds = activeThread?.loadedIds() ?? [];
        const batches = Math.max(1, Math.ceil(ids.length / 60), Math.ceil(messageIds.length / 60));
        for (let index = 0; index < batches; index++) {
          const query = new URLSearchParams();
          for (const id of ids.slice(index * 60, (index + 1) * 60)) query.append('entry', id);
          if (activeThread) {
            query.set('thread', activeThread.root);
            for (const id of messageIds.slice(index * 60, (index + 1) * 60))
              query.append('message', id);
          }
          const snapshot = await read(`/snapshot?${query}`, snapshotSchema, signal);
          signal.throwIfAborted();
          if (
            !valid() ||
            snapshot.incident.id !== incident.id ||
            snapshot.incident.workspaceId !== actor.workspaceId
          )
            throw new Error('Invalid snapshot scope');
          cache.setQueryData<Incident>(
            incidentKeys.detail(actor.id, actor.workspaceId, incident.number),
            (previous) =>
              !previous || previous.revision <= snapshot.incident.revision
                ? snapshot.incident
                : previous,
          );
          for (const window of snapshot.windows)
            for (const entry of window.items) {
              if (entry.incidentId !== incident.id) throw new Error('Invalid snapshot room');
              merge(entry);
              await delivery.acknowledge(entry);
            }
          if (threadPort?.current === activeThread && activeThread) {
            for (const discussion of snapshot.threads) {
              if (discussion.root !== activeThread.root)
                throw new Error('Invalid Thread snapshot scope');
              if (discussion.summary)
                cache.setQueryData<Thread | null>(
                  threadKeys.summary(actor.id, actor.workspaceId, incident.id, discussion.root),
                  (previous) => mergeThread(previous, discussion.summary!),
                );
              for (const window of discussion.windows) {
                for (const message of window.items) {
                  if (
                    message.workspaceId !== actor.workspaceId ||
                    message.incidentId !== incident.id ||
                    message.rootTimelineEntryId !== discussion.root
                  )
                    throw new Error('Invalid Thread message snapshot');
                }
                const fresh = mergeThreadSnapshotWindow(
                  cache,
                  threadKeys.all(actor.id, actor.workspaceId, incident.id, discussion.root),
                  window.items,
                );
                for (const message of window.items) {
                  await activeThread.acknowledge(message);
                  if (
                    valid() &&
                    threadPort?.current === activeThread &&
                    connectedOnce &&
                    fresh.has(message.id)
                  )
                    activeThread.created(message);
                }
              }
            }
          }
        }
        void cache.invalidateQueries({ queryKey: incidentKeys.all(actor.id, actor.workspaceId) });
        void cache.invalidateQueries({
          queryKey: threadKeys.room(actor.id, actor.workspaceId, incident.id),
          predicate: (query) => query.queryKey.at(-1) === 'summary',
        });
      },
    });
    runtime.current = service;
    const removeLifecycle = session.registerLifecycle({
      stop: () => {
        active = false;
        service.dispose();
      },
      clearDurableOnLogout: async () => {},
    });
    const offline = () => service.setOnline(false);
    const online = () => service.setOnline(true);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    service.start();
    if (!navigator.onLine) service.setOnline(false);
    return () => {
      active = false;
      service.dispose();
      removeLifecycle();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      if (runtime.current === service) runtime.current = null;
    };
  }, [
    incident.id,
    incident.number,
    actor.id,
    actor.workspaceId,
    delivery,
    cache,
    dispatch,
    session,
    adapter,
    threadPort,
  ]);
  const retry = useCallback(() => runtime.current?.retry(), []);
  const typing = useCallback(
    (value: boolean, root?: string) => runtime.current?.typing(value, root),
    [],
  );
  return {
    status,
    members,
    arrivals,
    retry,
    typing,
  };
}
